# Email Scheduler dashboard

Next.js 16, React 19, TypeScript, and Tailwind CSS. Requires Node.js **20.9+**.
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
