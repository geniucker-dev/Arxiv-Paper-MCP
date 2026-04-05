# ArXiv Paper MCP HTTP

一个基于 `FastAPI + httpx + 官方 mcp Python SDK` 的 arXiv MCP 服务，提供论文搜索、PDF 链接生成、论文内容解析和 `cs.AI` 最新论文列表。

## 说明

- 运行传输层是 Streamable HTTP，不使用 stdio。
- MCP SDK 直接使用官方 Python `mcp` 包。
- arXiv 请求通过 `httpx.AsyncClient` 处理，以便连接复用和并发请求。
- `parse_paper_content` 优先抓取 HTML，失败时回退到 PDF 文本提取。

## 功能

- `search_arxiv`：搜索 arXiv 论文，支持普通关键词和完整 arXiv `search_query` 表达式
- `get_recent_ai_papers`：获取 `cs.AI/recent`
- `get_arxiv_pdf_url`：将 arXiv URL 或 ID 转成 PDF 下载链接
- `parse_paper_content`：提取论文正文内容，优先 HTML，失败时回退 PDF

## 本地开发

推荐使用 `uv` 管理本地虚拟环境。

### 安装依赖

```bash
uv venv --python 3.12
uv pip install -e ".[dev]"
```

### 启动服务

```bash
uv run python -m arxiv_paper_mcp_http
```

默认监听：

```text
http://127.0.0.1:3000/mcp
```

### 调试日志

```bash
MCP_LOG_LEVEL=debug uv run python -m arxiv_paper_mcp_http
```

支持的日志等级：`debug`、`info`、`warn`、`error`。

### 运行测试

```bash
uv run pytest
```

运行单个测试文件：

```bash
uv run pytest tests/test_http_transport.py
uv run pytest tests/test_server_tools.py
uv run pytest tests/test_service.py
uv run pytest tests/test_runtime_config.py
```

## 环境变量

- `MCP_HOST`：监听地址，默认 `127.0.0.1`
- `MCP_PORT`：监听端口，默认 `3000`
- `MCP_PATH`：MCP HTTP 路径，默认 `/mcp`
- `MCP_LOG_LEVEL`：日志等级，默认 `info`

容器部署通常应设置：

```bash
MCP_HOST=0.0.0.0
```

## MCP HTTP 契约

- 默认 MCP endpoint：`http://127.0.0.1:3000/mcp`
- 健康检查：`GET /health` 返回 `200 {"status":"ok"}`
- MCP 服务为无状态实现，不返回也不要求 `MCP-Session-Id`
- 当前实现使用单一 `POST /mcp` 处理 JSON-RPC 请求
- 已启用 CORS，便于浏览器 MCP 客户端调用

最小初始化请求：

```bash
curl -X POST http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "local-client",
        "version": "0.0.1"
      }
    }
  }'
```

## Docker

构建镜像：

```bash
docker build -t arxiv-paper-mcp-http .
```

运行容器：

```bash
docker run -d \
  --name arxiv-paper-mcp-http \
  -p 3000:3000 \
  -e MCP_HOST=0.0.0.0 \
  -e MCP_PORT=3000 \
  -e MCP_PATH=/mcp \
  -e MCP_LOG_LEVEL=info \
  arxiv-paper-mcp-http
```

Compose：

```bash
docker compose config
docker compose up -d
docker compose ps
docker compose logs -f
```

## 部署前检查

至少确认：

1. 运行环境能访问 `arxiv.org`
2. 运行环境有可写临时目录，供 PDF fallback 下载与清理
3. 已执行 `uv run pytest`
4. 若改了容器链路，已执行 `docker compose config`

## 项目结构

```text
.
├── src/arxiv_paper_mcp_http/
│   ├── __main__.py      # 进程入口
│   ├── app.py           # FastAPI 应用与 lifespan
│   ├── config.py        # MCP_HOST/MCP_PORT/MCP_PATH 解析
│   ├── logger.py        # MCP_LOG_LEVEL 日志配置
│   ├── mcp_server.py    # MCP 工具注册
│   └── service.py       # arXiv HTTP、HTML、PDF 处理
├── tests/
│   ├── http_test_harness.py
│   ├── test_http_transport.py
│   ├── test_runtime_config.py
│   ├── test_server_tools.py
│   └── test_service.py
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
└── AGENTS.md
```

## 使用流程示例

1. 用 `search_arxiv` 搜索相关论文
2. 用 `get_recent_ai_papers` 查看 `cs.AI` 最新列表
3. 用 `get_arxiv_pdf_url` 生成 PDF 下载链接
4. 用 `parse_paper_content` 提取论文正文内容

## 故障排除

### 常见问题

1. 论文搜索失败
   检查网络连接，并确认搜索关键词或 arXiv 查询表达式有效。
2. PDF 解析失败
   检查 arXiv ID 是否正确，并确认运行环境存在可写临时目录。
3. 本地调试日志不足
   使用 `MCP_LOG_LEVEL=debug uv run python -m arxiv_paper_mcp_http` 重新启动服务。

## 贡献

1. Fork 本项目
2. 创建分支：`git checkout -b feature/your-change`
3. 安装依赖：`uv venv --python 3.12 && uv pip install -e ".[dev]"`
4. 运行测试：`uv run pytest`
5. 提交并推送分支
6. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。
