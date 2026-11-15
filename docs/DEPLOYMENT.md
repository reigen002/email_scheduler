# Hosting: Northflank and Vercel

The intended deployment uses Vercel Hobby for the Next.js frontend and an
always-running Northflank Sandbox service for the Express API and BullMQ worker.
The worker runs in the API process, so it must remain running with no browser open.

Northflank currently advertises two services and one database on its free Sandbox
plan. Before provisioning, verify the account's actual free compute, storage and
egress allowances. A candidate layout is one API service, one private Redis
service with persistent storage, and one PostgreSQL addon. Do not create a paid
resource to complete this layout. Persistent Redis storage and outbound SMTP
access still require verification in the hosting account.

## Backend

- Repository: `reigen002/email_scheduler`, branch `master`.
- Dockerfile: `/backend/Dockerfile`; Docker build context: `/backend`.
- One continuously running instance; expose HTTP port `3001` with HTTPS ingress.
- Readiness check: `GET /api/health` on port `3001`.
- PostgreSQL 16 with retained storage and a private connection URL.
- Redis 7 with retained storage mounted at `/data`, AOF enabled and
  `maxmemory-policy noeviction`. Keep Redis private; do not expose its TCP port
  publicly. Use authentication and inject the connection URL as a secret.
- Preserve data volumes across redeployments. Avoid scaling to zero.

Backend environment variables (set secrets through the provider):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DATABASE_URL` | Private PostgreSQL URL with the database's TLS settings |
| `REDIS_URL` | Private Redis URL with the Redis service's TLS settings |
| `JWT_SECRET` | Newly generated random secret of at least 32 characters |
| `FRONTEND_URL` | Exact Vercel production origin, without trailing slash |
| `GOOGLE_CLIENT_ID` | Existing Google OAuth client ID, if Google login is enabled |
| `GOOGLE_CLIENT_SECRET` | Existing Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | `https://<backend-host>/api/auth/google/callback` |
| `WORKER_CONCURRENCY` | `5` |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` |

The app currently uses Ethereal SMTP on port 587. Verify an actual SMTP submission
from the deployed service; an HTTP health check cannot establish SMTP access.
Ethereal provides test message previews and does not deliver to real inboxes.
Do not put backend secrets into frontend environment variables.

## Frontend

Import the same repository into Vercel with Root Directory set to `frontend` and
the Next.js framework preset. `frontend/vercel.json` defines install/build commands.
Set `NEXT_PUBLIC_API_URL=https://<backend-host>` before building the production
deployment. Changing this value requires a new frontend build.

Update the backend's `FRONTEND_URL` to the final Vercel origin. For Google login,
also add the frontend origin and backend callback URL to the existing OAuth
client's authorized origins and redirect URIs in Google Cloud Console. Email and
password login does not require Google OAuth configuration.

## Acceptance checks after deployment

1. Confirm both services use free plans and all persistent storage is retained.
2. Check backend `/api/health`, frontend loading, registration and login.
3. Schedule messages for a few minutes ahead, close the browser and verify SMTP
   acceptance timestamps against the scheduled times. Confirm preview URLs work.
4. Check configured spacing, hourly deferral and retry behavior.
5. Restart the backend with a future pending job; confirm it sends once and the
   stored account, campaign and message history survive the restart.
6. Recheck after an idle period longer than 15 minutes with the browser closed.

Scheduling begins when the job is due, subject to sender quotas, send spacing,
worker capacity and SMTP/network latency. The dashboard may take up to 30 seconds
to refresh. Free hosting does not provide a hard delivery-time guarantee.

## Provider references

- [Northflank pricing and Sandbox limits](https://northflank.com/pricing)
- [Northflank persistent volumes](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume)
- [Northflank GitHub integration](https://northflank.com/docs/v1/application/getting-started/link-your-git-account)
- [Vercel monorepo root directory](https://vercel.com/docs/monorepos)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)

Render's free web service sleeps when idle and blocks outbound SMTP ports, so it
does not meet this project's unattended scheduling requirements with Ethereal:
[Render free service restrictions](https://render.com/docs/free).
