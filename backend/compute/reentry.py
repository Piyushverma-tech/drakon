"""Re-entry Resolution Model -- landing spot for the ported numerical core
of lib/satelliteHelpers.ts, lib/explainReentryTrend.ts, and
lib/objectTrendRisk.ts's resolveReentryRisk().

Not implemented yet. This is deliberately empty of real logic until:

  Phase 2 (plan §17) -- pure numerical primitives: parseBSTAR,
    ndotIndicatesDecay, getReentryTierThresholds, assignReentryTier,
    applyConfidenceCeiling, altitudeBasedReentryEstimate.
  Phase 3 -- signal/model functions: explainReentryTrend's classification
    logic (decaying / stable / maneuvering / insufficient_data, consensus
    gating).
  Phase 4 -- resolveReentryRisk() itself, composed from the above.

Each phase's Python port must reproduce fixtures/reentry-model/golden_cases.json
exactly (see lib/reentryModel.goldenFixtures.test.ts for the frozen
TypeScript reference and backend/tests/test_reentry_golden_fixtures.py for
the Python side of that same check). OLS trend regression stays in
TypeScript (plan §11) -- it is not part of this module's scope.

This module must not import anything from FastAPI, contracts.py, or
anything naming Vercel/services/bindings -- see backend/README.md.
"""

from __future__ import annotations


def resolve_reentry_risk(entry: dict, trend: dict | None, solar_flux_multiplier: float) -> dict:
    """Intended signature, mirroring resolveReentryRisk() in
    lib/objectTrendRisk.ts. Not implemented until Phase 4 lands.
    """
    raise NotImplementedError(
        "resolve_reentry_risk is not ported yet -- see Phases 2-4 in "
        "docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §17"
    )
