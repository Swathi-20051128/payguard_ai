"""
PayGuard AI — ML Service (FastAPI)

Defense-only anomaly detection and risk-scoring service. This service
never takes real payment action; it returns scores, reason codes, and
explanations for the Node backend and human analysts to act on.

Endpoints are added incrementally by phase:
  Phase 1: GET  /ml/health
  Phase 5: POST /ml/analyze/transaction, /ml/analyze/batch, /ml/evaluate
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import model_state
from app.config import settings
from app.routes.health import router as health_router
from app.routes.ml import router as ml_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load persisted model artifacts once at startup. If none exist
    # yet (training hasn't run), the service still comes up — /ml/health
    # reports modelLoaded: false and the analyze routes return a clear
    # 503 rather than crashing, so the Node backend can fall back to
    # rule-based detection (see Phase 4 / spec failure-handling).
    model_state.load()
    yield


app = FastAPI(
    title=settings.app_name,
    description="Explainable risk-scoring and anomaly-detection service for PayGuard AI (test-mode only).",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS is permissive here because this service is only ever called
# server-to-server by the trusted Express backend, not by browsers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(ml_router)


@app.get("/")
def root():
    return {"service": settings.app_name, "status": "running"}
