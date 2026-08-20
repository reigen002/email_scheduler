import Redis from 'ioredis';
import { config } from './index';

let redisClient: Redis | null = null;

function sanitizeRedisUrl(urlStr: string): string {
  let cleaned = (urlStr || '').trim();
  if (cleaned.startsWith('//')) {
    cleaned = 'rediss:' + cleaned;
  }
  return cleaned;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    const rawUrl = sanitizeRedisUrl(config.REDIS_URL);
    const isTls = rawUrl.startsWith('rediss://') || rawUrl.includes('upstash.io');
    redisClient = new Redis(rawUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: false,
      tls: isTls ? { rejectUnauthorized: false } : undefined,
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redisClient.on('error', (err: Error) => {
      console.error('❌ Redis error:', err.message);
    });

    redisClient.on('close', () => {
      console.warn('⚠️  Redis connection closed');
    });
  }

  return redisClient;
}

/**
 * Creates a separate Redis connection for BullMQ workers/queues.
 * BullMQ recommends separate connections for queue and worker.
 */
export function createRedisConnection(): Redis {
  const rawUrl = sanitizeRedisUrl(config.REDIS_URL);
  const isTls = rawUrl.startsWith('rediss://') || rawUrl.includes('upstash.io');
  return new Redis(rawUrl, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    tls: isTls ? { rejectUnauthorized: false } : undefined,
  });
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
