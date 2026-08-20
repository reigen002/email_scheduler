import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { query, queryOne } from '../config/database';
import { generateToken, authenticateJWT } from '../middleware/auth';
import { User } from '../types';

const router = Router();
const oauth2Client = new OAuth2Client(
  config.GOOGLE_CLIENT_ID,
  config.GOOGLE_CLIENT_SECRET,
  config.GOOGLE_CALLBACK_URL
);

/**
 * GET /api/auth/google
 * Redirect to Google OAuth consent screen
 */
router.get('/google', (_req: Request, res: Response) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'consent',
  });
  res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * Handle Google OAuth callback
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(
      `${config.FRONTEND_URL}/login?error=${encodeURIComponent(String(error))}`
    );
  }

  if (!code) {
    return res.redirect(`${config.FRONTEND_URL}/login?error=missing_code`);
  }

  try {
    const { tokens } = await oauth2Client.getToken(String(code));
    oauth2Client.setCredentials(tokens);

    // Verify the ID token and extract user info
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: config.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.redirect(`${config.FRONTEND_URL}/login?error=invalid_token`);
    }

    // Upsert user in database
    const user = await queryOne<User>(
      `INSERT INTO users (id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url,
             updated_at = NOW()
       RETURNING *`,
      [payload.sub, payload.email, payload.name ?? null, payload.picture ?? null]
    );

    if (!user) throw new Error('Failed to upsert user');

    // Generate JWT
    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    });

    // Redirect to frontend with token in URL fragment or query
    return res.redirect(
      `${config.FRONTEND_URL}/auth/callback?token=${encodeURIComponent(token)}`
    );
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.redirect(`${config.FRONTEND_URL}/login?error=auth_failed`);
  }
});

/**
 * POST /api/auth/google/token
 * Exchange Google ID token for our JWT (for SPA flow using Google Sign-In SDK)
 */
router.post('/google/token', async (req: Request, res: Response) => {
  const { id_token } = req.body;

  if (!id_token) {
    return res.status(400).json({ error: 'id_token is required' });
  }

  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: String(id_token),
      audience: config.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    // Upsert user
    const user = await queryOne<User>(
      `INSERT INTO users (id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url,
             updated_at = NOW()
       RETURNING *`,
      [payload.sub, payload.email, payload.name ?? null, payload.picture ?? null]
    );

    if (!user) throw new Error('Failed to upsert user');

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (err) {
    console.error('Token exchange error:', err);
    return res.status(401).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', authenticateJWT, async (req: Request, res: Response) => {
  const user = req.user!;
  const dbUser = await queryOne<User>('SELECT * FROM users WHERE id = $1', [user.id]);

  if (!dbUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    avatarUrl: dbUser.avatar_url,
  });
});

/**
 * POST /api/auth/logout
 * Client-side token invalidation (JWT is stateless; instruct client to delete token)
 */
router.post('/logout', authenticateJWT, (_req: Request, res: Response) => {
  res.json({ message: 'Logged out successfully' });
});

// ─── Email / Password Auth ────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

/**
 * POST /api/auth/register
 * Create a new account with email + password.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await queryOne<User & { password_hash: string | null }>(
      'SELECT * FROM users WHERE email = $1',
      [normalizedEmail]
    );

    let user: User;

    if (existing) {
      if (existing.password_hash) {
        // Full account already exists — just tell them to log in
        return res.status(409).json({
          error: 'An account with this email already exists. Please log in instead.',
        });
      }
      // Google-only account — set a password so they can also use email/password
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const updated = await queryOne<User>(
        `UPDATE users SET password_hash = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [passwordHash, existing.id]
      );
      if (!updated) throw new Error('Failed to set password');
      user = updated;
    } else {
      // Brand-new account
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const userId = uuidv4();
      const displayName = name?.trim() || normalizedEmail.split('@')[0];
      const created = await queryOne<User>(
        `INSERT INTO users (id, email, name, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [userId, normalizedEmail, displayName, passwordHash]
      );
      if (!created) throw new Error('Failed to create user');
      user = created;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    });

    return res.status(existing ? 200 : 201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate with email + password.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await queryOne<User & { password_hash: string | null }>(
      'SELECT * FROM users WHERE email = $1',
      [String(email).toLowerCase().trim()]
    );

    if (!user) {
      return res.status(401).json({ error: 'No account found with this email. Please register first.' });
    }

    const pwd = String(password);
    if (pwd.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (!user.password_hash) {
      // Google-only account — first email/password attempt sets the local password automatically
      const passwordHash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
      await query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, user.id]
      );
      // Fall through to issue token below
    } else {
      const valid = await bcrypt.compare(pwd, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Incorrect password. Please try again.' });
      }
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
    });

    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

export default router;
