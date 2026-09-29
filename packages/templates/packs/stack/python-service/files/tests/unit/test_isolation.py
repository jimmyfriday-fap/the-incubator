"""The unit-suite harness (tests/conftest.py) blocks everything but loopback."""

import os
import socket

import pytest

from tests.conftest import PROXY_VARIABLES, NetworkBlockedError


def test_non_loopback_connections_are_blocked() -> None:
    with socket.socket() as sock, pytest.raises(NetworkBlockedError):
        sock.connect(("192.0.2.1", 80))


def test_name_resolution_is_blocked() -> None:
    with pytest.raises(NetworkBlockedError):
        socket.getaddrinfo("example.com", 443)


def test_proxies_are_cleared() -> None:
    assert not [name for name in PROXY_VARIABLES if name in os.environ]


def test_loopback_is_allowed() -> None:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        with socket.socket() as client:
            client.connect(server.getsockname())
