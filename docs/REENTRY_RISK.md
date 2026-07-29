# Re-entry Risk Screening — Notes

Core idea: a single TLE epoch has limited, often-unreliable decay info (esp. for maneuvering satellites). System uses two layers, resolved into one verdict.

## Two-Layer Architecture

- **Layer 1 — Single-epoch BSTAR** (`lib/satelliteHelpers.ts::getReentryRisk`): synchronous, uses BSTAR + mean motion derivative from current TLE. Works for all debris, no backend dependency. Accuracy ±order of magnitude.
- **Layer 2 — Multi-epoch trend** (`lib/jobs/computeObjectTrends.ts::recomputeTrends`): regression over 7–30 days of `tle_history`. Background cron job. Better at separating decaying satellites from maneuvering ones.
- **Resolution** (`lib/objectTrendRisk.ts::resolveReentryRisk`): picks the **more pessimistic** of the two when both available for sub-threshold objects (not a simple priority order).

## Data Sources

- **BSTAR**: TLE line 1 cols 53–60, packed decimal `±NNNNN±N` → `0.NNNNN × 10^(±N)`. A least-squares fit coefficient, not a direct drag measurement — meaningless for maneuvering satellites, converges to true drag for non-maneuvering ones.
- **Mean motion derivative (Ṅ)**: TLE line 1 cols 33–42. Positive Ṅ = decaying orbit. Less contaminated by maneuvers than BSTAR.
- **TLE history**: `tle_history` (Neon, monthly partitions). Up to 30 days per object: BSTAR, mean motion, Ṅ, perigee, apogee, SMA.
- **NOAA F10.7 solar flux**: fetched daily, cached in Redis (`solar:f107`, 24h TTL), exposed via `x-f107` / `x-solar-flux-multiplier` headers on `/api/tle`. Applied as density multiplier to decay rates.
  - `CALIBRATION_MULTIPLIER = (200/150)^1.5 ≈ 1.54`
  - `multiplier = CALIBRATION_MULTIPLIER × (F10.7/200)^0.3` — exponent 0.3 keeps it conservative (quiet-period ~0.88×, solar max ~1.14×)

## Single-Epoch Decay Rate Formula

```
decayRate (km/day) = |BSTAR| × BASE_FACTOR × densityFactor × (v / v_ref) × solarFluxMultiplier
BASE_FACTOR = 7.4e3
densityFactor = exp((400 - altKm) / 60)   # H = 60km scale height
v_ref = 7.905 km/s
v = sqrt(MU / (R_earth + alt))

estimatedDays = ceil(((perigeeKm - 120) / decayRate) × 2/3)
```

120 km = nominal re-entry threshold. Uses perigee (orbit low point drives re-entry). 2/3 factor approximates accelerating drag.

**Sub-threshold fallback** (perigee < 300km debris / 240km payload), independent of BSTAR:

```
BASE_RATE_200KM = 10 × solarFluxMultiplier   # km/day at 200km
SCALE_HEIGHT = 35km
decayRate = BASE_RATE_200KM × exp((200 - altKm) / 35)
```

## Multi-Epoch Trend Computation

- Linear regression over 7/14/30-day windows for BSTAR, perigee, apogee, SMA, Ṅ.
- Exponential weighting: `weight = exp((epochMs - nowMs) / halfLifeMs)`.
  - Half-life = **1 day** if perigee < 250km (terminal), else **3 days**.
- Decay classification:
  ```
  rawConfidence = 0.35×bstarSignal + 0.25×ndotSignal + 0.40×altitudeSignal
  decayConfidence = rawConfidence × (1 − maneuverLikelihood×0.75)
  ```
  Maneuver likelihood ~ BSTAR coefficient of variation without corresponding altitude drop.
- Signals: `decaying` (confidence ≥0.35 + agreement), `maneuvering` (high BSTAR CV, no alt decay), `stable` (low confidence, ≥5 epochs), `insufficient_data` (<3 epochs or below min history: 1 day debris / 7 days payload).
- Re-entry estimate uses **pessimistic-of-7d-and-14d** slopes (perigee & SMA), preferring 7d for terminal objects since decay accelerates.
- **Payload consensus gate**: active payloads need BSTAR↑ AND Ṅ-decay AND perigee/SMA↓ all agreeing, unless perigee < 220km (altitude alone suffices) or 220–300km (partial consensus ok).
- **Confidence ceiling**: confidence <0.75 → critical/warning downgrade to nominal; <0.85 → critical downgrades to warning.

## Resolution Logic (`resolveReentryRisk`)

