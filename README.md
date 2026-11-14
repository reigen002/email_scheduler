# Email Scheduler

An assignment application with an Express + TypeScript API, BullMQ workers,
Redis, PostgreSQL, and a Next.js 16 + React 19 dashboard. Ethereal captures test
emails without delivering them to real inboxes.

## Demo

[Watch the submission demo](docs/demo.webm) (2 minutes 11 seconds).
It shows composing scheduled emails, the Scheduled and Sent dashboard views,
and stopping/restarting the backend before future emails are delivered.
See [the demo walkthrough](docs/DEMO.md) for reproduction steps.

## Run locally

Prerequisites: **Node.js 20.9+**, npm, Docker Desktop / Docker Engine, and the
Docker Compose plugin (`docker compose`). Internet access is needed for npm
installation, Google Fonts during the frontend build, and Ethereal SMTP.

```sh
git clone https://github.com/reigen002/email_scheduler.git
cd email_scheduler
npm --prefix backend ci
npm --prefix frontend ci
docker compose up -d --wait
```

The repository contains both applications as ordinary folders; no submodule
initialization is needed. PostgreSQL is exposed on **localhost:5433** and Redis
on **localhost:6379**. Both use named Docker volumes. Start Docker Desktop first
on Windows.

Copy the environment templates:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

PowerShell equivalents:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.local.example frontend/.env.local
```

Set a fresh `JWT_SECRET` in `backend/.env`; generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The local backend configuration is:

```dotenv
PORT=3001
DATABASE_URL=postgresql://postgres:password@localhost:5433/email_scheduler
REDIS_URL=redis://localhost:6379
JWT_SECRET=replace_with_the_generated_secret
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:3000
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_SENDS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
```

The frontend needs:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Run these in separate terminals:

```sh
# Terminal 1: migrations, queue recovery, Express API, and BullMQ worker
npm --prefix backend run dev

# Terminal 2: Next.js dashboard
npm --prefix frontend run dev
```

Open **http://localhost:3000**. Register an email/password account to try the app
without Google Cloud configuration. Use an email address such as
`reviewer@example.com`; Ethereal captures the messages rather than sending them
to recipients. Health check: **http://localhost:3001/api/health**.

Production builds:

```sh
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix backend start
# In another terminal:
npm --prefix frontend start
```

### Google login (optional alternative)

1. Create a Google Cloud project and configure its OAuth consent screen.
2. Create an OAuth 2.0 client of type **Web application**.
3. Add JavaScript origin `http://localhost:3000` and redirect URI
   `http://localhost:3001/api/auth/google/callback`.
4. For an app in testing, add your Google account as a test user.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in
   `backend/.env`, then restart the backend.

Use **Login with Google**. Google-only accounts cannot acquire a password via
the unauthenticated registration/login endpoints. Automatic linking between
local and Google accounts is intentionally not implemented; use different email
addresses when testing both login methods.

### Ethereal Email setup

No SMTP credentials are required. On the **first email sent by each backend
process**, `nodemailer.createTestAccount()` creates an Ethereal account and the
transporter connects to its SMTP server. Account details and message preview
URLs are logged by the backend. Each sent row stores its preview URL; select
**Preview** in the dashboard to inspect the captured message.

Ethereal needs outbound HTTPS and SMTP access (normally port 587). If a network
blocks SMTP, sends retry with backoff and eventually appear as failed. Real
recipient inbox delivery is outside this assignment's test-email workflow.

## Architecture

```text
Next.js dashboard -> JWT-authenticated Express API
  -> PostgreSQL transaction: campaign + one pending record per recipient
  -> commit -> BullMQ delayed jobs in Redis
  -> worker -> shared Redis quota -> Ethereal SMTP
  -> PostgreSQL delivery status + preview URL -> dashboard polling
```

### Scheduling

`POST /api/emails/schedule` accepts a subject, HTML body, recipients, sender,
UTC/offset-aware `scheduled_at`, `delay_between_emails_ms`, and `hourly_limit`.
Recipients can also come from a CSV/TXT upload. Duplicates are removed. Each
recipient gets a UUID and a scheduled time of `start + index * delay`.

The API commits the database transaction **before** publishing work to Redis.
The persisted pending records act as a simple outbox. Each queue job uses its
database job ID, so republishing the same pending record does not create a
second BullMQ job. No cron jobs or in-memory scheduling timers are used.

### Persistence and restart recovery

- Redis uses AOF, periodic snapshots, and a named volume. PostgreSQL has its own
  named volume. `docker compose down` keeps these; `down -v` deletes the data.
- Future jobs remain in Redis while the backend is stopped. BullMQ resumes them
  when a worker reconnects; overdue emails run when service becomes available.
- On startup and every 30 seconds, pending database records are republished with
  stable job IDs. This repairs a crash between database commit and queue insert,
  and can rebuild missing queue entries from PostgreSQL.
- BullMQ's active-job lock coordinates workers. The worker checks persisted
  status and skips sent, cancelled, failed, or deleted records.
- A failed SMTP attempt keeps the record pending until retries are exhausted;
  it does not leave behind a premature "processed" marker.

### Rate limiting and concurrency

- A Redis Lua script atomically checks and reserves a slot under
  `rate_limit:{sender}:{UTC-date-hour}`. The quota is shared across workers and
  campaigns using that sender. The effective limit for each job is the smaller
  of its campaign's `hourly_limit` and `MAX_EMAILS_PER_HOUR_PER_SENDER`.
