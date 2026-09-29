"""Environment loading: `.env`, then `private/.env`; real environment variables always win."""

import os
import re
from collections.abc import MutableMapping, Sequence
from pathlib import Path


def parse_env(text: str) -> dict[str, str]:
    """Parses KEY=value lines (quotes stripped, # comments ignored)."""
    out: dict[str, str] = {}
    for raw in re.split(r"\r?\n", text):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        eq = line.find("=")
        if eq <= 0:
            continue
        key = line[:eq].strip()
        value = line[eq + 1 :].strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        out[key] = value
    return out


def load_env(
    files: Sequence[str] = (".env", "private/.env"),
    env: MutableMapping[str, str] | None = None,
) -> list[str]:
    """Loads each file in order. A later file only fills keys that are still missing, and variables
    already in the environment always win. Returns the keys that were set."""
    target = os.environ if env is None else env
    added: list[str] = []
    for file in files:
        path = Path(file)
        if not path.is_file():
            continue
        for key, value in parse_env(path.read_text(encoding="utf-8")).items():
            if key not in target:
                target[key] = value
                added.append(key)
    return added
