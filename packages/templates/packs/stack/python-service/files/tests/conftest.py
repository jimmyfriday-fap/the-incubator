"""Shared pytest wiring: suite markers by directory and the unit-suite isolation harness.

Every test under tests/unit/ (and the scenario contract layer, tests/test_scenarios.py) is marked
`unit` and runs with the network and the database driver blocked: a connection to anything but
loopback fails the test immediately.
"""

import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest

TESTS = Path(__file__).resolve().parent
SUITES = ("unit", "integration", "live", "e2e")
LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost", ""})
# A proxy on loopback would otherwise carry traffic out of the unit suite.
PROXY_VARIABLES = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


class NetworkBlockedError(RuntimeError):
    """Raised when a unit test reaches for the network or the database."""


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        try:
            parts = Path(item.path).resolve().relative_to(TESTS).parts
        except ValueError:
            continue
        if parts and parts[0] in SUITES:
            item.add_marker(parts[0])
        elif parts == ("test_scenarios.py",):
            item.add_marker("unit")


def _host(address: object) -> str | None:
    """The host of an AF_INET/AF_INET6 address tuple; None for AF_UNIX paths and the like."""
    if isinstance(address, tuple) and address and isinstance(address[0], str):
        return address[0]
    return None


def _blocked(what: str) -> NetworkBlockedError:
    return NetworkBlockedError(f"unit tests must not touch the network ({what})")


@pytest.fixture(autouse=True)
def no_network(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    if request.node.get_closest_marker("unit") is None:
        yield
        return
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def connect(self: socket.socket, address: Any) -> None:
        host = _host(address)
        if host is not None and host not in LOOPBACK:
            raise _blocked(f"connect {host}")
        real_connect(self, address)

    def connect_ex(self: socket.socket, address: Any) -> int:
        host = _host(address)
        if host is not None and host not in LOOPBACK:
            raise _blocked(f"connect {host}")
        return real_connect_ex(self, address)

    def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
        name = host.decode() if isinstance(host, bytes) else host
        if name is not None and name not in LOOPBACK:
            raise _blocked(f"resolve {name}")
        return real_getaddrinfo(host, *args, **kwargs)

    def database(*_args: Any, **_kwargs: Any) -> Any:
        raise _blocked("database driver")

    for name in PROXY_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(psycopg, "connect", database)
    monkeypatch.setattr(psycopg.Connection, "connect", classmethod(database))
    monkeypatch.setattr(psycopg.AsyncConnection, "connect", classmethod(database))
    yield
