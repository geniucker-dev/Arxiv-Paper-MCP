from __future__ import annotations

import asyncio
from dataclasses import dataclass
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

from bs4 import BeautifulSoup
import httpx
from pypdf import PdfReader

from .logger import logger


ARXIV_API_URL = "https://export.arxiv.org/api/query"
ARXIV_HTML_URL = "https://arxiv.org/html/{arxiv_id}"
ARXIV_PDF_URL = "https://arxiv.org/pdf/{arxiv_id}.pdf"
ARXIV_RECENT_AI_URL = "https://arxiv.org/list/cs.AI/recent"
USER_AGENT = "ArXiv-Paper-MCP/2.0 (+https://github.com/yzfly/arxiv-paper-mcp)"

ATOM_NAMESPACE = {"atom": "http://www.w3.org/2005/Atom", "opensearch": "http://a9.com/-/spec/opensearch/1.1/"}


@dataclass(frozen=True, slots=True)
class PaperRecord:
    id: str
    url: str
    title: str
    summary: str
    published: str
    authors: list[str]


@dataclass(frozen=True, slots=True)
class SearchResponse:
    total_results: int
    papers: list[PaperRecord]


@dataclass(frozen=True, slots=True)
class ParsedPaperContent:
    content: str
    source: str


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


class ArxivService:
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._http_client = http_client

    async def start(self) -> None:
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                follow_redirects=True,
                headers={"User-Agent": USER_AGENT},
                timeout=httpx.Timeout(30.0, connect=10.0),
                trust_env=False,
            )

    async def close(self) -> None:
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    @property
    def http_client(self) -> httpx.AsyncClient:
        if self._http_client is None:
            raise RuntimeError("HTTP client is not initialized")
        return self._http_client

    async def search_arxiv_papers(self, query: str, max_results: int = 5) -> SearchResponse:
        try:
            response = await self.http_client.get(
                ARXIV_API_URL,
                params={
                    "search_query": f"all:{query}",
                    "start": 0,
                    "max_results": max_results,
                },
            )
            response.raise_for_status()
            return self.parse_search_response(response.text)
        except Exception as error:
            logger.error(
                "Failed to search arXiv papers",
                extra={"query": query, "max_results": max_results, "error": str(error)},
            )
            raise RuntimeError(f"搜索失败: {error}") from error

    def parse_search_response(self, xml_payload: str) -> SearchResponse:
        root = ET.fromstring(xml_payload)
        total_results_text = root.findtext("opensearch:totalResults", default="0", namespaces=ATOM_NAMESPACE)
        total_results = int(total_results_text)
        papers: list[PaperRecord] = []

        for entry in root.findall("atom:entry", ATOM_NAMESPACE):
            entry_url = entry.findtext("atom:id", default="", namespaces=ATOM_NAMESPACE)
            arxiv_id = entry_url.rstrip("/").split("/")[-1]
            authors = [
                _clean_text(author.findtext("atom:name", default="", namespaces=ATOM_NAMESPACE))
                for author in entry.findall("atom:author", ATOM_NAMESPACE)
            ]
            papers.append(
                PaperRecord(
                    id=arxiv_id,
                    url=entry_url,
                    title=_clean_text(entry.findtext("atom:title", default="", namespaces=ATOM_NAMESPACE)),
                    summary=_clean_text(entry.findtext("atom:summary", default="", namespaces=ATOM_NAMESPACE)),
                    published=entry.findtext("atom:published", default="", namespaces=ATOM_NAMESPACE),
                    authors=[author for author in authors if author],
                )
            )

        return SearchResponse(total_results=total_results, papers=papers)

    async def get_recent_ai_papers(self) -> str:
        try:
            response = await self.http_client.get(ARXIV_RECENT_AI_URL)
            response.raise_for_status()
            return response.text
        except Exception as error:
            logger.error("Failed to fetch recent AI papers", extra={"url": ARXIV_RECENT_AI_URL, "error": str(error)})
            raise RuntimeError(f"获取最新论文失败: {error}") from error

    def extract_arxiv_id(self, input_value: str) -> str:
        if not input_value.startswith(("http://", "https://")):
            return re.sub(r"\.pdf$", "", input_value, flags=re.IGNORECASE)

        parsed_url = urlparse(input_value)
        path_segments = [segment for segment in parsed_url.path.split("/") if segment]
        last_segment = path_segments[-1] if path_segments else input_value
        return re.sub(r"\.pdf$", "", last_segment, flags=re.IGNORECASE)

    def get_arxiv_pdf_url(self, input_value: str) -> str:
        try:
            return ARXIV_PDF_URL.format(arxiv_id=self.extract_arxiv_id(input_value))
        except Exception as error:
            logger.error("Failed to build arXiv PDF URL", extra={"input": input_value, "error": str(error)})
            raise RuntimeError(f"获取PDF链接失败: {error}") from error

    async def get_arxiv_html_content(self, arxiv_id: str) -> str | None:
        clean_arxiv_id = re.sub(r"v\d+$", "", arxiv_id)
        html_url = ARXIV_HTML_URL.format(arxiv_id=clean_arxiv_id)

        try:
            response = await self.http_client.get(html_url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            html = response.text

            if "text/html" not in content_type:
                return None

            if any(marker in html for marker in ("ltx_document", "ltx_page_main", "ltx_abstract")):
                return html

            return None
        except Exception as error:
            logger.warning("Failed to fetch HTML version, falling back to PDF", extra={"html_url": html_url, "error": str(error)})
            return None

    def extract_text_from_html(self, html: str) -> str:
        try:
            soup = BeautifulSoup(html, "html.parser")
            for node in soup.select("script, style"):
                node.decompose()

            main_content = soup.select_one(".ltx_page_main") or soup.select_one(".ltx_document") or soup.body
            if main_content is None:
                raise RuntimeError("无法找到主要内容区域")

            text = _clean_text(main_content.get_text(" ", strip=True))
            if len(text) < 100:
                raise RuntimeError("HTML 文本内容过少")
            return text
        except Exception as error:
            logger.error("Failed to extract text from HTML", extra={"error": str(error)})
            raise RuntimeError(f"HTML 解析失败: {error}") from error

    async def download_temp_pdf(self, pdf_url: str) -> str:
        fd, temp_path = tempfile.mkstemp(prefix="arxiv_temp_", suffix=".pdf")
        os.close(fd)

        try:
            async with self.http_client.stream("GET", pdf_url) as response:
                response.raise_for_status()
                with open(temp_path, "wb") as file_handle:
                    async for chunk in response.aiter_bytes():
                        file_handle.write(chunk)
            return temp_path
        except Exception as error:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            logger.error("Temporary PDF download request failed", extra={"pdf_url": pdf_url, "error": str(error)})
            raise RuntimeError(f"下载失败: {error}") from error

    async def extract_pdf_text(self, pdf_path: str) -> str:
        def read_pdf() -> str:
            reader = PdfReader(pdf_path)
            return " ".join(page.extract_text() or "" for page in reader.pages)

        try:
            text = await asyncio.to_thread(read_pdf)
            cleaned = _clean_text(text)
            if len(cleaned) < 100:
                raise RuntimeError("PDF 文本提取失败或内容过少")
            return cleaned
        except Exception as error:
            logger.error("Failed to parse PDF", extra={"pdf_path": pdf_path, "error": str(error)})
            raise RuntimeError(f"PDF 解析失败: {error}") from error

    async def parse_paper_content(self, input_value: str) -> ParsedPaperContent:
        temp_pdf_path: str | None = None
        try:
            arxiv_id = self.extract_arxiv_id(input_value)
            html_content = await self.get_arxiv_html_content(arxiv_id)

            if html_content:
                paper_text = self.extract_text_from_html(html_content)
                source = "html"
            else:
                pdf_url = self.get_arxiv_pdf_url(input_value)
                temp_pdf_path = await self.download_temp_pdf(pdf_url)
                paper_text = await self.extract_pdf_text(temp_pdf_path)
                source = "pdf"

            output = f"=== 论文内容 (来源: {source.upper()}) ===\n\n{paper_text}"
            return ParsedPaperContent(content=output, source=source)
        except Exception as error:
            logger.error("Failed to parse paper content", extra={"input": input_value, "error": str(error)})
            raise RuntimeError(f"论文内容解析失败: {error}") from error
        finally:
            if temp_pdf_path and os.path.exists(temp_pdf_path):
                try:
                    os.unlink(temp_pdf_path)
                except OSError as cleanup_error:
                    logger.warning(
                        "Failed to remove temporary PDF file",
                        extra={"temp_pdf_path": temp_pdf_path, "error": str(cleanup_error)},
                    )
