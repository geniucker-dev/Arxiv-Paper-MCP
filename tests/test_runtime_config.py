from __future__ import annotations

import pytest

from arxiv_paper_mcp_http.config import load_runtime_config


def test_runtime_config_uses_defaults_when_env_vars_are_absent() -> None:
    config = load_runtime_config({})
    assert config.host == "127.0.0.1"
    assert config.port == 3000
    assert config.path == "/mcp"


def test_runtime_config_reads_host_port_and_path_overrides() -> None:
    config = load_runtime_config(
        {
            "MCP_HOST": "0.0.0.0",
            "MCP_PORT": "8080",
            "MCP_PATH": "/rpc",
        }
    )

    assert config.host == "0.0.0.0"
    assert config.port == 8080
    assert config.path == "/rpc"


def test_runtime_config_rejects_non_numeric_port() -> None:
    with pytest.raises(ValueError, match="Invalid MCP_PORT: expected an integer between 1 and 65535"):
        load_runtime_config({"MCP_PORT": "abc"})


def test_runtime_config_rejects_out_of_range_port() -> None:
    with pytest.raises(ValueError, match="Invalid MCP_PORT: expected an integer between 1 and 65535"):
        load_runtime_config({"MCP_PORT": "70000"})


def test_runtime_config_rejects_path_without_leading_slash() -> None:
    with pytest.raises(ValueError, match="Invalid MCP_PATH: path must start with '/'"):
        load_runtime_config({"MCP_PATH": "mcp"})


def test_runtime_config_rejects_empty_host() -> None:
    with pytest.raises(ValueError, match="Invalid MCP_HOST: host must be a non-empty string"):
        load_runtime_config({"MCP_HOST": ""})
