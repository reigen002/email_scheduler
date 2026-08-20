# 📧 Email Scheduler Service

A production-grade email scheduling platform built with **Express.js + BullMQ + Redis + PostgreSQL** on the backend and **Next.js + Tailwind CSS** on the frontend.

---

## 🗂️ Project Structure

```
email_service_scheduler/
├── backend/             # Express.js API + BullMQ worker
│   ├── src/
│   │   ├── config/      # Redis, DB, env config
│   │   ├── db/          # Migrations
│   │   ├── queues/      # BullMQ queue + worker
│   │   ├── routes/      # Auth + Email API routes
│   │   ├── services/    # Rate limiter, email sender, scheduler
│   │   ├── middleware/  # JWT auth
│   │   └── types/       # Shared TypeScript types
│   ├── .env.example
│   └── package.json
├── frontend/            # Next.js 14 dashboard
│   ├── src/
│   │   ├── app/         # Next.js App Router pages
│   │   ├── components/  # Reusable UI components
│   │   ├── hooks/       # useAuth, useEmails
│   │   ├── lib/         # API client
│   │   └── types/       # TypeScript interfaces
│   └── package.json
├── docker-compose.yml   # Redis + PostgreSQL
└── README.md
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- A Google Cloud project with OAuth 2.0 credentials

### 1. Clone and install

```bash
# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2. Start infrastructure (Redis + PostgreSQL)

```bash
# From the project root
docker-compose up -d
```

This starts:
- **Redis** on port `6379` (with AOF persistence)
- **PostgreSQL** on port `5432` (database: `email_scheduler`)

### 3. Configure environment variables

**Backend:**
```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/email_scheduler
REDIS_URL=redis://localhost:6379
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback
JWT_SECRET=your_random_64_char_secret
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_SENDS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
FRONTEND_URL=http://localhost:3000
```

**Frontend:**
```bash
cp frontend/.env.local.example frontend/.env.local
```

Edit `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
```

### 4. Set up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Google Identity** API
4. Navigate to **APIs & Services → Credentials**
5. Create **OAuth 2.0 Client ID** (Web Application)
6. Add **Authorized JavaScript origins**: `http://localhost:3000`
7. Add **Authorized redirect URIs**: `http://localhost:3001/api/auth/google/callback`
8. Copy the **Client ID** and **Client Secret** to your `.env` files

### 5. Start the backend

```bash
cd backend
npm run dev
```

On first start:
- Database migrations run automatically
- Ethereal Email test account is created (credentials logged to console)
- BullMQ worker starts and connects to Redis

### 6. Start the frontend

```bash
cd frontend
npm run dev
```

Visit **http://localhost:3000** → sign in with Google → start scheduling emails!

---

## 🏗️ Architecture Overview

### How Scheduling Works

```
User → POST /api/emails/schedule
    → Validate request
    → BEGIN PostgreSQL transaction
       → INSERT email_campaigns row
       → For each recipient:
          → INSERT email_jobs row (status: 'scheduled')
          → scheduleEmailJob(jobData, scheduledAt, emailJobId)
             → BullMQ.add(data, { jobId: emailJobId, delay: ms_until_send })
    → COMMIT
    → Return { campaign_id, total_jobs }

At scheduled time:
BullMQ Worker picks up job
    → Redis SET NX idempotency check (skip if already processed)
    → Redis INCR rate limit check (reschedule if hourly limit exceeded)
    → UPDATE email_jobs SET status='processing'
    → Send via Ethereal SMTP (nodemailer)
    → Sleep MIN_DELAY_BETWEEN_SENDS_MS
    → UPDATE email_jobs SET status='sent', preview_url=...
    → Check if campaign is fully complete → UPDATE status='completed'
```

### Persistence on Restart

BullMQ stores all jobs (including delayed future jobs) **in Redis** with full state. Redis is configured with:
- **AOF persistence** (`appendonly yes`) — every write is durably logged
- **RDB snapshots** (`save 60 1`) — snapshot every 60s if 1+ key changed

