import { getRedisClient } from '../config/redis';
import { config } from '../config';

const RATE_LIMIT_KEY_PREFIX = 'rate_limit';
const RATE_LIMIT_TTL_SECONDS = 7200; // 2 hours to ensure the next-hour window is covered

/**
 * Get the current hour window key for rate limiting.
 * Format: rate_limit:{sender}:{YYYY-MM-DD-HH}
 */
function getRateLimitKey(senderEmail: string, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${RATE_LIMIT_KEY_PREFIX}:${senderEmail}:${year}-${month}-${day}-${hour}`;
}

/**
 * Get the start of the next hour window in ms.
 */
export function getNextHourWindowMs(date: Date = new Date()): number {
  const next = new Date(date);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime();
}

/**
 * Get current count for a sender in the current hour window.
 */
export async function getCurrentHourCount(senderEmail: string): Promise<number> {
  const redis = getRedisClient();
  const key = getRateLimitKey(senderEmail);
  const count = await redis.get(key);
  return count ? parseInt(count, 10) : 0;
}

/**
 * Atomically check and increment the rate limit counter.
 * Returns:
 *   - { allowed: true, count } if under the limit
 *   - { allowed: false, nextWindowMs } if limit exceeded
 *
 * This is safe across multiple workers because Redis INCR is atomic.
 * Key expires after RATE_LIMIT_TTL_SECONDS to auto-cleanup.
 */
export async function checkAndIncrementRateLimit(
  senderEmail: string,
  maxPerHour: number = config.MAX_EMAILS_PER_HOUR_PER_SENDER
): Promise<{ allowed: boolean; count: number; nextWindowMs?: number }> {
  const redis = getRedisClient();
  const key = getRateLimitKey(senderEmail);

  // Atomic increment using a Lua script to ensure check-and-increment atomicity
  const luaScript = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return current
  `;

  const count = (await redis.eval(luaScript, 1, key, RATE_LIMIT_TTL_SECONDS)) as number;

  if (count > maxPerHour) {
    // Roll back the increment since we won't send this email now
    await redis.decr(key);

    const nextWindowMs = getNextHourWindowMs();
    return { allowed: false, count: count - 1, nextWindowMs };
  }

  return { allowed: true, count };
}

/**
 * Decrement rate limit counter (used on job failure to not count failed sends).
 */
export async function decrementRateLimit(senderEmail: string): Promise<void> {
  const redis = getRedisClient();
  const key = getRateLimitKey(senderEmail);
  const current = await redis.get(key);
  if (current && parseInt(current, 10) > 0) {
    await redis.decr(key);
  }
}

/**
 * Get rate limit status for display in the API.
 */
export async function getRateLimitStatus(senderEmail: string): Promise<{
  currentCount: number;
  maxPerHour: number;
  remaining: number;
  resetsAt: Date;
}> {
  const currentCount = await getCurrentHourCount(senderEmail);
  const maxPerHour = config.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const resetsAt = new Date(getNextHourWindowMs());

  return {
    currentCount,
    maxPerHour,
    remaining: Math.max(0, maxPerHour - currentCount),
    resetsAt,
  };
}
