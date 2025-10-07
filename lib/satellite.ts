import * as satellite from 'satellite.js';

export type PropagatedPosition = {
  lat: number;
  lon: number;
  altKm: number;
};

export function positionFromTLE(
  tleLine1: string,
  tleLine2: string,
  date: Date = new Date()
): PropagatedPosition {
  const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
  const gmst = satellite.gstime(date);
  const eci = satellite.propagate(satrec, date);
  if (!eci.position) throw new Error('propagation failed');
  const geodetic = satellite.eciToGeodetic(eci.position, gmst);
  const longitude = satellite.degreesLong(geodetic.longitude);
  const latitude = satellite.degreesLat(geodetic.latitude);
  const altitudeKm = geodetic.height;
  return { lat: latitude, lon: longitude, altKm: altitudeKm };
}

export function tleToLatLonAlt(l1: string, l2: string) {
  const satrec = satellite.twoline2satrec(l1, l2);
  const now = new Date();
  const positionAndVelocity = satellite.propagate(satrec, now);
  if (!positionAndVelocity) {
    // Handle the case when positionAndVelocity is null
    return null;
  }
  const positionGd = satellite.eciToGeodetic(
    positionAndVelocity.position!,
    satellite.gstime(now)
  );

  const lat = (positionGd.latitude * 180) / Math.PI;
  const lon = (positionGd.longitude * 180) / Math.PI;
  const alt = positionGd.height;

  return { lat, lon, alt };
}

export function satrecFromTLE(tle1: string, tle2: string) {
  return satellite.twoline2satrec(tle1, tle2);
}
