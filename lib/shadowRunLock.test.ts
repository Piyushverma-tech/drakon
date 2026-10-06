jest.mock('./redis', () => ({
  __esModule: true,
  default: { set: jest.fn() },
}));

import redis from './redis';
import { acquireShadowRunLock } from './shadowRunLock';

describe('acquireShadowRunLock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true and passes NX/EX when the lock is free', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');

    const acquired = await acquireShadowRunLock('locks:test', 3000);

    expect(acquired).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, , options] = (redis.set as jest.Mock).mock.calls[0];
    expect(key).toBe('locks:test');
    expect(options).toEqual({ nx: true, ex: 3000 });
  });

  it('returns false when another invocation already holds the lock', async () => {
    // Redis SET NX returns null when the key already exists -- this is
    // the actual contended-lock case, not an error.
    (redis.set as jest.Mock).mockResolvedValue(null);

    const acquired = await acquireShadowRunLock('locks:test', 3000);

    expect(acquired).toBe(false);
  });

  it('fails open (returns true) if Redis itself errors', async () => {
    (redis.set as jest.Mock).mockRejectedValue(new Error('connection refused'));

    const acquired = await acquireShadowRunLock('locks:test', 3000);

    expect(acquired).toBe(true);
  });

  it('uses the exact key and TTL passed in, not a hardcoded default', async () => {
    (redis.set as jest.Mock).mockResolvedValue('OK');

    await acquireShadowRunLock('locks:another-key', 1234);

    const [key, , options] = (redis.set as jest.Mock).mock.calls[0];
    expect(key).toBe('locks:another-key');
    expect(options).toEqual({ nx: true, ex: 1234 });
  });
});
