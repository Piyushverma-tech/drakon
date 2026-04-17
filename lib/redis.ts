import Redis from 'ioredis';

// Prevent multiple connections in development due to hot-reloading
// In production, each serverless invocation gets its own connection
declare global {
  var __redis: Redis | undefined;
}

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error('REDIS_URL environment variable is not set');
  }

  const client = new Redis(url, {
    // Retry connection up to 3 times before giving up
    maxRetriesPerRequest: 3,
    // Don't crash the process on connection errors — just log them
    enableReadyCheck: false,
    lazyConnect: false,
  });

  client.on('error', (err) => {
    // Log but don't throw — the API route will fall back to Celestrak
    console.warn('[Redis] Connection error:', err.message);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected');
  });

  return client;
}

// In development, reuse the same connection across hot-reloads
// In production, create a new one per module load
const redis = global.__redis ?? createRedisClient();

if (process.env.NODE_ENV === 'development') {
  global.__redis = redis;
}

export default redis;
