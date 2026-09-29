# The Incubator

A locally run engine that turns a plain-English idea and/or an existing repository into a fully scaffolded GitHub repository following the canonical Backshack dev/test framework.

This repo is being bootstrapped from [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md). To build it, open a Claude Code cloud session on this repo (auto mode) and send:

> Read docs/BUILD_PROMPT.md and execute it.

The session writes `docs/TDD.md`, stops for approval, then builds phases 0–6.
