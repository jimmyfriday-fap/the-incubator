"""Scenario contract layer: every tests/scenarios/<feature>/*.json runs through
tests/adapters/<feature>.py (hyphens become underscores).

INCUBATOR_SCENARIO_TAGS (set by `node scripts/test-profile.mjs <name>`) narrows the set, `live`
scenarios need INCUBATOR_LIVE=1, and `"status": "todo"` scenarios are reported as skipped until an
agent activates them.
"""

import importlib
import os
from pathlib import Path
from typing import Any

import pytest

from tests.scenario_contract import (
    FeatureAdapter,
    LoadedScenario,
    evaluate_assertion,
    load_scenarios,
    module_name,
    select_for_profile,
)

ROOT = Path(__file__).resolve().parent.parent
WANTED = [t for t in os.environ.get("INCUBATOR_SCENARIO_TAGS", "*").split(",") if t]
LIVE = os.environ.get("INCUBATOR_LIVE") == "1"
SCENARIOS = select_for_profile(load_scenarios(ROOT), WANTED)


def _param(loaded: LoadedScenario) -> Any:
    data = loaded.data
    marks = []
    if data.get("status") == "todo":
        marks.append(pytest.mark.skip(reason="todo scenario: replace its stub to activate it"))
    elif "live" in (data.get("tags") or []) and not LIVE:
        marks.append(pytest.mark.skip(reason="live scenario: set INCUBATOR_LIVE=1"))
    return pytest.param(loaded, id=f"{data.get('feature')}/{data.get('id')}", marks=marks)


def load_adapter(feature: str) -> FeatureAdapter:
    module = importlib.import_module(f"tests.adapters.{module_name(feature)}")
    adapter: FeatureAdapter = module.adapter
    return adapter


def test_found_scenarios_to_run() -> None:
    assert len(SCENARIOS) > 0, f"no scenarios selected for tags {WANTED}"


@pytest.mark.parametrize("loaded", [_param(s) for s in SCENARIOS])
def test_scenario(loaded: LoadedScenario) -> None:
    assert loaded.errors == []
    scenario = loaded.data
    adapter = load_adapter(scenario["feature"])
    ctx = adapter.seed_context(scenario)
    for stage in scenario["stages"]:
        captured = adapter.capture_output(adapter.run_stage(stage, ctx, scenario), ctx)
        failures = [
            failure
            for failure in (evaluate_assertion(captured, a) for a in stage["assertions"])
            if failure is not None
        ]
        failures.extend(adapter.validate(captured, stage))
        assert failures == [], f"{loaded.file} stage {stage['name']}"
