# DRAKON Compute Engine

Private FastAPI service for server-side scientific models. Full rationale:
`docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md`.

## What this is (and isn't) yet

Only `/health` and `/models` exist right now. There are no `/compute/*`
routes -- those get added once a real model function exists behind them.
The first one will be the re-entry model, once Phases 2-4 of the migration
sequence (plan §17) land in `compute/reentry.py`.

## Boundary rule: this service does not know it's on Vercel

- `main.py` and `contracts.py` may know about HTTP/FastAPI/Pydantic. They
  must never read `BACKEND_URL`, reference "service bindings", "rewrites",
  or any other Vercel-specific concept. That knowledge belongs entirely to
  the Next.js caller.
- `compute/*.py` may not import FastAPI or Pydantic contracts at all. Every
  function there takes and returns plain Python (dict/dataclass), and must
  be callable and testable with zero knowledge of how it's deployed.

Why: the escape hatch this project wants is

```
Next.js
   |
   | stable HTTP contract
   v
Compute interface (a small TS client -- lands with Phase 6)
   |
   +-- Vercel Service today (backend/, via BACKEND_URL)
   |
   +-- conventional Python Function / separate service later
```

If `compute/` code ever mentions Vercel, that escape hatch is gone --
moving off Services would mean rewriting the model, not just redeploying
it. Keeping the model layer deployment-agnostic is what makes "add another
Python service later" or "move this off Services" a config change instead
of a rewrite.

## Local development

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn main:app --reload --port 8000
```

## Deployment topology

Declared in `/vercel.json`. This service (`compute-engine`) has no entry in
the top-level `rewrites` list, so it receives no public traffic -- Vercel
Services are private by default and only become public when a rewrite
targets them. The `web` (Next.js) service reaches it via a `bindings` entry
that injects `BACKEND_URL` as an internal-network URL at runtime.

One manual step this repo can't encode: in Vercel's Project Settings ->
Build and Deployment, the project Framework must be set to **Services**
for `vercel.json`'s `services` key to take effect at all.
