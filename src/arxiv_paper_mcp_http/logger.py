from __future__ import annotations

import logging
import os


LogLevelName = str
LOGGER_NAME = "arxiv-paper-mcp-http"
_LOG_LEVELS = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
}


def get_configured_log_level() -> LogLevelName:
    raw_level = os.getenv("MCP_LOG_LEVEL", "info").lower()
    return raw_level if raw_level in _LOG_LEVELS else "info"


def configure_logging() -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    level_name = get_configured_log_level()
    logger.setLevel(_LOG_LEVELS[level_name])

    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    logger.propagate = False
    return logger


logger = configure_logging()
