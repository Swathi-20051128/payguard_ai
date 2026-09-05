"""
Centralized configuration for the PayGuard AI ML service.

Loaded once at import time from environment variables (with sane
defaults for local development). This service is defense-only /
test-mode: it scores risk and explains signals, it never executes
real payment actions.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=())

    app_name: str = "PayGuard AI ML Service"
    ml_service_port: int = 8001
    model_dir: str = "./models"
    model_version: str = "isolation-forest-v1"
    environment: str = "development"


settings = Settings()
