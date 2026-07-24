import type { TLEProvider, TleFetchResult } from './types';

// Deterministic fixture that always includes one Alpha-5 object, so the
// decode path is exercised in tests/CI without depending on either live API.
const FIXTURES = {
  standard: `ISS (ZARYA)\n1 25544U 98067A   26199.50000000  .00016717  00000-0  10270-3 0  9994\n2 25544  51.6400 208.9163 0007540  69.9862  25.2906 15.49560000123456\n`,
  alpha5: `SARAMAGO\n1 A0000U 26089A   26195.90649229  .00004770  00000-0  22159-3 0  9994\n2 A0000  97.4593 154.0970 0005590 270.5113  89.5482 15.20467281 15911\n`,
};

export const mockProvider: TLEProvider = {
  name: 'mock',
  async fetch(): Promise<TleFetchResult> {
    const raw = FIXTURES.standard + FIXTURES.alpha5;
    return { raw, provider: 'mock', fetchedAt: new Date(), objectCount: 2 };
  },
};
