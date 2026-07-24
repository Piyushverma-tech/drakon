import { celestrakProvider } from './celestrak';
import { spacetrackProvider } from './spacetrack';
import { mockProvider } from './mock';
import type { TLEProvider } from './types';

export * from './types';
export { celestrakProvider } from './celestrak';
export { spacetrackProvider, extractSessionCookie } from './spacetrack';
export { mockProvider } from './mock';

// TLE_PROVIDER is unset (defaults to CelesTrak) until Phase 2 cutover —
// see the migration plan §12. Shadow mode (Phase 1) does not read this;
// it calls spacetrackProvider directly alongside the unchanged CelesTrak
// path, regardless of this env var.
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
