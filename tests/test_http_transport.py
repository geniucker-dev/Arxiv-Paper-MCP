from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest

from .http_test_harness import post_json_rpc, read_json_rpc_payload, start_http_harness


@dataclass(slots=True)
class FakeParsedPaper:
    content: str
    source: str


class FakeArxivService:
    async def start(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def search_arxiv_papers(self, query: str, max_results: int = 5):
        return type(
            "SearchResponse",
            (),
            {
                "total_results": 1,
                "papers": [
                    type(
                        "PaperRecord",
                        (),
                        {
                            "id": "2403.15137v1",
                            "url": "https://arxiv.org/abs/2403.15137v1",
                            "title": f"{query} title",
                            "summary": "summary",
                            "published": "2024-03-22T00:00:00Z",
                            "authors": ["Alice", "Bob"],
                        },
                    )()
                ],
            },
        )()

    async def get_recent_ai_papers(self) -> str:
        return "<html>recent ai</html>"

    def get_arxiv_pdf_url(self, input: str) -> str:
        return f"https://arxiv.org/pdf/{input.replace('https://arxiv.org/abs/', '').replace('https://arxiv.org/pdf/', '').removesuffix('.pdf')}.pdf"

    async def parse_paper_content(self, input: str) -> FakeParsedPaper:
        return FakeParsedPaper(content=f"=== Paper Content (Source: HTML) ===\n\n{input}", source="html")


def assert_cors_headers(headers) -> None:
    assert headers.get("access-control-allow-origin") == "*"
    assert "POST" in (headers.get("access-control-allow-methods") or "")


@pytest.mark.asyncio
async def test_runtime_serves_a_single_mcp_endpoint_and_post_only_transport() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        put_response = await harness.client.put(
            harness.mcp_path,
            headers={"accept": "application/json, text/event-stream", "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        )
        assert put_response.status_code in {400, 405}

        wrong_path_response = await harness.client.post(
            "/wrong-path",
            headers={"accept": "application/json, text/event-stream", "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 99, "method": "initialize", "params": {}},
        )
        assert wrong_path_response.status_code == 404


@pytest.mark.asyncio
async def test_runtime_responds_to_cors_preflight_requests() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        preflight_response = await harness.client.options(
            harness.mcp_path,
            headers={
                "Origin": "https://lobehub.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type, accept, mcp-protocol-version",
            },
        )

        assert preflight_response.status_code in {200, 204}
        assert_cors_headers(preflight_response.headers)
        assert "Content-Type" in (preflight_response.headers.get("access-control-allow-headers") or "")


@pytest.mark.asyncio
async def test_runtime_exposes_a_health_endpoint() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        health_response = await harness.client.get("/health")
        assert health_response.status_code == 200
        assert health_response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_runtime_stays_stateless_and_does_not_emit_session_headers() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        initialize_response = await post_json_rpc(
            harness.client,
            harness.mcp_path,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "http-harness-test-client", "version": "0.0.0-test"},
                },
            },
        )

        assert initialize_response.status_code == 200
        assert initialize_response.headers.get("mcp-session-id") is None
        payload = await read_json_rpc_payload(initialize_response)
        assert payload["id"] == 1
        protocol_version = payload["result"]["protocolVersion"]

        initialized_response = await post_json_rpc(
            harness.client,
            harness.mcp_path,
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers={"mcp-protocol-version": protocol_version},
        )
        assert initialized_response.status_code == 202
        assert initialized_response.headers.get("mcp-session-id") is None

        tools_response = await post_json_rpc(
            harness.client,
            harness.mcp_path,
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            headers={"mcp-protocol-version": protocol_version},
        )
        assert tools_response.status_code == 200
        assert tools_response.headers.get("mcp-session-id") is None
        tools_payload = await read_json_rpc_payload(tools_response)
        assert tools_payload["id"] == 2
        assert len(tools_payload["result"]["tools"]) == 4


@pytest.mark.asyncio
async def test_runtime_handles_parallel_tool_calls() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        protocol_version = (await read_json_rpc_payload(
            await post_json_rpc(
                harness.client,
                harness.mcp_path,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "parallel-test-client", "version": "0.0.0-test"},
                    },
                },
            )
        ))["result"]["protocolVersion"]

        await post_json_rpc(
            harness.client,
            harness.mcp_path,
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers={"mcp-protocol-version": protocol_version},
        )

        async def call_tool(request_id: int) -> dict:
            response = await post_json_rpc(
                harness.client,
                harness.mcp_path,
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": "tools/call",
                    "params": {"name": "get_arxiv_pdf_url", "arguments": {"input": "2403.15137v1"}},
                },
                headers={"mcp-protocol-version": protocol_version},
            )
            return await read_json_rpc_payload(response)

        payloads = await asyncio.gather(*(call_tool(index) for index in range(10, 20)))
        assert len(payloads) == 10
        for payload in payloads:
            assert payload["result"]["isError"] is False
            assert "https://arxiv.org/pdf/2403.15137v1.pdf" in payload["result"]["content"][0]["text"]
