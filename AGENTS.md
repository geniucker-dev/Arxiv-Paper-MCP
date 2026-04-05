# AGENTS.md

## Overview

- This repository is a stateless Python MCP server for arXiv search and paper parsing.
- The runtime transport is Streamable HTTP, not stdio.
- The implementation stack is `FastAPI + httpx + official mcp Python SDK`.
- The primary delivery target is a local/server process or container deployment, not package publishing.
- Treat this file as the root instruction set for coding agents working in this repository.

## Instruction sources present in this repo

- Root `AGENTS.md`: this file.
- There is currently **no** `.cursorrules` file.
- There is currently **no** `.cursor/rules/` directory.
- There is currently **no** `.github/copilot-instructions.md` file.

If any of those files are added later, keep this file aligned with them.

## Environment

- Python: `>=3.12`
- Local dev environment: `uv` virtualenv, typically `.venv`
- Package installer: `uv pip`
- Build metadata: `pyproject.toml`
- Source layout: `src/arxiv_paper_mcp_http/`
- Tests: `pytest`
- Container examples use `python:3.12-slim`

## Repository layout

- `src/arxiv_paper_mcp_http/__main__.py` — process entrypoint, uvicorn startup.
- `src/arxiv_paper_mcp_http/app.py` — FastAPI app, CORS, `/health`, MCP mount and lifespan wiring.
- `src/arxiv_paper_mcp_http/config.py` — environment variable parsing and validation.
- `src/arxiv_paper_mcp_http/logger.py` — console logger and `MCP_LOG_LEVEL` handling.
- `src/arxiv_paper_mcp_http/mcp_server.py` — MCP server factory, tool registration, success/error envelopes.
- `src/arxiv_paper_mcp_http/service.py` — arXiv API, HTML fetch, PDF download and parsing logic.
- `tests/http_test_harness.py` — ASGI test helper for MCP HTTP requests.
- `tests/test_http_transport.py` — end-to-end MCP HTTP transport and statelessness tests.
- `tests/test_server_tools.py` — tool-schema and tool-envelope tests.
- `tests/test_service.py` — service-layer parsing and fallback tests.
- `tests/test_runtime_config.py` — env parsing tests.
- `Dockerfile` — container build.
- `docker-compose.yml` — single-service deployment example.
- `.env.example` — example runtime environment values.
- `README.md` — local run and deployment documentation.

## Canonical commands

### Install dependencies

```bash
uv venv --python 3.12
uv pip install -e ".[dev]"
```

### Start the server

```bash
uv run python -m arxiv_paper_mcp_http
```

### Full test suite

```bash
uv run pytest
```

### Run a single test file

```bash
uv run pytest tests/test_runtime_config.py
uv run pytest tests/test_http_transport.py
uv run pytest tests/test_server_tools.py
uv run pytest tests/test_service.py
```

### Deployment checks

```bash
docker build -t arxiv-paper-mcp-http .
docker compose config
docker compose up -d
curl http://127.0.0.1:3000/health
```

## Runtime contract

- Default MCP endpoint: `http://127.0.0.1:3000/mcp`
- Health endpoint: `GET /health` returns `200 {"status":"ok"}`
- MCP endpoint is stateless and uses Streamable HTTP.
- MCP sessions are not required and should not be introduced unless explicitly requested.
- Current implementation expects MCP JSON-RPC requests on `POST /mcp`.
- `/health` is intended for deployment probes and compose health checks.

## Runtime environment variables

- `MCP_HOST` — listen host, default `127.0.0.1`
- `MCP_PORT` — listen port, default `3000`
- `MCP_PATH` — MCP endpoint path, default `/mcp`
- `MCP_LOG_LEVEL` — console log level: `debug`, `info`, `warn`, `error`

Validation rules from `src/arxiv_paper_mcp_http/config.py`:

- `MCP_HOST` must be a non-empty string.
- `MCP_PORT` must be an integer between `1` and `65535`.
- `MCP_PATH` must be non-empty and start with `/`.

For container deployment, prefer:

```bash
MCP_HOST=0.0.0.0
```

## Code style and structure

### Imports

- Use absolute package imports inside `src/arxiv_paper_mcp_http/` when practical.
- Keep imports grouped simply; the current codebase does not use a strict sorted-import tool.

### Formatting

