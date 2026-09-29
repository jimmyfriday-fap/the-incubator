"""Process entry point: `python -m <package>` serves the app with uvicorn."""

import os
from collections.abc import Mapping
from functools import partial

import uvicorn
from fastapi import FastAPI

from .app import AppDeps, build_app
from .db import check_database
from .env import load_env
from .features.health import HealthDeps


def create_app(env: Mapping[str, str]) -> FastAPI:
    """The app wired to the database named by DATABASE_URL (health reports it when it is set)."""
    url = env.get("DATABASE_URL")
    if not url:
        return build_app()
    return build_app(AppDeps(health=HealthDeps(check_database=partial(check_database, url))))


def run() -> None:  # pragma: no cover - exercised by the e2e suite
    """Loads `.env` files, then serves on HOST:PORT (default 0.0.0.0:8000)."""
    load_env()
    # why: in a container the service must listen on every interface; set HOST to narrow it.
    host = os.environ.get("HOST", "0.0.0.0")  # noqa: S104
    uvicorn.run(create_app(os.environ), host=host, port=int(os.environ.get("PORT", "8000")))
