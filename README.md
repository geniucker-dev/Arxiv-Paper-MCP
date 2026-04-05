# ArXiv Paper MCP HTTP

English | [Chinese (Simplified)](README.zh-CN.md)

A stateless arXiv MCP server built with `FastAPI + httpx + the official Python mcp SDK`. It provides paper search, PDF URL generation, paper content parsing, and a `cs.AI` recent-paper listing over Streamable HTTP.

## Overview

- Transport is Streamable HTTP, not stdio.
- Outbound arXiv requests use a shared `httpx.AsyncClient`.
- `parse_paper_content` prefers the HTML version and falls back to PDF text extraction.
- The runtime target is a local/server process or container deployment.

## Tools

- `search_arxiv`: Search arXiv papers with plain keywords or a full arXiv `search_query` expression
- `get_recent_ai_papers`: Fetch `cs.AI/recent`
- `get_arxiv_pdf_url`: Convert an arXiv URL or ID into a PDF download URL
- `parse_paper_content`: Extract paper body text, preferring HTML and falling back to PDF

## Local Development

Use `uv` for the local virtual environment.

### Install dependencies

```bash
uv venv --python 3.12
uv sync --extra dev
```

### Start the server

```bash
uv run python -m arxiv_paper_mcp_http
```

Default endpoint:

```text
http://127.0.0.1:3000/mcp
```

### Debug logging

```bash
MCP_LOG_LEVEL=debug uv run python -m arxiv_paper_mcp_http
```

Supported log levels: `debug`, `info`, `warn`, `error`.

### Run tests

```bash
uv run pytest
```

Run a single test file:

```bash
uv run pytest tests/test_http_transport.py
uv run pytest tests/test_server_tools.py
uv run pytest tests/test_service.py
uv run pytest tests/test_runtime_config.py
```

## Environment Variables

- `MCP_HOST`: bind host, default `127.0.0.1`
- `MCP_PORT`: bind port, default `3000`
- `MCP_PATH`: MCP HTTP path, default `/mcp`
- `MCP_LOG_LEVEL`: log level, default `info`

For containers, prefer:

```bash
MCP_HOST=0.0.0.0
```

## MCP HTTP Contract

- Default MCP endpoint: `http://127.0.0.1:3000/mcp`
- Health check: `GET /health` returns `200 {"status":"ok"}`
- The MCP endpoint is stateless and does not require `MCP-Session-Id`
- The current implementation accepts JSON-RPC requests on `POST /mcp`
- CORS is enabled for browser MCP clients

Minimal initialize request:

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "local-client",
        "version": "0.0.1"
      }
    }
  }'
```

## Docker

Build the image:

```bash
docker build -t arxiv-paper-mcp-http .
```

Run the container:

```bash
docker run -d \
  --name arxiv-paper-mcp-http \
  -p 3000:3000 \
  -e MCP_HOST=0.0.0.0 \
  -e MCP_PORT=3000 \
  -e MCP_PATH=/mcp \
  -e MCP_LOG_LEVEL=info \
  arxiv-paper-mcp-http
```

Compose:

```bash
docker compose config
docker compose up -d
docker compose ps
docker compose logs -f
```

## Pre-Deployment Checks

At minimum, confirm:

1. The runtime environment can reach `arxiv.org`
2. Writable temporary storage is available for PDF fallback download and cleanup
3. `uv run pytest` has been executed
4. `docker compose config` has been executed if container wiring changed

## Project Layout

```text
.
├── src/arxiv_paper_mcp_http/
│   ├── __main__.py
│   ├── app.py
│   ├── config.py
│   ├── logger.py
│   ├── mcp_server.py
│   └── service.py
├── tests/
│   ├── http_test_harness.py
│   ├── test_http_transport.py
│   ├── test_runtime_config.py
│   ├── test_server_tools.py
│   └── test_service.py
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
└── AGENTS.md
```

## Typical Flow

1. Use `search_arxiv` to find relevant papers
2. Use `get_recent_ai_papers` to inspect the latest `cs.AI` listing
3. Use `get_arxiv_pdf_url` to generate a PDF URL
4. Use `parse_paper_content` to extract the paper body text

## Troubleshooting

1. Search fails
   Check network connectivity and verify the keywords or arXiv query expression.
2. PDF parsing fails
   Check that the arXiv ID is valid and that writable temporary storage exists.
3. Logs are not detailed enough
   Restart with `MCP_LOG_LEVEL=debug uv run python -m arxiv_paper_mcp_http`.

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-change`
3. Install dependencies: `uv venv --python 3.12 && uv sync --extra dev`
4. Run tests: `uv run pytest`
5. Commit and push your branch
6. Open a Pull Request

## License

This project is licensed under MIT. See [LICENSE](LICENSE).