```
resolveReentryRisk(entry, trend?, solarFluxMultiplier)
  ├─ HEO? (apogee > perigee×10 AND apogee > 2000km) → stable
  ├─ perigee < altThreshold (300km debris / 240km payload)?
  │   ├─ raising orbit (Ṅ < -1e-6) or neg BSTAR+Ṅ → stable
  │   ├─ trend shows maneuvering/stable (≥5 epochs) → stable
  │   ├─ eccentricity correction if apogee > perigee×3 AND apogee>500 (× perigee/apogee factor)
  │   ├─ compute altitude-based estimate ×0.8
  │   └─ pessimistic-of-two: use trend if actionable AND trend.days < alt.days, else alt estimate
  └─ perigee ≥ threshold
      ├─ actionable trend (≥3 epochs, ≥1 day history, not insufficient_data)?
      │   ├─ debris → use trend directly
      │   └─ payload → require decaying + all 3 signals agree, else stable
      ├─ debris, no trend → single-epoch getReentryRisk
      └─ payload, no trend → stable
```

## Object Classification

- Debris = `entry.isDebris` (set in `lib/tle.ts::parseTleText` for names with r/b, rkt, rocket, platform) OR name includes DEB/DEBRIS. Rocket bodies count as debris.
- Active payloads: single-epoch BSTAR never used — only multi-epoch with full consensus (avoids false positives like maneuvering Starlink).
- Sanity gates (single-epoch): GEO/deep space (period >600min or perigee >2000km) → stable; decay rate <1e-4 → stable; beyond altitude-aware anomaly cap → stable; rawDays >3650 → stable.
  - Anomaly cap: disabled below 180km; `8×exp((300-alt)/60)` (min 0.5) for 180–400km; `20×exp((400-alt)/60)` above 400km.

## Risk Tiers

| Tier     | Condition                                  | Globe color                  |
| -------- | ------------------------------------------ | ---------------------------- |
| Critical | < 30 days                                  | Red-orange `[255,60,40,230]` |
| Warning  | above critical, below altitude-aware limit | Amber `[255,160,30,210]`     |
| Nominal  | above warning, below limit                 | Yellow `[255,220,80,180]`    |
| Stable   | beyond limit / null / filtered             | not shown                    |

Critical cutoff fixed at 30 days. Warning/nominal limits compress with altitude:

| Altitude | Warning | Nominal |
| -------- | ------- | ------- |
| ≤300km   | 180d    | 365d    |
| 500km    | 120d    | 240d    |
| 800km    | 90d     | 180d    |
| 1000km   | 60d     | 120d    |
| 2000km   | 45d     | 90d     |

Ṅ confidence threshold is altitude-dependent: ≤400km `>1e-5`, 400-500km `>2e-5`, >500km `>5e-5` rev/day². Agreement → high confidence.

## Accuracy Expectations

| Scenario                               | Accuracy                             |
| -------------------------------------- | ------------------------------------ |
| Debris, single-epoch, 150–250km        | ±1–2 days                            |
| Debris, multi-epoch, accelerating      | ±2–4 days                            |
| Active payload, multi-epoch, 250–600km | ±order of magnitude                  |
| Any object >600km                      | Very low (BSTAR fit noise dominated) |

Not modeled: geomagnetic storms, tumbling/attitude drag variance, full eccentricity, full NRLMSISE-00 density profile.

## Performance Design

- Single-epoch path: pure `useMemo`, synchronous, sub-ms for 15k objects.
- `reentryRisks` useMemo deliberately excludes `activeSatellites` (live SGP4 positions) — re-entry risk derives from static TLE params only, avoiding recompute every 5s.
- Ref pattern (`reentryRisksRef`) keeps `getFillColor` closure current without forcing layer recompute.
- Trend data fetched lazily (`useObjectTrendsQuery`, only when `showReentry`), 30-min stale time — doesn't block initial render.

## Trend Pipeline Operations

- **Ingest**: `lib/jobs/ingestTleHistory.ts`, called (once per source) by `runIngestionCycle()` in `lib/ingestion/tleIngestionService.ts` on every `POST /api/internal/ingest-tle` (cron-job.org, hourly) -- not tied to `/api/tle` traffic anymore. Per 500-entry chunk: insert new epochs (`onConflictDoNothing` on norad_id+epoch), archive raw TLE lines for new epochs, enqueue `trend_jobs`.
- Terminal priority requeue: objects below 250km perigee always get a fresh job regardless of epoch change.
- **Worker**: `POST /api/internal/process-trends?batchSize=200`, cron-job.org every 15min. Stuck `processing` rows deleted at top of each run. Jobs claimed `FOR UPDATE SKIP LOCKED`, processed in slices of 10 via `Promise.allSettled`. 3 retries before `failed`.
- **Version invalidation**: bump `CURRENT_TREND_VERSION` in `computeObjectTrends.ts` on algorithm changes. `requeueStaleObjects` only requeues where trend_version is stale AND new history epochs exist (prevents full-catalog flood).