**What happens on restart:**
1. Backend starts → connects to Redis → BullMQ worker connects
2. BullMQ automatically resumes all previously scheduled jobs from Redis
3. Future delayed jobs fire at the correct originally-scheduled time
4. No manual re-queuing needed — PostgreSQL and Redis are the source of truth

**Why emails are not duplicated:**
- Each BullMQ job uses `emailJobId` (UUID) as the BullMQ `jobId`
- BullMQ rejects duplicate job IDs by default
- Additionally, a **Redis SET NX** idempotency key (`processed:{emailJobId}`) is checked at the start of each job — if it already exists, the job is silently skipped

### Rate Limiting & Concurrency

#### Per-Sender Hourly Rate Limit

```
Redis key: rate_limit:{sender_email}:{YYYY-MM-DD-HH}
TTL: 2 hours (auto-cleanup)
```

**Implementation:**
1. On each job: Lua script atomically `INCR` the key and `EXPIRE` (if new)
2. If `count > MAX_EMAILS_PER_HOUR_PER_SENDER`:
   - `DECR` the counter (roll back the increment)
   - Delete the idempotency lock (so the rescheduled job can claim it)
   - Re-enqueue the job to `nextHourWindowStart + 1s` buffer via BullMQ
   - Update `email_jobs.scheduled_at` to reflect new time
   - Throw `UnrecoverableError` so BullMQ doesn't auto-retry this instance

**Safety:** Uses Redis atomic Lua script — safe across multiple workers/instances. No in-memory state.

**No email is dropped:** Rate-limited jobs are simply delayed, not failed.

#### Worker Concurrency

```env
WORKER_CONCURRENCY=5   # processes 5 jobs in parallel
```

Each job also sleeps `MIN_DELAY_BETWEEN_SENDS_MS` (default: 2s) after sending to simulate provider throttling. This is both in the worker logic and enforced at the BullMQ limiter level.

#### Behavior Under 1000+ Emails at the Same Time

1. BullMQ processes `WORKER_CONCURRENCY` jobs at once
2. The rate limiter allows `MAX_EMAILS_PER_HOUR_PER_SENDER` sends per hour per sender
3. When the hourly limit is hit, excess jobs are delayed to the next hour window
4. BullMQ maintains order within each hour window (FIFO for delayed jobs at the same timestamp)
5. No emails are dropped — they all eventually send, just spread across hour windows

---

## 📮 Ethereal Email Setup

**No manual setup needed!** On first start, the backend automatically:

1. Calls `nodemailer.createTestAccount()` — gets a free Ethereal test account
2. Creates a nodemailer transporter using Ethereal's SMTP server
3. Logs the credentials to the console:
   ```
   📧 Ethereal Email test account created:
      User: abc123@ethereal.email
      Pass: xxxxxxxxxx
      Web:  https://ethereal.email
   ```
4. After each email is sent, logs a **preview URL**:
   ```
   📨 Email sent to recipient@example.com [job-id-here]
      Preview: https://ethereal.email/message/xxxxx
   ```

Click the preview URL to see the sent email in Ethereal's web interface!

---

