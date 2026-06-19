import {
  CALIBRATION_MULTIPLIER,
  F107_CALIBRATION,
  pickDailyF107,
  solarFluxMultiplierFromF107,
} from './solarFlux';
import { altitudeBasedReentryEstimate } from './satelliteHelpers';

describe('solarFlux', () => {
  it('preserves the legacy hardcoded multiplier at calibration flux', () => {
    expect(solarFluxMultiplierFromF107(F107_CALIBRATION)).toBeCloseTo(
      CALIBRATION_MULTIPLIER,
      10
    );
    expect(CALIBRATION_MULTIPLIER).toBeCloseTo(Math.pow(200 / 150, 1.5), 10);
  });

  it('does not collapse decay rates for observed flux well below calibration', () => {
    const observed = 125.69;
    const observedMultiplier = solarFluxMultiplierFromF107(observed);

    expect(observedMultiplier).toBeGreaterThan(1.3);
    expect(observedMultiplier / CALIBRATION_MULTIPLIER).toBeGreaterThan(0.85);
  });

  it('prefers the noon daily observation from NOAA JSON', () => {
    const f107 = pickDailyF107([
      {
        time_tag: '2026-06-19T17:00:00',
        flux: 110,
        reporting_schedule: 'Morning',
      },
      {
        time_tag: '2026-06-18T20:00:00',
        flux: 111,
        reporting_schedule: 'Noon',
      },
    ]);

    expect(f107).toBe(111);
  });

  it('keeps low-perigee lifetime estimates near the calibrated baseline', () => {
    const perigeeKm = 172;
    const calibrated = altitudeBasedReentryEstimate(
      perigeeKm,
      CALIBRATION_MULTIPLIER
    );
    const observed = altitudeBasedReentryEstimate(
      perigeeKm,
      solarFluxMultiplierFromF107(125.69)
    );

    expect(calibrated.decayRateKmPerDay).toBeCloseTo(33.75, 0);
    expect(observed.decayRateKmPerDay).toBeGreaterThan(28);
    expect(observed.estimatedDaysRemaining).toBeLessThanOrEqual(3);
    expect(observed.estimatedDaysRemaining).toBeGreaterThanOrEqual(1);
  });
});
