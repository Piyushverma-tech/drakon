import { celestrakProvider } from './celestrak';
import { spacetrackProvider } from './spacetrack';
import { mockProvider } from './mock';
import type { TLEProvider } from './types';

export * from './types';
export { celestrakProvider } from './celestrak';
export { spacetrackProvider, extractSessionCookie } from './spacetrack';
export { mockProvider } from './mock';

// Default to Space-Track as primary, CelesTrak as fallback
export function getPrimaryProvider(): TLEProvider {
  return process.env.TLE_PROVIDER === 'celestrak'
    ? celestrakProvider
    : spacetrackProvider;
}

export function getFallbackProvider(): TLEProvider {
  return getPrimaryProvider().name === 'spacetrack'
    ? celestrakProvider
    : spacetrackProvider;
}

export const providers = {
  celestrak: celestrakProvider,
  spacetrack: spacetrackProvider,
  mock: mockProvider,
} as const;
