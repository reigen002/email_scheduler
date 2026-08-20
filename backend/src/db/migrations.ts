import { getPool } from '../config/database';

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001_create_migrations_table',
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: '002_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: '003_create_email_campaigns',
    sql: `
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_email VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255),
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        delay_between_emails_ms INTEGER NOT NULL DEFAULT 2000,
        hourly_limit INTEGER NOT NULL DEFAULT 200,
        total_recipients INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'completed', 'cancelled', 'paused')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON email_campaigns(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
      CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled_at ON email_campaigns(scheduled_at);
    `,
  },
  {
    name: '004_create_email_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS email_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_email VARCHAR(255) NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        sender_email VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255),
        bull_job_id VARCHAR(255) UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'cancelled')),
        scheduled_at TIMESTAMPTZ NOT NULL,
        sent_at TIMESTAMPTZ,
        error_message TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        preview_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign_id ON email_jobs(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_email_jobs_user_id ON email_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_jobs_status ON email_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_email_jobs_scheduled_at ON email_jobs(scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_email_jobs_bull_job_id ON email_jobs(bull_job_id);
      CREATE INDEX IF NOT EXISTS idx_email_jobs_sender_email ON email_jobs(sender_email);
    `,
  },
  {
    name: '005_create_updated_at_trigger',
    sql: `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      CREATE OR REPLACE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      CREATE OR REPLACE TRIGGER update_email_campaigns_updated_at
        BEFORE UPDATE ON email_campaigns
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

      CREATE OR REPLACE TRIGGER update_email_jobs_updated_at
        BEFORE UPDATE ON email_jobs
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `,
  },
  {
    name: '006_add_password_hash_to_users',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    `,
  },
  {
    name: '007_add_attachments_to_email_tables',
    sql: `
      ALTER TABLE email_campaigns
        ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

      ALTER TABLE email_jobs
        ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Get applied migrations
    const { rows: applied } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY id'
    );
    const appliedNames = new Set(applied.map((r) => r.name));

    // Run pending migrations
    for (const migration of MIGRATIONS) {
      if (appliedNames.has(migration.name)) {
        continue;
      }

      console.log(`  🔄 Applying migration: ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
        console.log(`  ✅ Migration applied: ${migration.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('✅ All migrations applied');
  } finally {
    client.release();
  }
}
