import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config';
import { getPool } from './config/database';
import { getRedisClient, closeRedisClient } from './config/redis';
import { runMigrations } from './db/migrations';
import { startEmailWorker, stopEmailWorker } from './queues/emailWorker';
import { closeEmailQueue } from './queues/emailQueue';
import authRouter from './routes/auth';
import emailsRouter from './routes/emails';
import { recoverPendingEmails } from './services/schedulerService';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: [config.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (simple)
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const redis = getRedisClient();

    const [dbResult, redisResult] = await Promise.allSettled([
      pool.query('SELECT 1'),
      redis.ping(),
    ]);

    const dbOk = dbResult.status === 'fulfilled';
    const redisOk = redisResult.status === 'fulfilled' && redisResult.value === 'PONG';

    const status = dbOk && redisOk ? 'healthy' : 'degraded';
    res.status(dbOk && redisOk ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'up' : 'down',
        redis: redisOk ? 'up' : 'down',
      },
    });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: String(err) });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/emails', emailsRouter);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log('🚀 Starting Email Scheduler Service...\n');

  // 1. Run database migrations
  console.log('📦 Running database migrations...');
  await runMigrations();

  // 2. Verify Redis connection
  console.log('🔗 Connecting to Redis...');
  const redis = getRedisClient();
  await redis.ping();

  await recoverPendingEmails();
  let recovering = false;
  const recoveryTimer = setInterval(async () => {
    if (recovering) return;
    recovering = true;
    try { await recoverPendingEmails(); }
    catch (error) { console.error('Queue recovery failed:', error); }
    finally { recovering = false; }
  }, 30000);

  // 3. Start BullMQ worker
  console.log('⚡ Starting BullMQ worker...');
  startEmailWorker();

  // 4. Start HTTP server
  const server = app.listen(config.PORT, () => {
    console.log(`\n✅ Email Scheduler running on http://localhost:${config.PORT}`);
    console.log(`   Environment: ${config.NODE_ENV}`);
    console.log(`   Worker concurrency: ${config.WORKER_CONCURRENCY}`);
    console.log(`   Min delay between sends: ${config.MIN_DELAY_BETWEEN_SENDS_MS}ms`);
    console.log(`   Max emails/hour/sender: ${config.MAX_EMAILS_PER_HOUR_PER_SENDER}`);
    console.log(`   Frontend URL: ${config.FRONTEND_URL}\n`);
  });

  // ─── Graceful Shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n⚠️  Received ${signal}. Shutting down gracefully...`);
    clearInterval(recoveryTimer);

    server.close(async () => {
      console.log('  HTTP server closed');
      await stopEmailWorker();
      await closeEmailQueue();
      await closeRedisClient();
      await getPool().end();
      console.log('✅ Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit after 30s
    setTimeout(() => {
      console.error('⏱️  Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err: Error) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});

export default app;
