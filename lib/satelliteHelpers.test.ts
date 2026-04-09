import {
  classifyOrbit,
  formatDistance,
  getOrbitType,
  parseBSTAR,
} from "./satelliteHelpers";

describe("satelliteHelpers", () => {
  describe("formatDistance", () => {
    it("formats kilometers with two decimals for values >= 1km", () => {
      expect(formatDistance(12.3456)).toBe("12.35 km");
    });

    it("formats meters for sub-kilometer values and clamps negatives", () => {
      expect(formatDistance(0.75)).toBe("750 m");
      expect(formatDistance(-0.2)).toBe("0 m");
    });
  });

  describe("classifyOrbit", () => {
    it("classifies near-90 inclination as Polar", () => {
      expect(classifyOrbit(89)).toBe("Polar");
    });

    it("classifies low inclination as Equatorial", () => {
      expect(classifyOrbit(3)).toBe("Equatorial");
    });
  });

  describe("getOrbitType", () => {
    it("returns Debris when debris flag is set", () => {
      expect(getOrbitType(15, true)).toBe("Debris");
    });

    it("classifies by mean-motion-derived orbital period", () => {
      expect(getOrbitType(15)).toBe("LEO");
      expect(getOrbitType(2)).toBe("MEO");
      expect(getOrbitType(1)).toBe("GEO");
    });
  });

  describe("parseBSTAR", () => {
    it("returns zero for empty/default-like BSTAR fields", () => {
      expect(parseBSTAR("")).toBe(0);
      expect(parseBSTAR(" ".repeat(53) + "00000-0" + " ".repeat(8))).toBe(0);
    });

    it("parses signed BSTAR mantissa and exponent", () => {
      const line1Positive = " ".repeat(53) + "34176-4" + " ".repeat(8);
      const line1Negative = " ".repeat(53) + "-12345-5" + " ".repeat(8);

      expect(parseBSTAR(line1Positive)).toBeCloseTo(3.4176e-5, 10);
      expect(parseBSTAR(line1Negative)).toBeCloseTo(-1.2345e-6, 10);
    });
  });
});
