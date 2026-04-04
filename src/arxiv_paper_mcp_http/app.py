from __future__ import annotations

from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import RuntimeConfig, load_runtime_config
from .mcp_server import create_arxiv_mcp_server
from .service import ArxivService


def create_app(config: RuntimeConfig | None = None, service: ArxivService | None = None) -> FastAPI:
    resolved_config = config or load_runtime_config()
    resolved_service = service or ArxivService()
    mcp_server = create_arxiv_mcp_server(resolved_service, resolved_config)
    mcp_app = mcp_server.streamable_http_app()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with AsyncExitStack() as stack:
            await resolved_service.start()
            stack.push_async_callback(resolved_service.close)
            await stack.enter_async_context(mcp_server.session_manager.run())
            yield

    app = FastAPI(
        title="arxiv-paper-mcp-http",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Mcp-Protocol-Version", "Mcp-Session-Id", "Authorization"],
        expose_headers=["Content-Type", "Mcp-Protocol-Version", "Mcp-Session-Id"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/", mcp_app)
    return app
