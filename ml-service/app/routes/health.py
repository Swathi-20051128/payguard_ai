"""
Health endpoint for the ML service.

Reports whether a trained model is currently loaded IN MEMORY (not
just present on disk) so the backend (and the Node rule-engine
fallback logic from Phase 4/6) can decide whether to trust ML scores
or fall back to rules-only mode.
"""
from datetime import datetime, timezone

from fastapi import APIRouter

from app import model_state
from app.config import settings

router = APIRouter()


@router.get("/ml/health")
def health():
    models = model_state.get_models()

    return {
        "status": "ok",
        "service": "payguard-ml-service",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "modelVersion": models.metadata.get("modelVersion") if models else settings.model_version,
        "modelLoaded": models is not None,
        "trainedAt": models.metadata.get("trainedAt") if models else None,
        "trainRowCount": models.metadata.get("trainRowCount") if models else None,
        "environment": settings.environment,
    }