| Job                | Trigger                                          | Schedule    | Timeout |
| ------------------ | ------------------------------------------------ | ----------- | ------- |
| TLE ingest         | GitHub Actions → GET /api/tle                    | every 2h    | 900s    |
| Solar flux refresh | cron-job.org → POST /api/solar-flux              | daily       | 10s     |
| Trend processing   | cron-job.org → POST /api/internal/process-trends | every 15min | 60s     |

## Explainability Layer

`lib/explainReentryTrend.ts` — single source of truth turning regression output into classification, used by both worker and read-side API so they can never diverge.

- `SIGNAL_WEIGHTS` (0.35/0.25/0.4) / `SIGNAL_AGREE_THRESHOLDS` (0.3/0.3/0.2) as named constants.
- `reconstructSignalContributions(scores)` rebuilds per-signal breakdown from 3 persisted `object_trends` columns (`bstar_signal_strength`, `ndot_signal_strength`, `altitude_signal_strength`, nullable) — no re-query/re-regression needed, so `/explain` and the Analysis page are cheap and guaranteed consistent.

## Decision Trace (`/dashboard/reentry/[noradId]`)

- Verdict computed from the same `{risk, trend}` pair the rest of the app uses (via `resolveReentryRisk`) — not a separate server computation, so it can't drift from the Detail Panel.
- `buildReentryTrace()` composes a one-line summary (characterization + evidentiary clause) always shown before the trace toggle.
- Trace renders as connected pipeline steps: Load history → Bstar/N-dot/Altitude analysis → Consensus → Verdict → Live override (only shown if `trend.reentryTier !== risk.tier`).
- Evidence (always visible): altitude-decay + BSTAR-trend charts (ECharts) + change-history timeline.

## Triage & Change History

- `trend_snapshots`: append-only, written by `upsertTrend()` only when `reentryTier` or `decaySignal` actually changes.
- Dashboard triage buckets (`buildTriageBuckets.ts`):
  - **New/escalated**: most recent snapshot within 72h AND represents severity increase (or first-ever snapshot). Improvements don't qualify.
  - **Active**: current tier critical/warning, nothing changed recently.
  - **Watching**: current tier nominal/stable.
- Change-history timeline events: escalated / improved / lateral (signal changed, tier didn't) / first (oldest in the 20-row window, not necessarily true first).

## UI Surfaces

| Surface                        | Shows                                                                     |
| ------------------------------ | ------------------------------------------------------------------------- |
| Globe ScatterplotLayer         | tier colors when `showReentry` on; others dimmed                          |
| RightPanel                     | tier counts, top-50 list by days remaining                                |
| LeftPanel                      | re-entry detail for focused satellite                                     |
| `/dashboard/reentry`           | triage tabs, sortable table, MiniGlobe, F10.7 stats bar                   |
| `/dashboard/reentry/[noradId]` | Decision Trace: summary, pipeline trace, evidence charts, change timeline |

## Key Files

- `lib/satelliteHelpers.ts` — BSTAR/Ṅ parsers, single-epoch risk, tier assignment
- `lib/objectTrendRisk.ts` — `resolveReentryRisk`, `buildReentryRiskMap`
- `lib/explainReentryTrend.ts` — classification + explainability
- `lib/reentrySignals.ts` — signal agreement helpers
- `lib/solarFlux.ts` — F10.7 fetch/multiplier
- `lib/jobs/computeObjectTrends.ts` — regression + trend worker
- `lib/jobs/ingestTleHistory.ts` — history/archive writes
- `lib/jobs/requeueStaleObjects.ts` — version invalidation sweep
- `app/dashboard/reentry/` — dashboard + Analysis page
- `components/DecisionTrace/` — reusable Verdict→Trace→Evidence shell
- `.github/workflows/tle-ping.yml` — 2h TLE ingest cron

## Related

- [Collision Density Map](./COLLISION_DENSITY_MAP.md)
- [Orbital Plane Visualization](./ORBITAL_PLANE_VISUALIZATION.md)
- [TLE History Pipeline](./TLE_HISTORY_PIPELINE.md)