- Follow the existing Python style in `src/arxiv_paper_mcp_http/`:
  - double quotes are not required; match nearby code
  - explicit early returns
  - small modules and function-oriented structure over deep class trees
- Prefer readability over clever compactness.

### Types

- Keep code type-safe.
- Prefer explicit dataclasses or typed helpers for structured values.
- Preserve narrow runtime validation for env/config parsing.
- Do not add `Any` or type suppression unless there is a concrete need.

### Naming

- Use `snake_case` for variables and functions.
- Use `PascalCase` for classes and dataclasses.
- Keep MCP tool names stable and lowercase with underscores:
  - `search_arxiv`
  - `get_recent_ai_papers`
  - `get_arxiv_pdf_url`
  - `parse_paper_content`
- Do not rename public tool names unless explicitly requested and all tests/docs are updated.

### Error handling

- Log operational failures with `logger` from `src/arxiv_paper_mcp_http/logger.py`.
- Raise meaningful `RuntimeError` or `ValueError` instances for internal failures.
- Preserve the current pattern:
  - English logs for operators/debugging
  - Chinese user-facing tool output/error text where that is already part of tool behavior
- Do not silently swallow errors.
- Do not remove cleanup logic around temporary PDF files.

### HTTP/runtime behavior

- Keep `/mcp` and `/health` behavior explicit and small.
- Keep CORS behavior aligned with tests and docs.
- If you change transport semantics, update:
  - `src/arxiv_paper_mcp_http/app.py`
  - `tests/test_http_transport.py`
  - `README.md`
  - `AGENTS.md`
  - Docker/compose files if deploy behavior changes

## MCP-specific guidance

- `src/arxiv_paper_mcp_http/mcp_server.py` is the source of truth for tool registration and handler behavior.
- Use the official Python `mcp` SDK; do not hand-roll JSON-RPC or tool schema plumbing if the SDK already supports it.
- Keep tool schemas explicit and stable.
- Preserve current success/error envelope patterns used by tests.
- Do not add stateful session assumptions unless explicitly requested.
- Do not change response shapes casually; tests intentionally lock down the contract.

## arXiv and HTTP guidance

- Use `httpx.AsyncClient` for outbound HTTP.
- Reuse the shared client created in FastAPI lifespan; do not create a new client per request.
- HTML parsing should remain the first choice for content extraction.
- PDF download/parsing remains the fallback path and still requires writable temp storage.
- If an existing SDK is synchronous and would block the FastAPI request path, prefer `httpx` over forcing that SDK into the async runtime.

## Testing guidance

- Tests are Python files under `tests/` and use `pytest`.
- Prefer ASGI-level tests with `httpx` and lifespan management for transport checks.
- If you change source code, run the narrowest relevant test during iteration, then run the full suite before finishing.

Examples:

```bash
uv run pytest tests/test_http_transport.py
uv run pytest tests/test_server_tools.py
uv run pytest tests/test_service.py
uv run pytest
```

## Deployment and ops guidance

- Keep `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`, and `AGENTS.md` aligned.
- Do not remove `/health` unless deployment docs and health checks are updated together.
- This service requires:
  - outbound network access to arXiv
  - writable temporary storage for PDF fallback parsing
- Public exposure should usually be behind a reverse proxy.
- The service has no built-in authentication; do not present it as internet-safe by default.

## Safety rules

- Never commit `.env` files or secrets.
- Do not change default host/port/path behavior without updating docs and tests.
- Do not widen network exposure silently.
- Do not remove CORS or health behavior without checking browser/deployment implications.
- Do not revert user-visible tool content from Chinese to English unless explicitly requested.

## Definition of done

Before finishing code changes, run the smallest relevant checks first, then the full set as needed.

Minimum for most source changes:

```bash
uv run pytest
```

For runtime/deployment changes, also run:

```bash
docker compose config
```

And if Docker is available, prefer also validating:

```bash
docker build -t arxiv-paper-mcp-http .
docker compose up -d
curl http://127.0.0.1:3000/health
```

## Quick gotchas for agents

- The repo now runs from Python source directly; there is no TypeScript build output.
- Tests rely on FastAPI lifespan startup to initialize the mounted MCP session manager.
- Tool names and text envelopes are part of the tested contract.
- User-visible tool content is intentionally Chinese even though logs are in English.
