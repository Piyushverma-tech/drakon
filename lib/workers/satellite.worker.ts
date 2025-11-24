import * as Comlink from 'comlink';
import * as satellite from 'satellite.js';

export type PropagatedPosition = {
  lat: number;
  lon: number;
  altKm: number;
};

function positionFromTLE(
  tleLine1: string,
  tleLine2: string,
  dateIso?: string
): PropagatedPosition {
  const date = dateIso ? new Date(dateIso) : new Date();
  const satrec = satellite.twoline2satrec(tleLine1, tleLine2);
  const gmst = satellite.gstime(date);
  const eci = satellite.propagate(satrec, date);

  if (!eci || !eci.position) {
    return { lat: 0, lon: 0, altKm: 0 };
  }

  const geodetic = satellite.eciToGeodetic(eci.position, gmst);
  const longitude = satellite.degreesLong(geodetic.longitude);
  const latitude = satellite.degreesLat(geodetic.latitude);
  const altitudeKm = geodetic.height;
  return { lat: latitude, lon: longitude, altKm: altitudeKm };
}

function tleToLatLonAlt(l1: string, l2: string) {
  const satrec = satellite.twoline2satrec(l1, l2);
  const now = new Date();
  const positionAndVelocity = satellite.propagate(satrec, now);
  if (!positionAndVelocity) {
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

function satrecFromTLE(tle1: string, tle2: string) {
  return satellite.twoline2satrec(tle1, tle2);
}

async function batchPositionFromTLE(
  items: Array<{ l1: string; l2: string; dateIso?: string }>
) {
  return items.map((it) => positionFromTLE(it.l1, it.l2, it.dateIso));
}

// Expose the functions via Comlink
const api = {
  positionFromTLE,
  tleToLatLonAlt,
  satrecFromTLE,
  batchPositionFromTLE,
};

Comlink.expose(api);
