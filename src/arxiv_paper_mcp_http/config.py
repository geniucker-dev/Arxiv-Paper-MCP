from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3000
DEFAULT_PATH = "/mcp"


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    host: str
    port: int
    path: str


def parse_host(raw_host: str | None) -> str:
    host = DEFAULT_HOST if raw_host is None else raw_host
    if not host.strip():
        raise ValueError("Invalid MCP_HOST: host must be a non-empty string")
    return host


def parse_port(raw_port: str | None) -> int:
    if raw_port is None:
        return DEFAULT_PORT

    if not raw_port.isdigit():
        raise ValueError("Invalid MCP_PORT: expected an integer between 1 and 65535")

    port = int(raw_port)
    if port < 1 or port > 65535:
        raise ValueError("Invalid MCP_PORT: expected an integer between 1 and 65535")

    return port


def parse_path(raw_path: str | None) -> str:
    path = raw_path or DEFAULT_PATH
    if not path:
        raise ValueError("Invalid MCP_PATH: path must be a non-empty string starting with '/'")
    if not path.startswith("/"):
        raise ValueError("Invalid MCP_PATH: path must start with '/'")
    return path


def load_runtime_config(env: dict[str, str] | None = None) -> RuntimeConfig:
    source = env if env is not None else os.environ
    return RuntimeConfig(
        host=parse_host(source.get("MCP_HOST")),
        port=parse_port(source.get("MCP_PORT")),
        path=parse_path(source.get("MCP_PATH")),
    )
