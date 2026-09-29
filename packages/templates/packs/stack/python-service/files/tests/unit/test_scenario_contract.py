"""The Python port of scripts/guard/lib/scenario.mjs behaves like the JavaScript original."""

import json
from pathlib import Path
from typing import Any

import pytest

from tests.scenario_contract import (
    UNDEFINED,
    evaluate_assertion,
    get_path,
    js_stringify,
    load_scenarios,
    module_name,
    select_for_profile,
    validate_scenario,
)

OUTPUT: dict[str, Any] = {
    "status": "ok",
    "count": 3,
    "ratio": 0.5,
    "checks": [{"name": "database", "ok": True}],
    "tags": ["a", "b"],
    "nothing": None,
}


def check(op: str, path: str, value: Any = UNDEFINED) -> str | None:
    assertion: dict[str, Any] = {"path": path, "op": op}
    if value is not UNDEFINED:
        assertion["value"] = value
    return evaluate_assertion(OUTPUT, assertion)


def test_paths_resolve_like_javascript() -> None:
    assert get_path(OUTPUT, "checks[0].name") == "database"
    assert get_path(OUTPUT, "checks.0.ok") is True
    assert get_path(OUTPUT, "checks.length") == 1
    assert get_path(OUTPUT, "status.length") == 2
    assert get_path(OUTPUT, "") is OUTPUT
    assert get_path(OUTPUT, "$") is OUTPUT
    assert get_path(OUTPUT, "missing.deeper") is UNDEFINED
    assert get_path(OUTPUT, "nothing") is None
    assert get_path(OUTPUT, "nothing.x") is UNDEFINED
    assert get_path(OUTPUT, "checks[01]") is UNDEFINED


def test_stringify_matches_json_stringify() -> None:
    assert js_stringify({"b": 1, "a": [1.0, None, True]}) == '{"b":1,"a":[1,null,true]}'
    assert js_stringify({"2": "x", "1": "y", "k": UNDEFINED}) == '{"1":"y","2":"x"}'
    assert js_stringify(1e21) == "1e+21"
    assert js_stringify(1e-7) == "1e-7"
    assert js_stringify(0.000001) == "0.000001"
    assert js_stringify(float("nan")) == "null"
    assert js_stringify(UNDEFINED) is None
    assert js_stringify("café") == '"café"'


@pytest.mark.parametrize(
    ("op", "path", "value"),
    [
        ("eq", "status", "ok"),
        ("eq", "count", 3.0),
        ("neq", "status", "error"),
        ("contains", "status", "o"),
        ("contains", "tags", "b"),
        ("matches", "status", "^o"),
        ("exists", "nothing", UNDEFINED),
        ("absent", "missing", UNDEFINED),
        ("gte", "count", 3),
        ("lte", "ratio", "0.5"),
        ("length", "checks", 1),
        ("length", "status", 2),
    ],
)
def test_passing_assertions(op: str, path: str, value: Any) -> None:
    assert check(op, path, value) is None


@pytest.mark.parametrize(
    ("op", "path", "value", "message"),
    [
        ("eq", "status", "error", 'status: expected "error", got "ok"'),
        ("eq", "missing", None, "missing: expected null, got undefined"),
        ("neq", "count", 3, "count: expected not 3"),
        ("contains", "status", "x", 'status: "ok" does not contain "x"'),
        ("contains", "tags", "z", 'tags: array lacks "z"'),
        ("contains", "count", 1, "count: cannot apply contains to 3"),
        ("matches", "count", "3", "count: 3 does not match /3/"),
        ("exists", "missing", UNDEFINED, "missing: expected to exist"),
        ("absent", "count", UNDEFINED, "count: expected to be absent, got 3"),
        ("gte", "count", 4, "count: expected >= 4, got 3"),
        ("lte", "status", 1, 'status: expected <= 1, got "ok"'),
        ("length", "count", 1, "count: expected length 1, got undefined"),
        ("length", "missing", 0, "missing: expected length 0, got undefined"),
        ("nope", "status", UNDEFINED, "status: unknown op nope"),
    ],
)
def test_failing_assertions_report_like_the_toolkit(
    op: str, path: str, value: Any, message: str
) -> None:
    assert check(op, path, value) == message


def test_validation_mirrors_the_schema() -> None:
    assert validate_scenario([]) == ["scenario must be an object"]
    errors = validate_scenario(
        {"id": "Bad Id", "tags": [], "status": "done", "mocks": {"ai": {}}, "stages": [{}]}
    )
    assert errors == [
        "id must be kebab-case",
        "feature is required",
        "tags must be a non-empty array",
        "status must be active or todo",
        "seed must be an object",
        "context must be an object",
        "mocks.ai must be an array",
        "stages[0].name is required",
        "stages[0].assertions must be non-empty",
    ]


def test_loads_and_selects_scenarios(tmp_path: Path) -> None:
    scenario = {
        "id": "happy-path",
        "feature": "reorder-alerts",
        "tags": ["happy"],
        "seed": {},
        "context": {},
        "mocks": {"ai": []},
        "stages": [{"name": "run", "input": {}, "assertions": [{"path": "", "op": "exists"}]}],
    }
    feature_dir = tmp_path / "tests" / "scenarios" / "reorder-alerts"
    feature_dir.mkdir(parents=True)
    (feature_dir / "happy-path.json").write_text(json.dumps(scenario), encoding="utf-8")
    (feature_dir / "broken.json").write_text("{", encoding="utf-8")
    wrong = {**scenario, "feature": "other"}
    (feature_dir / "wrong.json").write_text(json.dumps(wrong), encoding="utf-8")
    loaded = load_scenarios(tmp_path)
    assert [s.file.rsplit("/", 1)[1] for s in loaded] == [
        "broken.json",
        "happy-path.json",
        "wrong.json",
    ]
    assert loaded[0].data is None
    assert loaded[0].errors[0].startswith("invalid JSON")
    assert loaded[1].errors == []
    assert loaded[2].errors == ['feature "other" does not match directory "reorder-alerts"']
    assert len(select_for_profile(loaded, ["happy"])) == 2
    assert select_for_profile(loaded, ["fault"]) == []
    assert len(select_for_profile(loaded, ["*"])) == 2
    assert load_scenarios(tmp_path / "nowhere") == []


def test_module_names_are_snake_case() -> None:
    assert module_name("reorder-alerts") == "reorder_alerts"
    assert module_name("health") == "health"
