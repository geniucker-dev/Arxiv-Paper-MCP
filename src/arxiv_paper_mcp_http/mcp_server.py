from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent

from .config import RuntimeConfig
from .logger import get_configured_log_level, logger
from .service import ArxivService


def build_text_result(text: str, is_error: bool = False) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=text)], isError=is_error)


def coerce_max_results(max_results: float) -> int:
    if max_results < 1:
        return 1
    return int(max_results)


def create_arxiv_mcp_server(service: ArxivService, config: RuntimeConfig) -> FastMCP:
    server = FastMCP(
        name="arxiv-paper-mcp-http",
        host=config.host,
        port=config.port,
        streamable_http_path=config.path,
        stateless_http=True,
        json_response=True,
        log_level=get_configured_log_level().upper(),
    )

    @server.tool(name="search_arxiv", description="搜索 arXiv 论文")
    async def search_arxiv(query: str, maxResults: float = 5) -> CallToolResult:
        logger.info("Starting MCP tool execution", extra={"tool_name": "search_arxiv", "argument_keys": ["query", "maxResults"]})
        try:
            results = await service.search_arxiv_papers(query, coerce_max_results(maxResults))
            lines = [
                f"{index}. **{paper.title}**\n"
                f"   ID: {paper.id}\n"
                f"   发布日期: {paper.published}\n"
                f"   作者: {', '.join(paper.authors)}\n"
                f"   摘要: {paper.summary[:300]}...\n"
                f"   URL: {paper.url}\n"
                for index, paper in enumerate(results.papers, start=1)
            ]
            text = f"找到 {len(results.papers)} 篇相关论文（总计 {results.total_results} 篇）：\n\n{''.join(lines)}"
            return build_text_result(text)
        except Exception as error:
            logger.error("MCP tool execution failed", extra={"tool_name": "search_arxiv", "error": str(error)})
            return build_text_result(f"工具执行失败: {error}", is_error=True)

    @server.tool(name="get_recent_ai_papers", description="获取 arXiv AI 领域最新论文（cs.AI/recent）")
    async def get_recent_ai_papers() -> CallToolResult:
        logger.info("Starting MCP tool execution", extra={"tool_name": "get_recent_ai_papers", "argument_keys": []})
        try:
            html_content = await service.get_recent_ai_papers()
            return build_text_result(html_content)
        except Exception as error:
            logger.error("MCP tool execution failed", extra={"tool_name": "get_recent_ai_papers", "error": str(error)})
            return build_text_result(f"工具执行失败: {error}", is_error=True)

    @server.tool(name="get_arxiv_pdf_url", description="获取 arXiv PDF 下载链接")
    async def get_arxiv_pdf_url(input: str) -> CallToolResult:
        logger.info("Starting MCP tool execution", extra={"tool_name": "get_arxiv_pdf_url", "argument_keys": ["input"]})
        try:
            pdf_url = service.get_arxiv_pdf_url(input)
            return build_text_result(f"PDF 下载链接: {pdf_url}")
        except Exception as error:
            logger.error("MCP tool execution failed", extra={"tool_name": "get_arxiv_pdf_url", "error": str(error)})
            return build_text_result(f"工具执行失败: {error}", is_error=True)

    @server.tool(name="parse_paper_content", description="解析论文内容（优先使用 HTML 版本，回退到 PDF）")
    async def parse_paper_content(input: str) -> CallToolResult:
        logger.info("Starting MCP tool execution", extra={"tool_name": "parse_paper_content", "argument_keys": ["input"]})
        try:
            result = await service.parse_paper_content(input)
            return build_text_result(result.content)
        except Exception as error:
            logger.error("MCP tool execution failed", extra={"tool_name": "parse_paper_content", "error": str(error)})
            return build_text_result(f"工具执行失败: {error}", is_error=True)

    return server
