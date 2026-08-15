import {
  classifyOrbit,
  formatDistance,
  getReentryRisk,
  getOrbitType,
  parseMeanMotionDot,
  parseTLEMeta,
  parseBSTAR,
} from './satelliteHelpers';
import type { TleEntry } from './types';

function makeEntry(overrides: Partial<TleEntry> = {}): TleEntry {
  return {
    id: 12345,
    name: 'TEST DEB',
    operator: 'TEST',
    l1: ' '.repeat(53) + '50000-6' + ' '.repeat(8),
    l2: '2 12345  51.6000 000.0000 0000000 000.0000 000.0000 16.00000000',
    inclination: 51.6,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
    meanMotion: 16,
    meanMotionDot: 0.00002182,
    ecc: 0,
    perigeeKm: 415,
    apogeeKm: 415,
    semiMajorAxisKm: 6793.137,
    tleEpoch: '2026-01-01T00:00:00.000Z',
    isDebris: true,
    ...overrides,
  };
}

function line1WithBstar(bstarField: string): string {
  return ' '.repeat(53) + bstarField + ' '.repeat(8);
}

describe('satelliteHelpers', () => {
  describe('formatDistance', () => {
    it('formats kilometers with two decimals for values >= 1km', () => {
      expect(formatDistance(12.3456)).toBe('12.35 km');
    });

    it('formats meters for sub-kilometer values and clamps negatives', () => {
      expect(formatDistance(0.75)).toBe('750 m');
      expect(formatDistance(-0.2)).toBe('0 m');
    });
  });

  describe('classifyOrbit', () => {
    it('classifies near-90 inclination as Polar', () => {
      expect(classifyOrbit(89)).toBe('Polar');
    });

    it('classifies low inclination as Equatorial', () => {
      expect(classifyOrbit(3)).toBe('Equatorial');
    });
  });

  describe('getOrbitType', () => {
    it('returns Debris when debris flag is set', () => {
      expect(getOrbitType(15, true)).toBe('Debris');
    });

    it('classifies by mean-motion-derived orbital period', () => {
      expect(getOrbitType(15)).toBe('LEO');
      expect(getOrbitType(2)).toBe('MEO');
      expect(getOrbitType(1)).toBe('GEO');
    });
  });

  describe('parseBSTAR', () => {
    it('returns zero for empty/default-like BSTAR fields', () => {
      expect(parseBSTAR('')).toBe(0);
      expect(parseBSTAR(' '.repeat(53) + '00000-0' + ' '.repeat(8))).toBe(0);
    });

    it('parses signed BSTAR mantissa and exponent', () => {
      const line1Positive = ' '.repeat(53) + '34176-4' + ' '.repeat(8);
      const line1Negative = ' '.repeat(53) + '-12345-5' + ' '.repeat(8);

      expect(parseBSTAR(line1Positive)).toBeCloseTo(3.4176e-5, 10);
      expect(parseBSTAR(line1Negative)).toBeCloseTo(-1.2345e-6, 10);
    });
  });

  describe('parseMeanMotionDot', () => {
    it('parses signed decimal mean motion derivative from TLE line 1', () => {
      const line1Positive = ' '.repeat(33) + ' .00002182' + ' '.repeat(40);
      const line1Negative = ' '.repeat(33) + '-.00012345' + ' '.repeat(40);

      expect(parseMeanMotionDot(line1Positive)).toBeCloseTo(0.00002182, 12);
      expect(parseMeanMotionDot(line1Negative)).toBeCloseTo(-0.00012345, 12);
    });

    it('returns zero for missing or malformed mean motion derivative fields', () => {
      expect(parseMeanMotionDot('')).toBe(0);
      expect(parseMeanMotionDot(' '.repeat(33) + 'not-a-num')).toBe(0);
    });
  });

  describe('parseTLEMeta', () => {
    it('includes meanMotionDot with the existing parsed metadata', () => {
      const l1 =
        '1 25544U 98067A   24001.50000000  .00002182  00000-0  15519-4 0  9993';
      const l2 =
        '2 25544  51.6391  62.1234 0007417  33.1234  88.1234 15.50000000';

      expect(parseTLEMeta(l1, l2)).toEqual(
        expect.objectContaining({
          inclination: 51.6391,
          raan: 62.1234,
          argPerigee: 33.1234,
          meanAnomaly: 88.1234,
          meanMotion: 15.5,
          meanMotionDot: 0.00002182,
          semiMajorAxisKm: expect.any(Number),
        })
      );
    });
  });

  describe('getReentryRisk', () => {
    it('does not suppress physically fast terminal decay below 180km', () => {
      const risk = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('50000-4'),
          perigeeKm: 150,
          apogeeKm: 150,
        }),
        150
      );

      expect(risk.decayRateKmPerDay).toBeGreaterThan(20);
      expect(risk.tier).toBe('critical');
      expect(risk.confidence).toBe('high');
      expect(risk.signalsAgree).toBe(true);
      expect(risk.estimatedDaysRemaining).toBe(1);
    });

    it('does not flag typical mid-altitude catalog BSTAR as imminent re-entry', () => {
      const risk = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('12255-4'),
          meanMotionDot: 0.00002883,
          perigeeKm: 455.93,
          apogeeKm: 540,
        }),
        499
      );

      expect(risk.decayRateKmPerDay).toBeLessThan(1);
      expect(risk.tier).toBe('stable');
      expect(risk.signalsAgree).toBe(false);
    });

    it('rejects implausible mid-LEO BSTAR drag rates via altitude-scaled cap', () => {
      const risk = getReentryRisk(
        makeEntry({ l1: line1WithBstar('50000-2') }),
        400
      );

      expect(risk.decayRateKmPerDay).toBe(0);
      expect(risk.tier).toBe('stable');
    });

    it('returns stable for active payloads — single-epoch BSTAR is not reliable', () => {
      const risk = getReentryRisk(
        makeEntry({
          name: 'STARLINK-1494',
          isDebris: false,
        }),
        218
      );

      expect(risk.tier).toBe('stable');
    });

    it('returns stable for R/B objects not classified as debris upstream', () => {
      const risk = getReentryRisk(
        makeEntry({
          name: 'TEST R/B',
          isDebris: false,
        }),
        150
      );

      expect(risk.tier).toBe('stable');
    });

    it('still screens rocket bodies that were classified as debris upstream', () => {
      const risk = getReentryRisk(
        makeEntry({
          name: 'TEST R/B',
          isDebris: true,
          l1: line1WithBstar('50000-4'),
          perigeeKm: 150,
          apogeeKm: 150,
        }),
        150
      );

      expect(risk.tier).toBe('critical');
      expect(risk.estimatedDaysRemaining).not.toBeNull();
    });

    it('flags strong but plausible drag at mid-LEO as critical', () => {
      const risk = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('20000-4'),
          perigeeKm: 150,
          apogeeKm: 150,
          meanMotionDot: 0.00005,
        }),
        250
      );

      expect(risk.estimatedDaysRemaining).not.toBeNull();
      expect(risk.estimatedDaysRemaining!).toBeLessThan(30);
      expect(risk.tier).toBe('critical');
    });

    it('assigns nominal tier for moderate mid-LEO decay horizons', () => {
      const risk = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('60000-5'),
          perigeeKm: 220,
          apogeeKm: 220,
          meanMotionDot: 0.00005,
        }),
        300
      );

      expect(risk.estimatedDaysRemaining).not.toBeNull();
      expect(risk.estimatedDaysRemaining!).toBeGreaterThan(30);
      expect(risk.estimatedDaysRemaining!).toBeLessThan(365);
      expect(risk.tier).toBe('nominal');
    });

    it('downgrades long mid-LEO estimates to stable', () => {
      const risk = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('20400-5'),
          perigeeKm: 320,
          apogeeKm: 320,
        }),
        400
      );

      // Horizons beyond the 10-year linear gate (or above the altitude-aware
      // nominal threshold) collapse to stable with no day estimate.
      expect(risk.tier).toBe('stable');
      expect(
        risk.estimatedDaysRemaining === null ||
          risk.estimatedDaysRemaining! >= 180
      ).toBe(true);
    });

    it('rejects implausible drag rates at high altitude via scaled cap', () => {
      const risk = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('20300-1'),
          meanMotionDot: 0,
        }),
        800
      );

      expect(risk.decayRateKmPerDay).toBe(0);
      expect(risk.tier).toBe('stable');
      expect(risk.confidence).toBe('low');
    });

    it('requires stronger meanMotionDot at higher altitude for agreement', () => {
      const lowAlt = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('10000-3'),
          meanMotionDot: 0.00002,
          perigeeKm: 200,
          apogeeKm: 200,
        }),
        350
      );
      const highAlt = getReentryRisk(
        makeEntry({
          l1: line1WithBstar('10000-3'),
          meanMotionDot: 0.00002,
          perigeeKm: 200,
          apogeeKm: 200,
        }),
        550
      );

      expect(lowAlt.signalsAgree).toBe(true);
      expect(highAlt.signalsAgree).toBe(false);
    });
  });
});
