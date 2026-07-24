import {
  getPrimaryProvider,
  getFallbackProvider,
  celestrakProvider,
  spacetrackProvider,
} from './index';

describe('provider selection', () => {
  const original = process.env.TLE_PROVIDER;

  afterEach(() => {
    process.env.TLE_PROVIDER = original;
  });

  it('defaults to Space-Track as primary, CelesTrak as fallback', () => {
    delete process.env.TLE_PROVIDER;
    expect(getPrimaryProvider()).toBe(spacetrackProvider);
    expect(getFallbackProvider()).toBe(celestrakProvider);
  });

  it('flips to CelesTrak primary when TLE_PROVIDER=celestrak', () => {
    process.env.TLE_PROVIDER = 'celestrak';
    expect(getPrimaryProvider()).toBe(celestrakProvider);
    expect(getFallbackProvider()).toBe(spacetrackProvider);
  });
});
