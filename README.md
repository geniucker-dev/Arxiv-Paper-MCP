# ArXiv Paper MCP

一个基于 arXiv 的论文检索与内容解析工具。支持 Model Context Protocol (MCP) 标准，提供论文搜索、PDF链接获取和内容解析功能。

## 功能特性

* 🔍 **arXiv 论文智能搜索**：关键词检索，快速定位你关心的论文
* 🔗 **获取 PDF 下载链接**：获取 arXiv 论文的直接 PDF 下载链接
* 📄 **论文内容解析**：智能解析论文内容，优先使用 HTML 版本，回退到 PDF
* 🆕 **AI领域最新论文**：获取 arXiv AI 领域今日最新更新论文列表

## 本地运行

本项目按**本地 Node.js 服务**方式运行，不按 npm 包发布使用。

### 环境要求

- Node.js >= 18
- npm

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

可通过环境变量控制控制台日志等级：

```bash
MCP_LOG_LEVEL=debug npm start
```

支持的等级：`debug`、`info`、`warn`、`error`，默认是 `info`。

启动后默认监听：

```text
http://127.0.0.1:3000/mcp
```

### 开发模式

```bash
# TypeScript 监听编译
npm run dev

# 另开一个终端运行编译后的服务
npm start
```

## Streamable HTTP 运行方式

本项目默认使用 **MCP Streamable HTTP** 作为运行传输层（不再使用 stdio 启动运行时）。

启动后提供单一 MCP 端点：

```text
http://<MCP_HOST>:<MCP_PORT><MCP_PATH>
```

默认值：

- `MCP_HOST=127.0.0.1`
- `MCP_PORT=3000`
- `MCP_PATH=/mcp`

示例：

```bash
# 默认监听 http://127.0.0.1:3000/mcp
npm start

# 自定义地址
MCP_HOST=0.0.0.0 MCP_PORT=8080 MCP_PATH=/mcp npm start
```

### 构建与测试

```bash
# 构建
npm run build

# 运行测试（会先 build）
npm test
```

## MCP 调用方式

服务使用单一 MCP 端点：

```text
POST /mcp
```

请求要求：

- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`
- 服务是**无状态**的，不使用 `MCP-Session-Id`
- 已内置 `CORS` 和 `OPTIONS` 预检响应，便于 LobeHub 这类浏览器/远程客户端接入

一个最小的 `initialize` 示例：

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

初始化之后，可以继续对同一端点发送 `notifications/initialized`、`tools/list`、`tools/call` 等 JSON-RPC 请求。

协议说明：

- 使用单一 MCP 端点路径
- `POST` 为必需方法（用于 initialize 与后续 JSON-RPC 请求）
- 服务为无状态实现：不返回也不要求 `MCP-Session-Id`
- `GET` 在当前实现中不启用，将返回不支持行为

## 可用工具与参数

### 1. 搜索论文

* **工具名**: `search_arxiv`
* **参数**:
  * `query`：搜索关键词
  * `maxResults`：返回论文数（可选，默认 5）

### 2. 获取PDF下载链接

* **工具名**: `get_arxiv_pdf_url`
* **参数**:
  * `input`：arXiv 论文 URL 或 arXiv ID（如：2403.15137v1）

### 3. 解析论文内容

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
