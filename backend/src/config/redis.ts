import Redis from 'ioredis';
import { config } from './index';

let redisClient: Redis | null = null;

function sanitizeRedisUrl(urlStr: string): string {
  if (!urlStr) return 'redis://localhost:6379';
  let cleaned = urlStr.trim().replace(/^["']|["']$/g, '');
  if (cleaned.includes('-u ')) {
    cleaned = cleaned.split('-u ').pop()!.trim();
  }
  cleaned = cleaned.replace(/^redis-cli\s+/, '');
  if (cleaned.startsWith('//')) {
    cleaned = 'rediss:' + cleaned;
  } else if (cleaned.startsWith('redis://') && (cleaned.includes('upstash.io') || cleaned.includes('.cloud'))) {
    cleaned = cleaned.replace('redis://', 'rediss://');
  } else if (!cleaned.startsWith('redis://') && !cleaned.startsWith('rediss://')) {
    cleaned = 'rediss://' + cleaned.replace(/^(rediss?:?\/*)?/, '');
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
