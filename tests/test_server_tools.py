from __future__ import annotations

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
                "total_results": 10,
                "papers": [
                    type(
                        "PaperRecord",
                        (),
                        {
                            "id": "2403.15137v1",
                            "url": "https://arxiv.org/abs/2403.15137v1",
                            "title": "Test Title",
                            "summary": "Test summary",
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
        normalized = input.replace("https://arxiv.org/abs/", "").replace("https://arxiv.org/pdf/", "").removesuffix(".pdf")
        return f"https://arxiv.org/pdf/{normalized}.pdf"

    async def parse_paper_content(self, input: str) -> FakeParsedPaper:
        if input == "explode":
            raise RuntimeError("boom")
        return FakeParsedPaper(content="=== Paper Content (Source: HTML) ===\n\na parsed paper", source="html")


async def initialize(harness):
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
                "clientInfo": {"name": "tool-test-client", "version": "0.0.0-test"},
            },
        },
    )
    payload = await read_json_rpc_payload(initialize_response)
    protocol_version = payload["result"]["protocolVersion"]
    await post_json_rpc(
        harness.client,
        harness.mcp_path,
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={"mcp-protocol-version": protocol_version},
    )
    return protocol_version


@pytest.mark.asyncio
async def test_tools_list_exposes_four_tools_with_expected_schema_shape() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        protocol_version = await initialize(harness)
        response = await post_json_rpc(
            harness.client,
            harness.mcp_path,
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            headers={"mcp-protocol-version": protocol_version},
        )

        payload = await read_json_rpc_payload(response)
        tools = payload["result"]["tools"]
        by_name = {tool["name"]: tool for tool in tools}

        assert sorted(by_name) == [
            "get_arxiv_pdf_url",
            "get_recent_ai_papers",
            "parse_paper_content",
            "search_arxiv",
        ]
        assert by_name["search_arxiv"]["inputSchema"]["type"] == "object"
        assert "query" in by_name["search_arxiv"]["inputSchema"]["properties"]
        assert by_name["search_arxiv"]["inputSchema"]["properties"]["maxResults"]["default"] == 5
        assert by_name["get_recent_ai_papers"]["inputSchema"]["type"] == "object"
        assert "input" in by_name["get_arxiv_pdf_url"]["inputSchema"]["properties"]
        assert "input" in by_name["parse_paper_content"]["inputSchema"]["properties"]


@pytest.mark.asyncio
async def test_get_arxiv_pdf_url_preserves_existing_success_envelope() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        protocol_version = await initialize(harness)

        for value in (
            "2403.15137v1",
            "https://arxiv.org/abs/2403.15137v1",
            "https://arxiv.org/pdf/2403.15137v1.pdf",
        ):
            response = await post_json_rpc(
                harness.client,
                harness.mcp_path,
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {"name": "get_arxiv_pdf_url", "arguments": {"input": value}},
                },
                headers={"mcp-protocol-version": protocol_version},
            )
            payload = await read_json_rpc_payload(response)
            assert payload["result"]["isError"] is False
            assert payload["result"]["content"][0]["type"] == "text"
            assert "PDF download URL: https://arxiv.org/pdf/2403.15137v1.pdf" in payload["result"]["content"][0]["text"]


@pytest.mark.asyncio
async def test_tool_failures_keep_text_error_envelope() -> None:
    async with start_http_harness(service=FakeArxivService()) as harness:
        protocol_version = await initialize(harness)
        response = await post_json_rpc(
            harness.client,
            harness.mcp_path,
            {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "parse_paper_content", "arguments": {"input": "explode"}},
            },
            headers={"mcp-protocol-version": protocol_version},
        )
        payload = await read_json_rpc_payload(response)
        assert payload["result"]["isError"] is True
        assert payload["result"]["content"][0]["type"] == "text"
        assert "Tool execution failed: boom" in payload["result"]["content"][0]["text"]
