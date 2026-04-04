from __future__ import annotations

import uvicorn

from .app import create_app
from .config import load_runtime_config
from .logger import get_configured_log_level, logger


def main() -> None:
    config = load_runtime_config()
    logger.info(
        "MCP Streamable HTTP server listening",
        extra={
            "endpoint": f"http://{config.host}:{config.port}{config.path}",
            "host": config.host,
            "port": config.port,
            "path": config.path,
            "log_level": get_configured_log_level(),
        },
    )
    uvicorn.run(
        create_app(config),
        host=config.host,
        port=config.port,
        log_level=get_configured_log_level(),
    )


if __name__ == "__main__":
    main()
