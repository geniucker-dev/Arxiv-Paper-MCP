from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
import json

from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient, Response

from arxiv_paper_mcp_http.app import create_app
from arxiv_paper_mcp_http.config import RuntimeConfig
from arxiv_paper_mcp_http.service import ArxivService


@dataclass(slots=True)
class HttpHarness:
    client: AsyncClient
    base_url: str
    mcp_path: str


def create_json_rpc_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    return {
        "accept": "application/json, text/event-stream",
        "content-type": "application/json",
        **(extra or {}),
    }


async def post_json_rpc(client: AsyncClient, url: str, message: dict, headers: dict[str, str] | None = None) -> Response:
    return await client.post(url, headers=create_json_rpc_headers(headers), json=message)


async def read_json_rpc_payload(response: Response) -> dict:
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return response.json()

    if "text/event-stream" not in content_type:
        raise AssertionError(f"Unsupported response content-type: {content_type}")

    for raw_block in response.text.split("\n\n"):
        block = raw_block.replace("\r", "")
        data_lines = [
            line[len("data:") :].strip()
            for line in block.split("\n")
            if line.startswith("data:") and line[len("data:") :].strip()
        ]
        for line in data_lines:
            try:
                return json.loads(line)
            except Exception:
                continue

    raise AssertionError("Failed to parse JSON-RPC payload in SSE response")


@asynccontextmanager
async def start_http_harness(
    service: ArxivService | None = None,
    config: RuntimeConfig | None = None,
):
    resolved_config = config or RuntimeConfig(host="127.0.0.1", port=3000, path="/mcp")
    app = create_app(config=resolved_config, service=service)

    async with LifespanManager(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url=f"http://{resolved_config.host}:{resolved_config.port}",
        ) as client:
            yield HttpHarness(
                client=client,
                base_url=f"http://{resolved_config.host}:{resolved_config.port}",
                mcp_path=resolved_config.path,
            )