## 🔌 API Reference

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/google` | Redirect to Google OAuth |
| GET | `/api/auth/google/callback` | OAuth callback (redirects to frontend) |
| POST | `/api/auth/google/token` | Exchange Google ID token for JWT (SPA flow) |
| GET | `/api/auth/me` | Get current user (requires auth) |
| POST | `/api/auth/logout` | Logout |

### Emails

All email routes require `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/emails/schedule` | Schedule a new email campaign |
| POST | `/api/emails/parse-csv` | Parse CSV and return email list |
| GET | `/api/emails/scheduled` | List scheduled/pending emails |
| GET | `/api/emails/sent` | List sent/failed emails |
| GET | `/api/emails/campaigns` | List campaigns with stats |
| DELETE | `/api/emails/:id/cancel` | Cancel a scheduled email |
| GET | `/api/emails/rate-limit/:email` | Get rate limit status |
| GET | `/api/health` | Health check |

#### POST /api/emails/schedule

```json
{
  "sender_email": "me@example.com",
  "sender_name": "My Name",
  "subject": "Hello!",
  "body": "<h1>Hi</h1>",
  "recipients": ["a@a.com", "b@b.com"],
  "scheduled_at": "2024-12-01T10:00:00Z",
  "delay_between_emails_ms": 2000,
  "hourly_limit": 200
}
```

Also supports `multipart/form-data` with a `recipients_file` field (CSV/TXT).

---

## ✅ Features Implemented

### Backend
- [x] **Email scheduling** — BullMQ delayed jobs, no cron
- [x] **Persistence** — BullMQ jobs survive restarts (Redis AOF)
- [x] **Idempotency** — Redis SET NX prevents duplicate sends
- [x] **Rate limiting** — Redis atomic INCR per sender per hour, cross-worker safe
- [x] **Auto-reschedule** — Rate-limited jobs delayed to next hour, never dropped
- [x] **Worker concurrency** — Configurable via `WORKER_CONCURRENCY`
- [x] **Min delay between sends** — Configurable `MIN_DELAY_BETWEEN_SENDS_MS`
- [x] **Ethereal SMTP** — Auto-configured test email with preview URLs
- [x] **Google OAuth** — Redirect flow + ID token exchange
- [x] **JWT auth** — Stateless bearer token auth
- [x] **CSV parsing** — Server-side email extraction from uploaded files
- [x] **Graceful shutdown** — Worker drains before process exit
- [x] **DB migrations** — Auto-run on startup
- [x] **Health check** — DB + Redis status endpoint

### Frontend
- [x] **Google OAuth login** — Real OAuth redirect flow
- [x] **Protected routes** — Auto-redirect to login if unauthenticated
- [x] **User profile** — Name, email, avatar in header dropdown
- [x] **Logout** — Clears token and redirects
- [x] **Dashboard** — Stats cards + tabbed email tables
- [x] **Compose modal** — CSV upload, manual emails, scheduling config
- [x] **CSV drag & drop** — Drop CSV file to parse recipients
- [x] **Scheduled emails table** — With cancel action
- [x] **Sent emails table** — With Ethereal preview links
- [x] **Loading states** — Skeleton tables while fetching
- [x] **Empty states** — With illustrated icons
- [x] **Auto-refresh** — Every 30 seconds
- [x] **Error toasts** — react-hot-toast notifications
- [x] **Pagination** — Page controls on all tables
- [x] **Dark mode** — Full dark UI with glassmorphism

---

## ⚙️ Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CONCURRENCY` | `5` | BullMQ worker concurrency |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` | Min ms between email sends |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hourly rate limit per sender |
| `JWT_EXPIRES_IN` | `7d` | JWT token TTL |

---

## 🔧 Assumptions & Trade-offs

1. **Idempotency key TTL**: 48 hours. After 48h, Redis memory is reclaimed. Jobs older than 48h that somehow re-run would re-send — acceptable for a scheduler since jobs typically complete quickly.

2. **Rate limit rescheduling**: When the hourly limit is hit, all excess jobs are delayed to `nextHourStart + 1s`. This means they all compete in the next window, not precisely ordered by their original schedule. A more complex priority queue could preserve order across windows, but adds significant complexity.

3. **BullMQ `removeOnComplete`**: Completed jobs are kept in Redis for 7 days (max 500). This allows inspecting the queue but uses some Redis memory. Adjust `removeOnComplete` for production.

4. **Ethereal Email**: Auto-generates a test account per process startup. In production, replace with a real SMTP provider (SendGrid, SES, Postmark, etc.) by changing the `emailSender.ts` transporter.

5. **No WebSockets**: Dashboard auto-refreshes every 30s via polling. For production, add Server-Sent Events or WebSocket support for real-time updates.

6. **CSV parsing**: Uses regex email extraction — works for most formats (comma-separated, newline-separated, CSV with headers). Does not validate deliverability.
