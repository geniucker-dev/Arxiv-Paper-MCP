# ArXiv Paper MCP HTTP

一个基于 `FastAPI + httpx + 官方 mcp Python SDK` 的 arXiv MCP 服务，提供论文搜索、PDF 链接生成、论文内容解析和 `cs.AI` 最新论文列表。

## 说明

- 运行传输层是 Streamable HTTP，不使用 stdio。
- MCP SDK 直接使用官方 Python `mcp` 包。
- arXiv 访问改成 `httpx.AsyncClient`，以便连接复用和并发请求。
- `arxiv` 现成 Python 包是同步 `requests` 风格，不适合这个异步 HTTP 服务主路径，所以这里没有接入它。

## 功能

- `search_arxiv`：搜索 arXiv 论文
- `get_recent_ai_papers`：获取 `cs.AI/recent`
- `get_arxiv_pdf_url`：将 arXiv URL 或 ID 转成 PDF 下载链接
- `parse_paper_content`：优先抓 HTML，失败时回退 PDF 提取

## 本地开发

默认开发环境使用 `conda spider`。

### 安装依赖

```bash
conda run -n spider python -m pip install -e ".[dev]"
```

### 启动服务

```bash
conda run -n spider python -m arxiv_paper_mcp_http
```

默认监听：

```text
http://127.0.0.1:3000/mcp
```

### 调试日志

```bash
MCP_LOG_LEVEL=debug conda run -n spider python -m arxiv_paper_mcp_http
```

支持的日志等级：`debug`、`info`、`warn`、`error`。

### 运行测试

```bash
conda run -n spider pytest
```

运行单个测试文件：

```bash
conda run -n spider pytest tests/test_http_transport.py
conda run -n spider pytest tests/test_server_tools.py
conda run -n spider pytest tests/test_service.py
conda run -n spider pytest tests/test_runtime_config.py
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
3. 已执行 `conda run -n spider pytest`
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

## 额外注意

- 服务没有内建鉴权，不应默认直接暴露到公网。
- PDF 解析仍然依赖临时文件，并在请求结束后清理。
- 如果改动 `/mcp`、`/health`、CORS、工具名或工具响应形状，必须同步更新测试和文档。

* **工具名**: `parse_paper_content`
* **参数**:
  * `input`：arXiv 论文 URL 或 arXiv ID

### 4. 获取AI领域最新论文

* **工具名**: `get_recent_ai_papers`
* **参数**: 无

## 使用流程示例

1. **搜索论文**
   使用 `search_arxiv` 工具搜索相关论文
2. **获取最新AI论文**
   用 `get_recent_ai_papers` 工具获取今日最新AI领域论文
3. **获取PDF链接**
   用 `get_arxiv_pdf_url` 工具获取PDF下载链接
4. **解析论文内容**
   用 `parse_paper_content` 工具获取论文的文本内容（优先 HTML，回退 PDF）

## 开发指南

### 本地开发

```bash
# 克隆项目
git clone https://github.com/yzfly/arxiv-paper-mcp.git
cd arxiv-paper-mcp

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建
npm run build

# 运行构建版本
npm start
```

### 项目结构

```
arxiv-paper-mcp/
├── src/
│   ├── createServer.ts   # MCP 工具/业务逻辑工厂
│   ├── index.ts          # Streamable HTTP 运行时入口
│   ├── runtimeConfig.ts  # MCP_HOST/MCP_PORT/MCP_PATH 配置解析
│   └── httpTestHarness.ts
├── build/                # 编译输出目录
├── test/                 # 传输与运行时测试
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript 配置
├── README.md             # 项目说明
└── LICENSE               # 许可证
```

## 技术栈

- **Node.js** >= 18.0.0
- **TypeScript** - 类型安全的JavaScript
- **Model Context Protocol** - 标准化的AI上下文协议
- **arXiv API** - 学术论文数据源

## 故障排除

### 常见问题

1. **论文搜索失败**
   ```
   错误：搜索失败
   解决：检查网络连接，确保搜索关键词正确
   ```

2. **PDF解析失败**
   ```
   错误：PDF 解析失败
   解决：检查 arXiv ID 是否正确，确保论文存在
   ```

### 日志调试

如需本地查看日志，可直接运行：

```bash
npm start
```

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本项目
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

## 许可证

本项目采用 MIT 许可证。详情请见 [LICENSE](LICENSE) 文件。

## 作者信息

- **作者**: yzfly
- **邮箱**: yz.liu.me@gmail.com
- **GitHub**: [https://github.com/yzfly](https://github.com/yzfly)

## 相关文件

- `Dockerfile`：容器镜像构建
- `docker-compose.yml`：单服务部署示例
- `.env.example`：环境变量示例
- `AGENTS.md`：面向代码代理/自动化维护的仓库约定

## 相关链接

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [arXiv.org](https://arxiv.org/)
- [Claude Desktop](https://claude.ai/download)

## 支持

如果您觉得这个项目有用，请给它一个 ⭐！

如有问题或建议，请通过以下方式联系：

- 📧 邮箱：yz.liu.me@gmail.com
- 🐛 GitHub Issues：[项目问题追踪](https://github.com/yzfly/arxiv-paper-mcp/issues)
- 💬 GitHub Discussions：[项目讨论区](https://github.com/yzfly/arxiv-paper-mcp/discussions)
