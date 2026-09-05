"""Re-entry Resolution Model -- landing spot for the ported numerical core
of lib/explainReentryTrend.ts and lib/objectTrendRisk.ts's resolveReentryRisk().

Not implemented yet. compute/satellite_helpers.py (Phase 2, done) already
carries the pure numerical primitives -- parseBSTAR, ndotIndicatesDecay,
getReentryTierThresholds, assignReentryTier, applyConfidenceCeiling,
altitudeBasedReentryEstimate, and getReentryRisk itself. What's left:

  Phase 3 -- signal/model functions: explainReentryTrend's classification
    logic (decaying / stable / maneuvering / insufficient_data, consensus
    gating).
  Phase 4 -- resolveReentryRisk() itself, composed from Phase 2's
    satellite_helpers primitives and Phase 3's trend classification.

This module's resolve_reentry_risk() should import from
compute.satellite_helpers rather than re-deriving any of that math.

Each phase's Python port must reproduce fixtures/reentry-model/golden_cases.json
exactly (within the float tolerance documented in
compute/satellite_helpers.py) -- see lib/reentryModel.goldenFixtures.test.ts
for the frozen TypeScript reference and
backend/tests/test_satellite_helpers_golden_fixtures.py /
backend/tests/test_reentry_golden_fixtures.py for the Python side. OLS trend
regression stays in TypeScript (plan §11) -- it is not part of this
module's scope.

This module must not import anything from FastAPI, contracts.py, or
anything naming Vercel/services/bindings -- see backend/README.md.
"""

from __future__ import annotations


def resolve_reentry_risk(entry: dict, trend: dict | None, solar_flux_multiplier: float) -> dict:
    """Intended signature, mirroring resolveReentryRisk() in
    lib/objectTrendRisk.ts. Not implemented until Phase 4 lands.
    """
    raise NotImplementedError(
        "resolve_reentry_risk is not ported yet -- see Phases 3-4 in "
        "docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §17"
    )