- When the quota is exhausted, the worker moves the **same** BullMQ job to the
  next UTC hour plus one second. The row stays `scheduled`; normal deferral
  consumes no retry attempt and is not reported as a failed delivery.
- `WORKER_CONCURRENCY` controls how many jobs a worker can have active.
  A queue-wide BullMQ limiter permits one new job start per
  `MIN_DELAY_BETWEEN_SENDS_MS`, including across worker instances. SMTP calls may
  overlap, but increasing concurrency cannot create an immediate send burst.
- `delay_between_emails_ms` additionally staggers recipients in a campaign.
  Failed SMTP attempts release their hourly quota reservation.

## Implemented features

| Area | Features |
| --- | --- |
| Backend scheduler | BullMQ delayed jobs; per-recipient staggering; JSON and CSV/TXT recipients; attachments |
| Backend persistence | PostgreSQL records; Redis AOF/volumes; startup and periodic queue recovery |
| Backend rate limiting | Shared atomic per-sender UTC-hour quota; campaign limit; next-window deferral |
| Backend concurrency | Configurable active jobs; shared minimum start interval; retry backoff |
| Backend auth | Email/password registration/login, Google OAuth, JWT-protected API |
| Frontend login | Registration, password login, Google login, protected dashboard, logout |
| Frontend dashboard | Scheduled/Sent views, recipient/subject/time rows, search, date filters, pagination, refresh |
| Frontend compose | Manual recipients, CSV upload, rich text, attachments, date/time scheduling, quota/delay controls |
| Frontend delivery | Cancel scheduled emails; message details; deletion; Ethereal preview links; 30-second polling |

## API

All email endpoints and `/api/auth/me` require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | Email/password auth |
| GET | `/api/auth/google`, `/api/auth/google/callback` | Google OAuth redirect flow |
| POST | `/api/auth/google/token` | Google ID token exchange |
| GET | `/api/auth/me` | Current profile |
| POST | `/api/auth/logout` | Client logout |
| POST | `/api/emails/schedule` | Create a campaign |
| POST | `/api/emails/parse-csv` | Preview recipients from upload |
| GET | `/api/emails/scheduled`, `/api/emails/sent` | Paginated email records |
| GET | `/api/emails/campaigns` | Campaign statistics |
| DELETE | `/api/emails/:id/cancel`, `/api/emails/:id` | Cancel / delete |
| GET | `/api/emails/rate-limit/:senderEmail` | Global sender quota status |
| GET | `/api/health` | PostgreSQL and Redis health |

Example request body (replace the timestamp with a future time):

```json
{
  "sender_email": "reviewer@example.com",
  "subject": "Scheduled demo",
  "body": "<p>Hello from the scheduler.</p>",
  "recipients": ["one@example.com", "two@example.com"],
  "scheduled_at": "2030-01-01T10:00:00Z",
  "delay_between_emails_ms": 2000,
  "hourly_limit": 200
}
```

## Verification

The integration checks use separate local ports and **never use your `.env`
database, Redis, Google, or Ethereal credentials**. Only external Ethereal
account discovery is replaced by a localhost SMTP fixture; actual delivery
uses Nodemailer over TCP, and PostgreSQL, Redis, and BullMQ are real.

```sh
docker compose -p email-scheduler-check -f docker-compose.test.yml up -d --wait
npm --prefix backend test
npm --prefix frontend run lint
npm --prefix frontend run build
docker compose -p email-scheduler-check -f docker-compose.test.yml down
```

Checks cover transient SMTP retries, hourly deferral and eventual delivery,
minimum send spacing across campaigns, abrupt backend restart, recovery of a
missing Redis job, and rejection of Google-account password takeover attempts.

## Assumptions, shortcuts, and trade-offs

- **SMTP cannot guarantee exactly-once delivery.** If a provider accepts a
  message and the process crashes before persisting `sent`, recovery may send a
  duplicate. This implementation favors retrying ambiguous deliveries over
  silently losing them. A provider with idempotency keys would close that gap.
- **Fixed UTC-hour windows**, rather than a rolling hour. Deferred jobs can
  compete at the next boundary; strict ordering across campaigns is not promised.
- **One sender quota shared across campaigns.** A lower campaign limit applies
  when that campaign's jobs run; it does not impose a lower quota on other
  campaigns. Sender email addresses are not verified identities in this test app.
- **Recovery scans pending rows every 30 seconds.** Suitable for assignment
  scale; a large deployment would batch the outbox and use a dedicated publisher.
- **Ethereal is a test provider.** A new account is created per process; it does
  not deliver to recipients' real inboxes. Preview URLs are stored in PostgreSQL.
- **Polling instead of WebSockets.** Refresh manually or wait up to 30 seconds.
  Search and date filters operate on the currently loaded page.
- **Assignment auth scope.** JWTs live in browser localStorage; logout removes
  the local token. Password reset, verified local-email ownership, account linking,
  MFA, and production abuse controls are not implemented.
- **Persistence requires retained volumes.** Default Redis AOF durability can
  lose its most recent writes on a host failure; database recovery repairs pending
  jobs, but losing both data stores is outside the recovery guarantee.

Submission form: https://forms.gle/2qmgDJxV3HZmf9Pt8
