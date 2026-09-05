"""Model registry: model_id -> version / parameter_set / status.

See docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §18-19: a model_version is
distinct from this service's own API/deploy version, and every production
model result must be traceable to a
(model_id, model_version, parameter_set_id, calibration_version) tuple.

No model is "production" yet. reentry_resolution stays "experimental" until
the re-entry migration sequence (plan §17, Phases 1-9) reaches shadow-mode
comparison against the existing TypeScript resolveReentryRisk() and clears
canary evaluation. Update this entry's status deliberately as each phase
lands -- don't bump it ahead of the phase that's actually done.
"""

MODEL_REGISTRY: dict[str, dict[str, str]] = {
    "reentry_resolution": {
        "version": "0.1.0",
        "parameter_set": "reentry-2026-09-baseline",
        "status": "experimental",
    },
}
