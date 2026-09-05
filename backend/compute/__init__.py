"""Scientific model implementations.

Nothing in this package may import FastAPI, Pydantic request/response
contracts, or anything Vercel-specific (env var names, service bindings,
rewrites). Every function here should be callable and testable as plain
Python with no knowledge of how it's deployed or invoked -- see
backend/README.md and docs/DRAKON_COMPUTE_ENGINE_EXTRACTION_PLAN.md §26.
"""
