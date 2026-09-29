"""Scenario contract layer: loading, structural validation and assertion evaluation.

A faithful port of `scripts/guard/lib/scenario.mjs`, so Python adapters are judged by exactly the
rules the guard toolkit applies: `a.b[0].c` paths, JSON.stringify equality, JavaScript `undefined`
for paths that do not resolve, and the same failure messages.
"""

import json
import math
import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any, Protocol

OPS = ("eq", "neq", "contains", "matches", "exists", "absent", "gte", "lte", "length")
ONBOARDING_MINIMUM = {"happy": 1, "validation": 2, "fault": 1}

Scenario = dict[str, Any]
Stage = dict[str, Any]


class FeatureAdapter(Protocol):
    """Per-feature adapter: drives the feature the way a user does for one scenario stage."""

    name: str

    def seed_context(self, scenario: Scenario) -> Any: ...

    def run_stage(self, stage: Stage, ctx: Any, scenario: Scenario) -> Any: ...

    def capture_output(self, out: Any, ctx: Any) -> Any: ...

    def validate(self, captured: Any, stage: Stage) -> list[str]: ...


class _Undefined:
    """JavaScript `undefined`: a path that does not resolve (distinct from JSON null)."""

    __slots__ = ()

    def __repr__(self) -> str:
        return "undefined"


UNDEFINED: Any = _Undefined()
_INDEX = re.compile(r"0|[1-9][0-9]*")


def module_name(feature: str) -> str:
    """The adapter/feature module for a feature id: `reorder-alerts` -> `reorder_alerts`."""
    return "_".join(w.lower() for w in re.split(r"[^A-Za-z0-9]+", feature) if w)


# --- JavaScript value semantics -------------------------------------------------------------


def _num(v: object) -> float | None:
    """The value as a float when it is a JSON number (booleans are not numbers), else None."""
    if isinstance(v, bool) or not isinstance(v, int | float):
        return None
    return float(v)


def _js_number(v: float) -> str:
    """Number.prototype.toString (shortest round-trip digits, JavaScript exponent thresholds)."""
    if math.isnan(v):
        return "NaN"
    if math.isinf(v):
        return "Infinity" if v > 0 else "-Infinity"
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    parts = Decimal(repr(abs(v))).normalize().as_tuple()
    digits = "".join(str(d) for d in parts.digits)
    k = len(digits)
    n = int(parts.exponent) + k
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = f"{digits[:n]}.{digits[n:]}"
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        mantissa = digits if k == 1 else f"{digits[0]}.{digits[1:]}"
        body = f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + body


def _is_array_index(key: str) -> bool:
    return _INDEX.fullmatch(key) is not None and int(key) < 2**32 - 1


def js_stringify(v: object) -> str | None:
    """JSON.stringify(v); None stands for JavaScript's `undefined` result."""
    if v is UNDEFINED:
        return None
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    n = _num(v)
    if n is not None:
        return _js_number(n) if math.isfinite(n) else "null"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list | tuple):
        return "[" + ",".join(js_stringify(x) or "null" for x in v) + "]"
    if isinstance(v, dict):
        keys = [str(k) for k in v]
        ordered = sorted((k for k in keys if _is_array_index(k)), key=int) + [
            k for k in keys if not _is_array_index(k)
        ]
        values = {str(k): x for k, x in v.items()}
        parts = []
        for k in ordered:
            s = js_stringify(values[k])
            if s is not None:
                parts.append(json.dumps(k, ensure_ascii=False) + ":" + s)
        return "{" + ",".join(parts) + "}"
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str)


