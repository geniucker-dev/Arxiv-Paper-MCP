# AGENTS.md

## Overview

- This repository is a stateless Node.js + TypeScript MCP server for arXiv search and paper parsing.
- The runtime transport is Streamable HTTP, not stdio.
- The primary delivery target is a local/server process or container deployment, not npm publishing.
- Treat this file as the root instruction set for coding agents working in this repository.

## Instruction sources present in this repo

- Root `AGENTS.md`: this file.
- There is currently **no** `.cursorrules` file.
- There is currently **no** `.cursor/rules/` directory.
- There is currently **no** `.github/copilot-instructions.md` file.

If any of those files are added later, keep this file aligned with them.

## Environment

- Node.js: `>=18` locally.
- Container examples use `node:20`.
- Package manager: `npm`.
- Module system: ESM (`"type": "module"`).
- TypeScript is compiled from `src/` into `build/`.

## Repository layout

- `src/index.ts` — HTTP runtime entrypoint, routing, CORS, `/health`, MCP transport wiring.
- `src/createServer.ts` — MCP server factory, tool registration, arXiv/PDF/HTML logic.
- `src/runtimeConfig.ts` — environment variable parsing and validation.
- `src/logger.ts` — console logger and `MCP_LOG_LEVEL` handling.
- `src/httpTestHarness.ts` — helper that boots the real HTTP runtime for tests.
- `test/http-transport.test.js` — end-to-end HTTP/runtime contract tests.
- `test/create-server-factory.test.js` — factory/tool-schema/tool-envelope tests.
- `test/runtime-config.test.js` — env parsing tests.
- `Dockerfile` — multi-stage container build.
- `docker-compose.yml` — single-service deployment example.
- `.env.example` — example runtime environment values.
- `README.md` — local run and deployment documentation.

## Canonical commands

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Start the compiled server

```bash
npm start
```

This runs `node build/index.js`, so `build/` must exist first.

### Dev workflow

```bash
npm run dev
```

Important: `npm run dev` is only `tsc --watch`. It does **not** run the server process for you.
Use a second terminal to start the built server.

### Full test suite

```bash
npm test
```

This expands to:

```bash
npm run build && node --test test/*.test.js
```

### Run a single test file

Because tests import from `../build/*.js`, always build first:

```bash
npm run build && node --test test/runtime-config.test.js
```

Other examples:

```bash
npm run build && node --test test/http-transport.test.js
npm run build && node --test test/create-server-factory.test.js
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

Validation rules from `src/runtimeConfig.ts`:

- `MCP_HOST` must be a non-empty string.
- `MCP_PORT` must be an integer between `1` and `65535`.
- `MCP_PATH` must be non-empty and start with `/`.

For container deployment, prefer:

```bash
MCP_HOST=0.0.0.0
```

## Code style and structure

### Imports

- Use ESM imports.
- For local TypeScript modules, use the runtime `.js` suffix in import paths.
  - Good: `import { logger } from "./logger.js";`
  - Bad: `import { logger } from "./logger";`
- Keep imports grouped simply; the current codebase does not use a strict sorted-import tool.

### Formatting

- Follow the existing style in `src/`:
  - double quotes
  - semicolons
  - trailing commas where natural in multiline objects/arrays
  - simple function-first modules rather than large class hierarchies
- Prefer readable early returns over deep nesting.

### Types

- TypeScript `strict` mode is enabled; keep code type-safe.
- Prefer explicit `type` aliases for small structured values.
- Preserve narrow runtime validation for env/config parsing.
- Do not add `any`, `@ts-ignore`, or other type suppression shortcuts.
- If a value is genuinely dynamic, narrow it with runtime checks before use.

### Naming

- Use `camelCase` for variables and functions.
- Use `PascalCase` for types where appropriate.
- Keep MCP tool names stable and lowercase with underscores:
  - `search_arxiv`
  - `get_recent_ai_papers`
  - `get_arxiv_pdf_url`
  - `parse_paper_content`
- Do not rename public tool names unless explicitly requested and all tests/docs are updated.

### Error handling

- Log operational failures with `logger` from `src/logger.ts`.
- Throw meaningful `Error` instances for internal failures.
- Preserve the current pattern:
  - English logs for operators/debugging
  - Chinese user-facing tool output/error text where that is already part of tool behavior
- Do not silently swallow errors.
- Do not remove cleanup logic around temporary PDF files.

### HTTP/runtime behavior

- Keep `/mcp` and `/health` behavior explicit and small.
- Keep CORS behavior aligned with tests and docs.
- If you change transport semantics, update:
  - `src/index.ts`
  - `test/http-transport.test.js`
  - `README.md`
  - `AGENTS.md`
  - Docker/compose files if deploy behavior changes

## MCP-specific guidance

- `src/createServer.ts` is the source of truth for tool registration and handler behavior.
- Keep tool schemas explicit and stable.
- Preserve current success/error envelope patterns used by tests.
- Do not add stateful session assumptions unless explicitly requested.
- Do not change response shapes casually; tests intentionally lock down the contract.

## Testing guidance

- Tests are plain `.js` files using Node’s built-in test runner.
- Tests import compiled modules from `build/`, not source files from `src/`.
- If you change source code, build before running targeted tests.
- Prefer the narrowest relevant test during iteration, then run `npm test` before finishing.

Examples:

```bash
npm run build && node --test test/http-transport.test.js
npm run build && node --test test/create-server-factory.test.js
npm run build && node --test test/runtime-config.test.js
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
- Do not treat npm publishing as the primary workflow.
- Do not move tests to TypeScript unless the whole test pipeline is updated.
- Do not change default host/port/path behavior without updating docs and tests.
- Do not widen network exposure silently.
- Do not remove CORS or health behavior without checking browser/deployment implications.

## Definition of done

Before finishing code changes, run the smallest relevant checks first, then the full set as needed.

Minimum for most source changes:

```bash
npm test
npm run build
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

- `npm run dev` does not serve HTTP by itself.
- Tests depend on fresh build output.
- Local imports must keep the `.js` suffix.
- Tool names and envelopes are part of the tested contract.
- User-visible tool content is intentionally Chinese even though logs are in English.
