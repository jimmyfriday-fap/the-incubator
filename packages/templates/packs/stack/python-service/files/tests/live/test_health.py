"""Live smoke against a deployed lane (INCUBATOR_LIVE=1 and BASE_URL, e.g. the staging host)."""

import os

import httpx2
import pytest

BASE_URL = os.environ.get("BASE_URL", "")

pytestmark = pytest.mark.skipif(
    os.environ.get("INCUBATOR_LIVE") != "1" or not BASE_URL,
    reason="needs INCUBATOR_LIVE=1 and BASE_URL",
)


def test_answers_ok() -> None:
    response = httpx2.get(f"{BASE_URL.rstrip('/')}/health", timeout=10)
    assert response.status_code == 200
