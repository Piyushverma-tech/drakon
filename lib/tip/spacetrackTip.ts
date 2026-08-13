import {
  getSpaceTrackSession,
  invalidateSpaceTrackSession,
} from '@/lib/spacetrack/session';
import type { TipPrediction } from '@/lib/types';

/** Space-Track JSON returns naive "YYYY-MM-DD HH:MM:SS" (UTC). Normalize to ISO. */
function toIsoUtc(value: string): string {
  return new Date(value.replace(' ', 'T') + 'Z').toISOString();
}

async function fetchRawTip(): Promise<unknown[]> {
  const cookie = await getSpaceTrackSession();
  const predicates = [
    'decay_epoch/>now',
    'orderby/INSERT_EPOCH desc',
    'format/json',
  ];
  const url = `https://www.space-track.org/basicspacedata/query/class/tip/${predicates.join('/')}`;

  const res = await fetch(url, { headers: { cookie } });

  if (res.status === 401 || res.status === 403) {
    await invalidateSpaceTrackSession();
    throw new Error(
      `Space-Track TIP session rejected (${res.status}) — will retry with fresh auth next call`
    );
  }
  if (!res.ok) throw new Error(`Space-Track TIP query failed: ${res.status}`);

  // Empty array is a NORMAL result — most catalog objects are nowhere near
  // decay at any given moment, unlike an empty TLE fetch (which means the
  // provider is broken). Do not throw on [].
  return res.json();
}

export function parseTipRow(row: Record<string, unknown>): TipPrediction | null {
  const noradId = Number(row.NORAD_CAT_ID);
  const decayEpoch = String(row.DECAY_EPOCH ?? '');
  if (!Number.isFinite(noradId) || !decayEpoch) return null;

  return {
    noradId,
    decayEpoch: toIsoUtc(decayEpoch),
    windowMinutes: Number(row.WINDOW) || 0,
    msgEpoch: row.MSG_EPOCH ? toIsoUtc(String(row.MSG_EPOCH)) : null,
    insertEpoch: row.INSERT_EPOCH ? toIsoUtc(String(row.INSERT_EPOCH)) : null,
    direction:
      row.DIRECTION === 'ascending' || row.DIRECTION === 'descending'
        ? row.DIRECTION
        : null,
    lat: row.LAT !== undefined && row.LAT !== null ? Number(row.LAT) : null,
    lon: row.LON !== undefined && row.LON !== null ? Number(row.LON) : null,
    highInterest: row.HIGH_INTEREST === 'Y',
  };
}

/** One row per NORAD_CAT_ID — keeps the message with the latest insertEpoch. */
export function dedupeLatestTip(rows: TipPrediction[]): TipPrediction[] {
  const byId = new Map<number, TipPrediction>();
  for (const row of rows) {
    const existing = byId.get(row.noradId);
    if (!existing || (row.insertEpoch ?? '') > (existing.insertEpoch ?? '')) {
      byId.set(row.noradId, row);
    }
  }
  return [...byId.values()];
}

export async function fetchTipPredictions(): Promise<TipPrediction[]> {
  const raw = await fetchRawTip();
  const parsed = raw
    .map((row) => parseTipRow(row as Record<string, unknown>))
    .filter((row): row is TipPrediction => row !== null);
  return dedupeLatestTip(parsed);
}
