/**
 * Verifies resolveReentryRiskViaComputeEngine's timeout actually fires,
 * using a deliberately slow local HTTP server rather than trusting the
 * AbortController wiring by inspection. Self-contained (no BACKEND_URL to
 * a real compute engine needed), so this runs as part of the default
 * suite, unlike reentryComputeClient.e2e.test.ts.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveReentryRiskViaComputeEngine } from './reentryComputeClient';
import type { TleEntry } from './types';

function makeEntry(): TleEntry {
  return {
    id: 40001,
    name: 'TIMEOUT TEST',
    operator: 'TEST',
    l1: ' '.repeat(53) + '50000-6 ',
    l2: '2 40001  51.6000 000.0000 0000000 000.0000 000.0000 16.00000000',
    inclination: 51.6,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 16,
    meanMotionDot: 0.00002182,
    ecc: 0,
    perigeeKm: 400,
    apogeeKm: 420,
    semiMajorAxisKm: 6778,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: false,
  };
}

const SLOW_RESPONSE_DELAY_MS = 1500;

function validReentryResponseBody() {
  return JSON.stringify({
    result: {
      satId: 40001,
      bstar: 5e-7,
      meanMotionDot: 0.00002182,
      signalsAgree: false,
      confidence: 'low',
      perigeeKm: 400,
      decayAltKm: 400,
      decayRateKmPerDay: 0,
      estimatedDaysRemaining: null,
      tier: 'stable',
      source: 'single_epoch',
    },
    model: {
      id: 'reentry_resolution',
      version: '0.1.0',
      parameterSet: 'reentry-2026-09-baseline',
      calibrationVersion: null,
    },
    engine: { version: '0.1.0' },
  });
}

describe('resolveReentryRiskViaComputeEngine — timeout', () => {
  let server: http.Server;
  let originalBackendUrl: string | undefined;

  beforeAll(async () => {
    originalBackendUrl = process.env.BACKEND_URL;
    server = http.createServer((_req, res) => {
      // Deliberately never responds within any of this suite's timeoutMs
      // values, so a client without a timeout would hang until this fires.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(validReentryResponseBody());
      }, SLOW_RESPONSE_DELAY_MS);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    process.env.BACKEND_URL = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    process.env.BACKEND_URL = originalBackendUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('throws ComputeEngineError(code=TIMEOUT) well before the slow server responds', async () => {
    const start = Date.now();
    await expect(
      resolveReentryRiskViaComputeEngine(makeEntry(), undefined, 1, { timeoutMs: 200 })
    ).rejects.toMatchObject({ name: 'ComputeEngineError', code: 'TIMEOUT' });
    const elapsed = Date.now() - start;
    // Real proof the abort fired on schedule, not that the promise merely
    // rejected eventually for some other reason.
    expect(elapsed).toBeLessThan(SLOW_RESPONSE_DELAY_MS - 200);
  });

  it('succeeds when timeoutMs comfortably exceeds the server delay', async () => {
    const response = await resolveReentryRiskViaComputeEngine(makeEntry(), undefined, 1, {
      timeoutMs: SLOW_RESPONSE_DELAY_MS + 2000,
    });
    expect(response.result.tier).toBe('stable');
    expect(response.model.id).toBe('reentry_resolution');
  }, SLOW_RESPONSE_DELAY_MS + 3000);

  it('with no timeoutMs at all, waits for the slow response rather than failing early', async () => {
    const response = await resolveReentryRiskViaComputeEngine(makeEntry(), undefined, 1);
    expect(response.result.tier).toBe('stable');
  }, SLOW_RESPONSE_DELAY_MS + 3000);
});
