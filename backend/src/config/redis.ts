import Redis from 'ioredis';
import { config } from './index';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      lazyConnect: false,
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
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  });
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
