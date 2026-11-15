# Email Scheduler dashboard

Next.js 16, React 19, TypeScript, and Tailwind CSS. Uses Node.js **24.x**.
See the [root README](../README.md) for the complete backend, Redis, PostgreSQL,
Ethereal, and optional Google OAuth setup.

From this folder:

```sh
npm ci
cp .env.local.example .env.local
npm run dev
```

On PowerShell, use `Copy-Item .env.local.example .env.local`.
Set `NEXT_PUBLIC_API_URL=http://localhost:3001`; start the backend before logging
in. Open http://localhost:3000 and register an account or sign in with Google.

```sh
npm run lint
npm run build
npm start
```

The dashboard includes Scheduled/Sent views, compose and CSV uploads, rich text,
attachments, scheduling controls, search/date filters, pagination, and Ethereal
preview links. Changes appear on manual refresh or through 30-second polling.

## Deploy the frontend to Vercel

Import `reigen002/email_scheduler` into your Vercel Hobby account using these
settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | Next.js |
| Node.js Version | `24.x` (set in `package.json`) |
| Install Command | `npm ci` (set in `vercel.json`) |
| Build Command | `npm run build` (set in `vercel.json`) |
| Output Directory | Leave the Next.js default |

Set `NEXT_PUBLIC_API_URL` in Vercel's environment variables for Production and,
if needed, Preview deployments. Its value must be your public HTTPS backend
origin, for example `https://your-backend.example.com`, without `/api` or a
trailing slash. The example hostname is a placeholder, not a running backend.
Changing this variable requires redeployment because Next.js embeds it at build
time. No frontend Google client ID variable is needed: Google sign-in starts at
the backend's OAuth endpoint.

The frontend can deploy before the backend is hosted, but login, registration
and scheduling need a reachable backend. A deployed frontend cannot use
`http://localhost:3001` as its shared backend.

Once Vercel assigns the production URL, set the backend's `FRONTEND_URL` to that
exact origin so browser API requests pass CORS. For Google login, update the
Google OAuth client with the production frontend origin and the backend's
`/api/auth/google/callback` redirect URL. See the
[full deployment guide](../docs/DEPLOYMENT.md) for backend settings.

References: [Vercel monorepo import](https://vercel.com/docs/monorepos),
[Node.js version selection](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[environment variables](https://vercel.com/docs/environment-variables).