def js_string(v: object) -> str:
    """String(v), as template literals render values."""
    if v is UNDEFINED:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    n = _num(v)
    if n is not None:
        return _js_number(n)
    if isinstance(v, str):
        return v
    if isinstance(v, list | tuple):
        return ",".join("" if x is None or x is UNDEFINED else js_string(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def _to_number(v: object) -> float:
    """ToNumber(v) for relational comparisons."""
    if v is UNDEFINED:
        return math.nan
    if v is None or v is False:
        return 0.0
    if v is True:
        return 1.0
    n = _num(v)
    if n is not None:
        return n
    if isinstance(v, str):
        text = v.strip()
        if text == "":
            return 0.0
        try:
            return float(text)
        except ValueError:
            return math.nan
    if isinstance(v, list | tuple):
        return _to_number(js_string(v))
    return math.nan


def _strict_equal(a: object, b: object) -> bool:
    """a === b."""
    na, nb = _num(a), _num(b)
    if na is not None and nb is not None:
        return na == nb
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, bool) and isinstance(b, bool):
        return a == b
    return a is b


def _utf16_length(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def _member(value: object, key: str) -> object:
    if isinstance(value, dict):
        return value.get(key, UNDEFINED)
    if isinstance(value, str):
        if key == "length":
            return _utf16_length(value)
        if _is_array_index(key):
            units = value.encode("utf-16-le")
            i = int(key)
            if i < len(units) // 2:
                return units[2 * i : 2 * i + 2].decode("utf-16-le", errors="surrogatepass")
        return UNDEFINED
    if isinstance(value, list | tuple):
        if key == "length":
            return len(value)
        if _is_array_index(key) and int(key) < len(value):
            return value[int(key)]
        return UNDEFINED
    return UNDEFINED


# --- scenario.mjs ---------------------------------------------------------------------------


def get_path(obj: object, p: str) -> object:
    """Reads `a.b[0].c` style paths; UNDEFINED when the path does not resolve."""
    if p in ("", "$"):
        return obj
    parts = [x for x in re.sub(r"\[([0-9]+)\]", r".\1", p).split(".") if x]
    cur = obj
    for part in parts:
        if cur is None or cur is UNDEFINED:
            return UNDEFINED
        cur = _member(cur, part)
    return cur


def deep_equal(a: object, b: object) -> bool:
    return js_stringify(a) == js_stringify(b)


def _show(v: object) -> str:
    s = js_stringify(v)
    return "undefined" if s is None else s


def evaluate_assertion(output: object, assertion: dict[str, Any]) -> str | None:
    """Returns None when the assertion holds, else a human-readable failure."""
    p = assertion["path"]
    op = assertion.get("op", UNDEFINED)
    value = assertion.get("value", UNDEFINED)
    actual = get_path(output, p)
    if op == "eq":
        if deep_equal(actual, value):
            return None
        return f"{p}: expected {_show(value)}, got {_show(actual)}"
    if op == "neq":
        return None if not deep_equal(actual, value) else f"{p}: expected not {_show(value)}"
    if op == "contains":
        if isinstance(actual, str):
            if js_string(value) in actual:
                return None
            return f"{p}: {_show(actual)} does not contain {_show(value)}"
        if isinstance(actual, list):
            if any(deep_equal(x, value) for x in actual):
                return None
            return f"{p}: array lacks {_show(value)}"
        return f"{p}: cannot apply contains to {_show(actual)}"
    if op == "matches":
        if isinstance(actual, str) and re.search(js_string(value), actual):
            return None
        return f"{p}: {_show(actual)} does not match /{js_string(value)}/"
    if op == "exists":
        return None if actual is not UNDEFINED else f"{p}: expected to exist"
    if op == "absent":
        return None if actual is UNDEFINED else f"{p}: expected to be absent, got {_show(actual)}"
    if op in ("gte", "lte"):
        a, b = _num(actual), _to_number(value)
        if a is not None and ((a >= b) if op == "gte" else (a <= b)):
            return None
        sign = ">=" if op == "gte" else "<="
        return f"{p}: expected {sign} {js_string(value)}, got {_show(actual)}"
    if op == "length":
        length = UNDEFINED if actual is None or actual is UNDEFINED else _member(actual, "length")
        if actual is not None and actual is not UNDEFINED and _strict_equal(length, value):
            return None
        return f"{p}: expected length {js_string(value)}, got {_show(length)}"
    return f"{p}: unknown op {js_string(op)}"


def _is_obj(v: object) -> bool:
    return isinstance(v, dict)


def validate_scenario(s: object) -> list[str]:
    """Structural check mirroring schemas/scenario.schema.json."""
    if not isinstance(s, dict):
        return ["scenario must be an object"]
    errors: list[str] = []
    sid = s.get("id")
    if not isinstance(sid, str) or re.fullmatch(r"[a-z0-9][a-z0-9-]*", sid) is None:
        errors.append("id must be kebab-case")
    feature = s.get("feature")
    if not isinstance(feature, str) or not feature:
        errors.append("feature is required")
    tags = s.get("tags")
    if not isinstance(tags, list) or len(tags) == 0:
        errors.append("tags must be a non-empty array")
    if "status" in s and s["status"] not in ("active", "todo"):
        errors.append("status must be active or todo")
    for k in ("seed", "context", "mocks"):
        if not _is_obj(s.get(k)):
            errors.append(f"{k} must be an object")
    mocks = s.get("mocks")
    if isinstance(mocks, dict) and "ai" in mocks and not isinstance(mocks["ai"], list):
        errors.append("mocks.ai must be an array")
    stages = s.get("stages")
    if not isinstance(stages, list) or len(stages) == 0:
        errors.append("stages must be a non-empty array")
        return errors
    for i, st in enumerate(stages):
        stage = st if isinstance(st, dict) else {}
        if not isinstance(stage.get("name"), str):
            errors.append(f"stages[{i}].name is required")
        assertions = stage.get("assertions")
        if not isinstance(assertions, list) or len(assertions) == 0:
            errors.append(f"stages[{i}].assertions must be non-empty")
            continue
        for j, a in enumerate(assertions):
            item = a if isinstance(a, dict) else {}
            if not isinstance(item.get("path"), str):
                errors.append(f"stages[{i}].assertions[{j}].path is required")
            if item.get("op") not in OPS:
                errors.append(f"stages[{i}].assertions[{j}].op must be one of {', '.join(OPS)}")
    return errors


@dataclass
class LoadedScenario:
    file: str
    dir_feature: str
    data: Any
    errors: list[str] = field(default_factory=list)


def _reject_constant(name: str) -> None:
    raise ValueError(f"{name} is not valid JSON")


def _js_truthy(v: object) -> bool:
    if v is None or v is False or v is UNDEFINED:
        return False
    n = _num(v)
    if n is not None:
        return n != 0 and not math.isnan(n)
    if isinstance(v, str):
        return v != ""
    return True


def load_scenarios(root: Path, directory: str = "tests/scenarios") -> list[LoadedScenario]:
    """Loads every `<directory>/<feature>/*.json` scenario, sorted by feature then file."""
    base = root / directory
    out: list[LoadedScenario] = []
    if not base.is_dir():
        return out
    for feature in sorted(d.name for d in base.iterdir() if d.is_dir()):
        for name in sorted(f.name for f in (base / feature).iterdir() if f.name.endswith(".json")):
            rel = f"{directory}/{feature}/{name}"
            try:
                data = json.loads(
                    (base / feature / name).read_text(encoding="utf-8"),
                    parse_constant=_reject_constant,
                )
            except ValueError as e:
                out.append(LoadedScenario(rel, feature, None, [f"invalid JSON: {e}"]))
                continue
            errors = validate_scenario(data)
            if _js_truthy(data):
                declared = data.get("feature", UNDEFINED) if isinstance(data, dict) else UNDEFINED
                if not (isinstance(declared, str) and declared == feature):
                    errors.append(
                        f'feature "{js_string(declared)}" does not match directory "{feature}"'
                    )
            out.append(LoadedScenario(rel, feature, data, errors))
    return out


def select_for_profile(scenarios: list[LoadedScenario], tags: list[str]) -> list[LoadedScenario]:
    """Scenarios selected by a profile's tags: tag intersection, or all for ["*"]."""
    return [
        s
        for s in scenarios
        if _js_truthy(s.data)
        and isinstance(s.data, dict)
        and ("*" in tags or any(t in tags for t in s.data.get("tags") or []))
    ]
