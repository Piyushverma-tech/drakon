# DRAKON: Multi-Provider TLE Pipeline Migration Plan

**Status:** Draft, reviewed once (see §14 Review Log) — not yet implemented
**Owner:** Piyush Verma
**Last verified against live repo/docs:** 2026-07-20
**Repo:** github.com/Piyushverma-tech/drakon

---

## 0. Read this first (orientation for a fresh session)

DRAKON is a satellite re-entry decision/trend-tracking app. It currently pulls TLE (orbital element) data from CelesTrak, caches it in Redis, writes history to Postgres (Neon), and computes decay trends from that history. This document plans a migration to Space-Track as the primary data source, with CelesTrak kept as a fallback and as the permanent source for three specific historical debris clouds.

**Why this migration exists:** CelesTrak's `GROUP=active` convenience list was confirmed to lag the real satellite catalog — a specific newly-catalogued active payload (object 100000, the one that pushed the catalog from 5-digit to 6-digit numbering on 2026-07-11) was still absent from CelesTrak's `active` group a full week later, verified directly by fetching the live URL and searching for it (0/0 matches). Space-Track is the authoritative source that CelesTrak itself republishes from, without that curation lag.

**Current repo facts this plan depends on** (re-verify if it's been a while since 2026-07-20):

- TLE parsing lives in `lib/tle.ts` — `parseTleText()` requires strict 3-line records (name, then two lines starting `1 ` / `2 `) and already decodes Alpha-5 catalog numbers via `decodeAlpha5CatalogNumber()`.
- `lib/tle.ts` also exports `isDebrisLikeName()` / `isDebris` — this is a **name-pattern heuristic** (matches "deb", "r/b", "rkt", "rocket", "platform" in the object name), not a data-source indicator. Don't reuse it to mean "came from CelesTrak's static debris groups" — see §8's pruning logic for why that distinction matters.
- `lib/jobs/ingestTleHistory.ts` → `ingestTleHistory(entries: TleEntry[], sourceGroup: string)` takes **one** `sourceGroup` string applied to the entire batch. If you ever combine entries from two different sources into one array before calling it, every row gets mislabeled with whichever source name you passed.
- `lib/db/schema.ts` has **no** `ingestion_cursor` table today (confirmed via `drizzle/meta/_journal.json` — only migrations 0000, 0001, 0003, 0004 exist). This plan's design (§7) was revised specifically to avoid needing one.
- `app/api/tle/route.ts` is a public **GET** route: serves Redis cache on a hit, does a fresh CelesTrak fetch + Redis write + `after()`-deferred `ingestTleHistory()` call on a miss. There is currently no authenticated route dedicated to triggering ingestion.
- The rest of the app already has an established convention for this: `/api/internal/process-trends` and `/api/internal/requeue-stale`, both POST, both gated by an `x-internal-secret` header checked against `INTERNAL_JOB_SECRET` (see README). TLE ingestion currently does **not** follow this convention — it's triggered by GitHub Actions hitting the public GET route. §9 brings it in line.
- Vercel `maxDuration` is hard-capped at **60s on the Hobby plan** (confirmed against Vercel's docs; Fluid Compute can extend Hobby to 300s if ever needed, but the design here doesn't require it).
- Upstash Redis free tier: 256MB data, 10MB max request size, 100MB max record size, 500K commands/month (confirmed against Upstash's pricing page). Not a binding constraint at current catalog scope (~18,676 objects, ~3.2MB serialized).
- Neon Postgres: **391MB of a 500MB cap as of 2026-07-18**, growing faster than month-over-month partition creation accounts for. See §11 — this is a near-term blocker independent of the Space-Track migration and should be handled first or in parallel, not after.

---

## 1. Problem Statement

Three compounding issues with the current CelesTrak-only pipeline:

1. **Curation lag, not a parsing bug.** CelesTrak's `GROUP=active` file is a maintained subset, not a live view of the catalog. A cataloged, active payload can be absent from it for a week or more with no error surfaced anywhere.
2. **Freshness ceiling.** The Redis cache TTL plus the ~2-hour external cron interval means no object is ever fresher than ~2 hours, regardless of how often Space Force actually re-fits its orbit.
3. **No fallback.** A CelesTrak outage or empty response degrades to whatever's in the stale-cache key, with no alternate source.

**Goal:** Space-Track as primary source (authoritative, full catalog, no curation lag), CelesTrak as fallback + permanent source for three static debris clouds, switch invisible to everything downstream of ingestion.

**Non-goals:** migrating off TLE/3LE to OMM formats (not urgent — Alpha-5 covers catalog numbers up to 339,999, current catalog is ~100,000+); rewriting trend processing; DB schema changes beyond what §11 already requires for unrelated storage reasons.

---

## 2. Target Architecture

```
                    ┌───────────────────┐
   TLE_PROVIDER=    │    TLEProvider     │
   spacetrack|       │      (interface)   │
   celestrak         └─────────┬─────────┘
                                │
        ┌───────────────┬──────┴───────┬────────────────┐
        │               │              │                │
CelesTrakProvider  SpaceTrackProvider  MockProvider   (future: 3rd party)
 (debris + fallback)   (primary)       (tests)
        │               │              │
        └───────┬───────┴──────────────┘
                 ▼
         Ingestion Service
    (fetch → parse → merge → write)
                 │
        ┌────────┴────────┐
        ▼                 ▼
      Redis            PostgreSQL
  (raw snapshot,     (tle_history,
   session cookie)    tle_archive,
                       trend_jobs)
                          │
                          ▼
                 Trend Processing
                (unchanged — already
                 source-agnostic)
```

Everything below "Ingestion Service" requires **no structural changes** — `parseTleText`, `ingestTleHistory`, the trend worker, and the globe/dashboard consumers are already provider-agnostic; they only ever see parsed `TleEntry[]` or DB rows.

---

## 3. Provider Interface

```ts
// lib/providers/types.ts
export type ProviderName = 'celestrak' | 'spacetrack' | 'mock';

export interface TleFetchOptions {
  groups?: string[]; // CelesTrak-style named groups. Ignored by SpaceTrackProvider.
  fullResync?: boolean; // Widen the query window; result is authoritative enough to prune from.
  format?: 'tle' | '3le'; // Default to '3le' explicitly — see §5.3, don't rely on 'tle' alone.
}

export interface TleFetchResult {
  raw: string;
  provider: ProviderName;
  fetchedAt: Date;
  objectCount: number;
}

export interface TLEProvider {
  readonly name: ProviderName;
  fetch(options: TleFetchOptions): Promise<TleFetchResult>;
}
```

```ts
// lib/providers/index.ts
export function getPrimaryProvider(): TLEProvider {
  return process.env.TLE_PROVIDER === 'celestrak'
    ? celestrakProvider
    : spacetrackProvider;
}
export function getFallbackProvider(): TLEProvider {
  return getPrimaryProvider().name === 'spacetrack'
    ? celestrakProvider
    : spacetrackProvider;
}
```

---

## 4. Rate limits and retrieval guidance (read before writing the fetch code)

Confirmed directly from Space-Track's documentation (`space-track.org/documentation`, "API Use Guidelines" table), current as of 2026-07-20:

| Data type                 | Frequency                                                     | Notes                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **GP (aka TLEs)**         | **1 / hour**                                                  | "Please randomly choose a minute that is not at the top or bottom of the hour." Recommended query adds `/decay_date/null-val/epoch/>now-10/`. |
| SATCAT                    | 1 / day                                                       | After 1700 UTC. Not used by this plan (metadata still comes from CelesTrak's `satcat.csv`).                                                   |
| TIP (reentry predictions) | 1 / hour, or every 10 min for an object reentering within 12h | Official USSF reentry predictions — worth a look as a future addition/validation signal for DRAKON's own trend model, out of scope here.      |

This supersedes an earlier, wrong assumption in an earlier draft of this plan that 5-minute or 30-minute polling was safe because it's under the general 30/min-300/hour API throttle. **That general throttle and the GP-specific retrieval guidance are two different things** — the general throttle is a hard technical limit, the per-class guidance is what Space-Track says not to exceed "to prevent excess bandwidth costs," with an explicit suspension warning attached. **Poll GP data once per hour.** If tighter freshness is ever genuinely needed, Space-Track's docs explicitly invite contacting them to discuss a higher-frequency use case before building around it — don't just poll faster and hope.

One hour is still a real improvement over today's ~2-hour effective freshness, and — more importantly — it comes from the authoritative source instead of a curated, lagging subset.

---

## 5. SpaceTrackProvider

### 5.1 Authentication

Session-cookie based, not a simple API key:

```
POST https://www.space-track.org/ajaxauth/login
Content-Type: application/x-www-form-urlencoded
Body: identity=<account email>&password=<password>
→ Set-Cookie: chocolatechip=<token>; Path=/; Expires=...; HttpOnly
```

**Store and send only the `name=value` pair, not the full Set-Cookie string.** The raw header includes response-only attributes (`Path`, `Expires`, `HttpOnly`) that don't belong in a request `Cookie` header — sending them back verbatim is malformed and can be rejected or mis-parsed by some servers/proxies.

```ts
// lib/providers/spacetrack.ts — auth
const SESSION_KEY = 'spacetrack:session_cookie';
const SESSION_TTL_SECONDS = 60 * 60 * 2; // Space-Track doesn't publish an exact idle timeout; re-auth every 2h regardless

function extractSessionCookie(setCookieHeader: string): string {
  // "chocolatechip=abc123; Path=/; Expires=...; HttpOnly" → "chocolatechip=abc123"
  const match = setCookieHeader.match(/chocolatechip=[^;]+/);
  if (!match)
    throw new Error('Space-Track login response had no chocolatechip cookie');
  return match[0];
}

async function getSession(): Promise<string> {
  const cached = await redis.get<string>(SESSION_KEY);
  if (cached) return cached;

  const res = await fetch('https://www.space-track.org/ajaxauth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      identity: process.env.SPACETRACK_IDENTITY!,
      password: process.env.SPACETRACK_PASSWORD!,
    }),
  });
  if (!res.ok) throw new Error(`Space-Track auth failed: ${res.status}`);

  const rawCookie = res.headers.get('set-cookie');
  if (!rawCookie)
    throw new Error('Space-Track auth response had no session cookie');

  const cookie = extractSessionCookie(rawCookie);
  await redis.set(SESSION_KEY, cookie, { ex: SESSION_TTL_SECONDS });
  return cookie;
}
```

On a `401`/`403` from a query call: delete the cached session and re-authenticate once before giving up — don't retry indefinitely, let the next scheduled run pick it up if it still fails.

### 5.2 Query shape, scope, and format — no ID chunking, ever

**Scope by predicate, never by NORAD_CAT_ID list.** Chunking a ~18,676-object ID list into ~500-per-request batches means ~38 sequential HTTP calls for a full sweep — a real risk of exceeding Vercel's 60s cap before you've even parsed anything. Use `OBJECT_TYPE/PAYLOAD,ROCKET BODY` instead, so Space-Track filters server-side and always returns everything in **one request**. This also keeps scope roughly comparable to today's ~18,676 (payloads + rocket bodies), not the full 100,000+ catalog including raw debris/unknown objects — relevant given the storage constraint in §11.

**Request `format/3le` explicitly, not `format/tle`.** `parseTleText()` requires a name line before each pair of TLE lines. Space-Track's own glossary treats "TLE" and "Three Line Format" as **distinct** ("Three Line Format: Same as a TLE except the first line contains the satellite common name") — unlike CelesTrak, where `FORMAT=tle` and `FORMAT=3le` are documented synonyms that both include the name line. This strongly suggests Space-Track's bare `format/tle` omits the name line, which would desync `parseTleText()`'s 3-line stride and silently parse to (near) zero valid entries. I have not empirically confirmed this with a live query — do that as the very first thing in Phase 0 (§12) with a one-line `curl` before writing any other code — but request `3le` regardless, since every source agrees that format unambiguously includes the name line.

**No stateful cursor — use a rolling window instead**, matching Space-Track's own recommended pattern (`/decay_date/null-val/epoch/>now-10/`) rather than inventing a separate cursor mechanism:

```ts
const SPACETRACK_SCOPE = 'OBJECT_TYPE/PAYLOAD,ROCKET BODY';
const HOURLY_WINDOW_DAYS = 3; // generous overlap for a normal cycle
const RESYNC_WINDOW_DAYS = 45; // wide enough to catch anything that's gone quiet

async function fetchFromSpaceTrack(
  options: TleFetchOptions
): Promise<TleFetchResult> {
  const cookie = await getSession();
  const windowDays = options.fullResync
    ? RESYNC_WINDOW_DAYS
    : HOURLY_WINDOW_DAYS;

  const predicates = [
    SPACETRACK_SCOPE,
    'decay_date/null-val', // Space-Track's own recommendation — skip objects that can't be propagated
    `epoch/>now-${windowDays}`,
    'orderby/EPOCH asc',
    `format/${options.format ?? '3le'}`,
  ];
  const url = `https://www.space-track.org/basicspacedata/query/class/gp/${predicates.join('/')}`;

  const res = await fetch(url, { headers: { cookie } });
  if (res.status === 401 || res.status === 403) {
    await redis.del(SESSION_KEY);
    throw new Error(
      'Space-Track session rejected — will retry with fresh auth next call'
    );
  }
  if (!res.ok) throw new Error(`Space-Track query failed: ${res.status}`);

  const raw = await res.text();
  const entries = parseTleText(raw);
  return {
    raw,
    provider: 'spacetrack',
    fetchedAt: new Date(),
    objectCount: entries.length,
  };
}
```

Why no cursor: the `gp` class always returns exactly **one row per object — the latest elset**, not a history. A wide window doesn't bloat the response with duplicate historical rows; it just means "also include objects that haven't been refreshed in a while," which is exactly what you want. A missed cycle or two is harmless — the 3-day window comfortably covers a gap much longer than the 1-hour polling interval, and re-fetching an object whose epoch hasn't changed is a no-op via `onConflictDoNothing` on the Postgres side and an idempotent overwrite in the Redis merge. This also means **no `ingestion_cursor` table is needed** — the earlier draft of this plan required one; this version doesn't.

### 5.3 Alpha-5

Already solved by the existing `decodeAlpha5CatalogNumber()` in `lib/tle.ts` — both providers emit standard TLE/3LE text and it handles the encoding regardless of source. One thing to remember: **queries themselves must use plain integer `NORAD_CAT_ID`, never the Alpha-5 string** — Space-Track's own FAQ states the API won't support filtering on Alpha-5 values or ranges. Not relevant to the predicate-based scope above (no ID filtering at all), but worth remembering if a future query ever needs to target a specific object by ID.

---

## 6. CelesTrakProvider

Two distinct jobs, not one:

1. **Always-on source for the three static debris clouds** (Iridium-33, Cosmos-2251, Fengyun-1C debris). These don't fit `OBJECT_TYPE=PAYLOAD,ROCKET BODY` — they're debris by definition — and are closed historical sets that don't benefit from Space-Track's freshness. Fetch every cycle regardless of which provider is primary.
2. **Outage fallback** for the payload/rocket-body scope, only when Space-Track fails. Mostly today's `fetchFromCelestrak` logic extracted behind the `TLEProvider` interface, `groups: ['active']`.

Job 2 comes with a hard rule enforced in §8: its result **merges** into the snapshot, it never replaces it. CelesTrak's known curation lag means treating its output as "the complete truth," even temporarily during an outage, reintroduces the exact gap this migration exists to close.

---

## 7. MockProvider

```ts
// lib/providers/mock.ts
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
```

Deterministic fixture that always includes one Alpha-5 object, so the decode path is exercised in CI without depending on either live API.

---

## 8. Ingestion Service

### 8.1 Two mistakes an earlier draft of this plan made — both fixed below, worth knowing why

**Mistake 1 — overwriting the cache instead of merging.** Writing a fetch result straight into the Redis snapshot key means an incremental/windowed result — which only contains objects whose epoch fell in the query window — replaces the _entire_ rendered catalog. Everything outside that window would vanish from the globe until the next cycle. Fix: merge by `norad_id` into the existing snapshot, always.

**Mistake 2 — treating a CelesTrak fallback as equivalent to an authoritative full resync.** Replacing the whole snapshot with whatever the fallback returned means a Space-Track outage briefly reintroduces the exact curation-lag gap this migration exists to close. Fix: only a genuine Space-Track sweep (`fullResync: true`, primary provider succeeded) is authoritative enough to drive removals. CelesTrak — fallback or debris-cloud — only ever merges.

**Mistake 3 (caught by external review, not by me) — provenance mislabeling.** `ingestTleHistory()` takes one `sourceGroup` string for the whole batch. Combining Space-Track entries and CelesTrak debris entries into one array before calling it means every debris row gets labeled with the Space-Track provider name. Fix: call it once per source.

**Mistake 4 (also caught by external review) — pruning exemption used the wrong field.** `TleEntry.isDebris` is a name-pattern heuristic (matches "r/b", "rocket", etc. in the object name) — it does **not** mean "came from the static CelesTrak debris groups." A Space-Track-sourced rocket body would have `isDebris === true` purely from its name and would be permanently exempt from removal pruning, even after it actually decays and Space-Track stops returning it. Fix: track exemption by **which fetch actually produced the entry** (the debris-cloud CelesTrak result), not by a name pattern.

### 8.2 Corrected design

```ts
// lib/tle.ts — new helper alongside parseTleText/decodeAlpha5CatalogNumber
export function serializeTleEntries(entries: TleEntry[]): string {
  return entries.map((e) => `${e.name}\n${e.l1}\n${e.l2}`).join('\n') + '\n';
}
```

```ts
// lib/ingestion/tleIngestionService.ts
const SNAPSHOT_KEY = CACHE_KEY; // 'tle:combined' — same key the client already reads
const LAST_FULL_RESYNC_KEY = 'tle:last_full_resync';
const FULL_RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day; tune later if needed
const LOCK_KEY = 'tle:ingestion:lock';
const LOCK_TTL_SECONDS = 120; // generous vs. an expected ~5-15s cycle
const STATIC_DEBRIS_GROUPS = [
  'iridium-33-debris',
  'cosmos-2251-debris',
  'fengyun-1c-debris',
];

async function needsFullResync(): Promise<boolean> {
  const last = await redis.get<string>(LAST_FULL_RESYNC_KEY);
  return (
    !last || Date.now() - new Date(last).getTime() > FULL_RESYNC_INTERVAL_MS
  );
}

export async function runIngestionCycle() {
  // Prevent two overlapping triggers from racing on the read-modify-write merge below.
  const acquired = await redis.set(LOCK_KEY, '1', {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  if (!acquired) {
    console.warn('[TLE] Ingestion already in progress, skipping this trigger');
    return { skipped: true };
  }

  try {
    const primary = getPrimaryProvider(); // spacetrack
    const fallback = getFallbackProvider(); // celestrak
    const doFullResync = await needsFullResync();

    let primaryResult: TleFetchResult;
    let primaryProviderUsed: ProviderName;
    let usedFallback = false;
    try {
      primaryResult = await primary.fetch({ fullResync: doFullResync });
      primaryProviderUsed = primary.name;
    } catch (err) {
      console.warn(
        `[TLE] Primary provider (${primary.name}) failed, falling back:`,
        err
      );
      primaryResult = await fallback.fetch({ groups: ['active'] });
      primaryProviderUsed = fallback.name;
      usedFallback = true;
    }

    // Static debris clouds: always CelesTrak, every cycle, ingested and pruning-exempted separately.
    const debrisResult = await celestrakProvider.fetch({
      groups: STATIC_DEBRIS_GROUPS,
    });

    const primaryEntries = parseTleText(primaryResult.raw);
    const debrisEntries = parseTleText(debrisResult.raw);
    const debrisIds = new Set(debrisEntries.map((e) => e.id)); // membership, not isDebris — see §8.1 mistake 4

    const existingRaw = (await redis.get<string>(SNAPSHOT_KEY)) ?? '';
    const snapshotMap = new Map(
      parseTleText(existingRaw).map((e) => [e.id, e])
    );

    if (doFullResync && !usedFallback) {
      // Only an authoritative Space-Track sweep can drop objects.
      const freshIds = new Set(primaryEntries.map((e) => e.id));
      for (const [id] of snapshotMap) {
        if (!debrisIds.has(id) && !freshIds.has(id)) snapshotMap.delete(id);
      }
      await redis.set(LAST_FULL_RESYNC_KEY, new Date().toISOString());
    }
    for (const entry of [...primaryEntries, ...debrisEntries]) {
      snapshotMap.set(entry.id, entry); // every path — windowed, resync, or fallback — merges what it fetched
    }

    const mergedRaw = serializeTleEntries([...snapshotMap.values()]);
    await redis.set(CACHE_KEY, mergedRaw, { ex: CACHE_TTL_SECONDS });
    await redis.set(STALE_CACHE_KEY, mergedRaw);

    // Ingest each source separately so tle_history.source_group is accurate per row —
    // combining them into one array before calling ingestTleHistory would mislabel every debris row.
    const primaryIngest = await ingestTleHistory(
      primaryEntries,
      primaryProviderUsed
    );
    const debrisIngest = await ingestTleHistory(
      debrisEntries,
      'celestrak:debris'
    );

    const combined = {
      inserted: primaryIngest.inserted + debrisIngest.inserted,
      skipped: primaryIngest.skipped + debrisIngest.skipped,
      invalid: primaryIngest.invalid + debrisIngest.invalid,
    };

    console.log('[TLE] Ingestion cycle:', {
      provider: usedFallback
        ? `${fallback.name} (fallback)`
        : primaryProviderUsed,
      fullResync: doFullResync && !usedFallback,
      snapshotSize: snapshotMap.size,
      ...combined,
    });
    return combined;
  } finally {
    await redis.del(LOCK_KEY);
  }
}
```

**Provenance for free:** `tle_history.source_group` already exists (`sourceGroup: text('source_group').notNull()` in `schema.ts`). No migration needed — this design just needs to pass it accurately per source, which the two separate `ingestTleHistory` calls above do.

---

## 9. Route architecture — bring TLE ingestion in line with the rest of the app

Current state: TLE ingestion is triggered by GitHub Actions hitting the public `GET /api/tle` route, relying on a Redis cache miss to fire the fetch-and-ingest path. Everything else that runs on a schedule (`process-trends`, `requeue-stale`) uses a dedicated `POST /api/internal/*` route gated by an `x-internal-secret` header checked against `INTERNAL_JOB_SECRET`. TLE ingestion is the odd one out.

Fix: add `POST /api/internal/ingest-tle`, matching the existing convention exactly, calling `runIngestionCycle()` from §8. Keep `GET /api/tle` as a pure read path — serve the Redis snapshot, no side effects. Point whatever triggers hourly ingestion (GitHub Actions today, or migrate this specific job to cron-job.org alongside the other two internal routes — worth considering since it would consolidate all three schedules onto one mechanism) at the new authenticated route instead of the public one.

---

## 10. What does NOT change

- `parseTleText`, `decodeAlpha5CatalogNumber`, `parseTLEMeta` — already provider-agnostic.
- `tle_history` / `tle_archive` / `trend_jobs` schema — no migration required for the provider switch itself (§11 requires one for an unrelated reason).
- Trend processing, re-entry screening, globe rendering — consume parsed entries or DB rows, unaware of provider.
- The existing Redis dual-key caching pattern (`tle:combined` / `tle:combined:stale`) — reused as-is.

---

## 11. Storage Budget & Retention Policy — do this first, independent of the provider switch

**This is a near-term blocker on its own.** As of 2026-07-18, Neon Postgres was at **391.37 MB of a 500 MB cap**. Table breakdown:

| Table                 | Total size | Notes                                                           |
| --------------------- | ---------- | --------------------------------------------------------------- |
| `tle_history_2026_06` | 156 MB     | Full month                                                      |
| `tle_history_2026_07` | 147 MB     | Partial month (18 days) — **faster growth rate than June**      |
| `tle_archive`         | 21 MB      |                                                                 |
| `object_trends`       | 9.5 MB     |                                                                 |
| `trend_snapshots`     | 4.9 MB     |                                                                 |
| `trend_jobs`          | 3.4 MB     |                                                                 |
| (small/empty tables)  | ~0.2 MB    | includes the pre-created, empty `tle_history_2026_08` partition |

June: 156MB / 30 days ≈ 5.2 MB/day. July (partial): 147MB / 18 days ≈ 8.2 MB/day — about 57% faster, most likely real catalog growth (more tracked objects) rather than a code change. At the July rate, the remaining ~109MB of headroom runs out in **~13 days from 2026-07-18, i.e. around 2026-07-31**, with zero other changes.

**The fix costs nothing functionally, because most of what's stored is provably never read again.** `lib/jobs/computeObjectTrends.ts` only ever queries `tle_history` with a 30-day cutoff (`cutoff30d = now - 30 * MS_PER_DAY`) — confirmed directly in the source, not inferred. Nothing in the codebase reads history older than 30 days.

- **Immediate action:** as of 2026-07-18, rows in `tle_history_2026_06` dated before 2026-06-18 are already outside the 30-day window and unused. Delete them and run `VACUUM (FULL, ANALYZE) tle_history_2026_06;` immediately after (a plain `DELETE` alone marks rows dead but doesn't return the space — Neon bills on actual storage, so the `VACUUM FULL` step is what actually reclaims it). This is roughly 17/30 of the partition, ≈88MB, available same-day.
- **Scheduled action:** once the entire month of June is more than 30 days old — i.e. from **2026-07-31 onward** — the whole `tle_history_2026_06` partition can be dropped outright (`DROP TABLE`, instant, no vacuum needed), reclaiming the remaining ~68MB. This conveniently lines up almost exactly with when the unmanaged headroom would otherwise run out.
- **Ongoing policy:** once a monthly partition's entire date range is more than ~35 days old (30-day window + safety buffer), drop it. This should be a small scheduled job, not a manual monthly task — whatever currently creates next month's empty partition ahead of time (confirm how — not verified in this pass) is the natural place to also check for and drop the oldest one.

**Secondary, lower-risk optimization — redundant index.** `tle_history`'s unique constraint (`UNIQUE (norad_id, epoch)`, confirmed in `drizzle/0000_clever_titania.sql`) already creates its own supporting btree index. There's also a separate explicit `idx_tle_history_norad_epoch ON tle_history (norad_id, epoch DESC)` — different sort direction, largely redundant coverage. Checked every place that queries `tle_history` with an epoch order (`computeObjectTrends.ts` and `app/api/object-trends/[noradId]/history/route.ts`) — both use `orderBy(asc(tleHistory.epoch))`, never `desc`. The DESC-specific index isn't even aligned with the app's actual read pattern. Dropping it is a reasonable candidate for a small additional reclaim, worth testing (`EXPLAIN ANALYZE` the two known query sites before and after) rather than assuming.

**Interaction with the Space-Track migration:** the windowed-fetch design in §5.2 does not by itself change ingestion volume — the number of distinct new `(norad_id, epoch)` rows over time is governed by how often Space-Force actually refits orbits, not by DRAKON's poll frequency, since `onConflictDoNothing` already discards re-fetched-but-unchanged epochs. What _would_ balloon storage is broadening object scope beyond the current ~18,676 (payloads + rocket bodies) toward the full 100,000+ catalog — which is exactly why §5.2 scopes Space-Track queries with `OBJECT_TYPE=PAYLOAD,ROCKET BODY` rather than an unfiltered pull.

---

## 12. Rollout Phases

| Phase              | What                                                                                                                                                                                                                                                                                                                      | Risk                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **0. Prep**        | Confirm Space-Track account works (already have one — long-standing). Manually `curl` `class/gp` with `format/3le` and the §5.2 predicates to confirm the response shape matches what `parseTleText` expects **before writing any provider code**. Handle §11's storage issue (same day, no dependency on anything else). | None — verification only                                                            |
| **1. Shadow mode** | Build `SpaceTrackProvider` + `MockProvider` behind the interface. Ingest only from CelesTrak as today, but also fetch from Space-Track and log a diff (object count, IDs each source has that the other doesn't) without acting on it.                                                                                    | Low — additive, no behavior change                                                  |
| **2. Cutover**     | Add `POST /api/internal/ingest-tle` (§9). Flip `TLE_PROVIDER` default to `spacetrack`, CelesTrak as automatic fallback (§8). Point the hourly trigger at the new route.                                                                                                                                                   | Medium — watch error rates and session-auth failures closely for the first few days |
| **3. Tune**        | Confirm 1-hour cadence is holding steady against Space-Track's guidance; adjust `HOURLY_WINDOW_DAYS`/`RESYNC_WINDOW_DAYS` if needed based on observed gaps.                                                                                                                                                               | Low                                                                                 |
| **4. Cleanup**     | Remove the old CelesTrak-specific logic from `app/api/tle/route.ts` once `CelesTrakProvider` fully covers what it did.                                                                                                                                                                                                    | Low                                                                                 |

---

## 13. Risks & Mitigations

- **Account suspension from exceeding Space-Track's retrieval guidance.** §4's 1/hour limit for GP data is explicit and comes with a suspension warning. Don't poll more often without contacting Space-Track first, per their own documentation's invitation to do so.
- **Session expiry mid-cycle.** Treat `401`/`403` as "re-authenticate once, then fail the cycle" — let the next scheduled run pick it up rather than retrying indefinitely.
- **Space-Track outage.** Automatic fallback to `CelesTrakProvider` (§6, §8) — freshness advantage is lost temporarily, data isn't.
- **Divergent data between sources.** Space-Track is upstream of what CelesTrak republishes; expect it to be a strict superset in practice. Shadow mode (Phase 1) confirms this before relying on it.
- **`format/tle` vs `format/3le` assumption.** Flagged in §5.2 as not yet empirically confirmed for Space-Track specifically — verify with a manual `curl` in Phase 0 before writing the parser-dependent code around it.
- **Storage.** Covered in full in §11 — treat as a blocking prerequisite, not a follow-up.

---

## 14. Review Log

**2026-07-20 — first review pass** (external code-review tool, verified against live repo/docs before accepting): found 9 issues in the draft that existed before this rewrite — a parsing blocker (`format/tle` vs `3le`), a TypeScript interface gap (`fullResync` used but undeclared), a dependency on a Postgres table that didn't exist (`ingestion_cursor` — resolved by removing the need for it, not by adding the table), a provenance-mislabeling bug (mixed-source batches passed to `ingestTleHistory` with one label), a pruning-exemption bug (reused a name-heuristic field for a data-source distinction it doesn't represent), a rate-limit correction (GP-specific 1/hour guidance, separate from and stricter than the general throttle), a missing authenticated route for ingestion (existing `/api/internal/*` + `x-internal-secret` convention wasn't followed), a cookie-parsing correctness issue (raw `Set-Cookie` string vs. extracted `name=value`), and a dangling section reference (intro pointed at a storage section that had never actually been written). All nine confirmed against the actual repo and Space-Track's live documentation before being fixed in this version — none were dismissed without verification.

## 15. Open Questions

- Confirm exactly how new monthly `tle_history` partitions get created ahead of time (a migration? a scheduled job?) — the retention job in §11 should live next to whatever that is.
- Once `format/3le` is confirmed empirically (Phase 0), remove the hedging language in §5.2.
- Is 1-hour cadence actually sufficient for the trend model's needs, or worth a conversation with Space-Track about a higher-frequency use case given DRAKON's specific decay-tracking purpose?
