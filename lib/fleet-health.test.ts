jest.mock("./satelliteWorker", () => ({
  positionFromTLEAsync: jest.fn(),
}));

import {
  aggregateFleetHealth,
  distanceKm,
  orbitClassFromAlt,
  type SatelliteHealth,
} from "./fleet-health";

describe("fleet-health", () => {
  describe("distanceKm", () => {
    it("returns 0 for identical positions", () => {
      const pos = { lat: 10, lon: 20, altKm: 550 };
      expect(distanceKm(pos, pos)).toBeCloseTo(0, 10);
    });

    it("is symmetric for two different points", () => {
      const a = { lat: 0, lon: 0, altKm: 500 };
      const b = { lat: 0, lon: 1, altKm: 500 };
      expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 10);
    });
  });

  describe("orbitClassFromAlt", () => {
    it("classifies altitude bands and debris override", () => {
      expect(orbitClassFromAlt(500)).toBe("LEO");
      expect(orbitClassFromAlt(1500)).toBe("MEO");
      expect(orbitClassFromAlt(35000)).toBe("GEO");
      expect(orbitClassFromAlt(500, true)).toBe("Debris");
    });
  });

  describe("aggregateFleetHealth", () => {
    it("computes counts and health percentage", () => {
      const statuses: SatelliteHealth[] = [
        {
          id: 1,
          name: "A",
          status: "Healthy",
          deviationKm: 0.1,
          ageSec: 60,
          reason: "ok",
          orbitClass: "LEO",
          predicted: { lat: 0, lon: 0, altKm: 500 },
          observed: { lat: 0, lon: 0, altKm: 500 },
        },
        {
          id: 2,
          name: "B",
          status: "Warning",
          deviationKm: 5,
          ageSec: 700,
          reason: "stale_warning",
          orbitClass: "LEO",
          predicted: { lat: 0, lon: 0, altKm: 500 },
          observed: { lat: 0, lon: 0, altKm: 500 },
        },
        {
          id: 3,
          name: "C",
          status: "Critical",
          deviationKm: 40,
          ageSec: 5000,
          reason: "large_deviation",
          orbitClass: "MEO",
          predicted: { lat: 0, lon: 0, altKm: 2000 },
          observed: { lat: 0, lon: 0, altKm: 2000 },
        },
      ];

      expect(aggregateFleetHealth(statuses)).toEqual({
        total: 3,
        healthy: 1,
        warning: 1,
        critical: 1,
        healthPercent: (1 / 3) * 100,
      });
    });

    it("returns zeros for empty input", () => {
      expect(aggregateFleetHealth([])).toEqual({
        total: 0,
        healthy: 0,
        warning: 0,
        critical: 0,
        healthPercent: 0,
      });
    });
  });
});
