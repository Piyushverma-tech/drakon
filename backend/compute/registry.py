"""Model registry: model_id -> version / parameter_set / status.

See docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §18-19: a model_version is
distinct from this service's own API/deploy version, and every production
model result must be traceable to a
(model_id, model_version, parameter_set_id, calibration_version) tuple.
That traceability now extends to the wire: every /compute/* response
carries this registry entry's data in its `model` envelope field, not just
the /models listing -- see contracts.py's ModelProvenance/ComputeResponse.

No model is "production" yet. reentry_resolution stays "experimental" until
the re-entry migration sequence (plan §17, Phases 1-9) reaches shadow-mode
comparison against the existing TypeScript resolveReentryRisk() and clears
canary evaluation. Update this entry's status deliberately as each phase
lands -- don't bump it ahead of the phase that's actually done.

reentry_resolution version history (intended, not yet all real):
  0.1.0 -- this port. Exact migration of the existing TS resolveReentryRisk()
    or thereabouts (per-phase float tolerance documented in
    tests/_golden_compare.py) -- Phases 1-4 done, this is the current
    version. Takes one pre-composed solarFluxMultiplier as its only
    environmental input.
  0.2.0 -- geomagnetic-aware model (not started; geomagnetic-correction
    work is happening in parallel on the TS side). Will decompose the
    single solarFluxMultiplier input into solarFluxMultiplier and a
    separate geomagnetic correction once that TS work lands and this
    model has full parity with its 0.1.0 TS reference. No geomagnetic
    logic belongs in this model before that parity is established --
    see contracts.py's ReentryComputeInput.
"""

ENGINE_VERSION = "0.1.0"

MODEL_REGISTRY: dict[str, dict[str, str]] = {
    "reentry_resolution": {
        "version": "0.1.0",
        "parameter_set": "reentry-2026-09-baseline",
        "status": "experimental",
    },
}
