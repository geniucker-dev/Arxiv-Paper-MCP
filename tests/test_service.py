from __future__ import annotations

import httpx
import pytest

from arxiv_paper_mcp_http.service import ArxivService


SEARCH_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2403.15137v1</id>
    <published>2024-03-22T00:00:00Z</published>
    <title>  Test   Paper Title  </title>
    <summary>  Test   summary   text  </summary>
    <author><name>Alice</name></author>
    <author><name>Bob</name></author>
  </entry>
</feed>
"""

HTML_DOCUMENT = """
<html>
  <body class="ltx_document">
    <div class="ltx_page_main">
      <h1>Title</h1>
      <p>This is enough content to be considered valid HTML parsing output for the paper body. It should exceed one hundred characters once whitespace is normalized for the test.</p>
    </div>
  </body>
</html>
"""


def create_mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_search_arxiv_papers_parses_atom_feed() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/query"
        assert request.url.params["search_query"] == "all:test query"
        return httpx.Response(200, text=SEARCH_XML)

    service = ArxivService(http_client=create_mock_client(handler))
    result = await service.search_arxiv_papers("test query", 5)
    assert result.total_results == 1
    assert len(result.papers) == 1
    paper = result.papers[0]
    assert paper.id == "2403.15137v1"
    assert paper.title == "Test Paper Title"
    assert paper.summary == "Test summary text"
    assert paper.authors == ["Alice", "Bob"]
    await service.close()


def test_build_search_query_keeps_advanced_arxiv_expression_intact() -> None:
    service = ArxivService()
    advanced_query = (
        "all:(neural network output constraints equality inequality hard constraints "
        "feasible output layer projection differentiable optimization) "
        "AND submittedDate:[202401010000 TO 202612312359]"
    )
    assert service.build_search_query(advanced_query) == advanced_query


def test_build_search_query_adds_default_all_prefix_for_plain_keywords() -> None:
    service = ArxivService()
    assert service.build_search_query("neural network constraints") == "all:neural network constraints"


@pytest.mark.asyncio
async def test_parse_paper_content_prefers_html() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/html/2403.15137":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=HTML_DOCUMENT)
        raise AssertionError(f"Unexpected request path: {request.url.path}")

    service = ArxivService(http_client=create_mock_client(handler))
    result = await service.parse_paper_content("2403.15137v1")
    assert result.source == "html"
    assert result.content.startswith("=== 论文内容 (来源: HTML) ===")
    assert "This is enough content" in result.content
    await service.close()


@pytest.mark.asyncio
async def test_parse_paper_content_falls_back_to_pdf_path_when_html_is_missing(monkeypatch) -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/html/2403.15137":
            return httpx.Response(404)
        raise AssertionError(f"Unexpected request path: {request.url.path}")

    service = ArxivService(http_client=create_mock_client(handler))

    async def fake_download_temp_pdf(pdf_url: str) -> str:
        assert pdf_url == "https://arxiv.org/pdf/2403.15137v1.pdf"
        return "/tmp/fake-paper.pdf"

    async def fake_extract_pdf_text(pdf_path: str) -> str:
        assert pdf_path == "/tmp/fake-paper.pdf"
        return "PDF content " * 20

    monkeypatch.setattr(service, "download_temp_pdf", fake_download_temp_pdf)
    monkeypatch.setattr(service, "extract_pdf_text", fake_extract_pdf_text)
    monkeypatch.setattr("os.path.exists", lambda path: False)

    result = await service.parse_paper_content("2403.15137v1")
    assert result.source == "pdf"
    assert result.content.startswith("=== 论文内容 (来源: PDF) ===")
    await service.close()
