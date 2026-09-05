"""
Holds the loaded models in memory for the life of the process.
Loaded once at startup (see main.py's lifespan) rather than per
request -- joblib.load + rebuilding the SHAP explainer are not cheap
enough to repeat on every call.
"""
from __future__ import annotations

from typing import Optional

from app.config import settings
from app.core.model import LoadedModels, load_models

_state = {"models": None}


def load() -> None:
    _state["models"] = load_models(settings.model_dir)


def get_models() -> Optional[LoadedModels]:
    return _state["models"]
