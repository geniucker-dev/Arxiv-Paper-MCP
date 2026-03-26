import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ArXivClient } from "@agentic/arxiv";
import ky from "ky";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { PdfReader } from "pdfreader";
import { tmpdir } from "os";
import { JSDOM } from "jsdom";
import { logger } from "./logger.js";

// 初始化 ArXiv 客户端
const arxivClient = new ArXivClient({ ky: ky.extend({ timeout: 30_000 }) });

// 工具函数：搜索 arXiv 论文
async function searchArxivPapers(query: string, maxResults: number = 5): Promise<{ totalResults: number; papers: any[] }> {
  try {
    const results = await arxivClient.search({
      start: 0,
      searchQuery: {
        include: [{ field: "all", value: query }],
      },
      maxResults: maxResults,
    });

    const papers = results.entries.map((entry) => {
      const urlParts = entry.url.split("/");
      const arxivId = urlParts[urlParts.length - 1];

      return {
        id: arxivId,
        url: entry.url,
        title: entry.title.replace(/\s+/g, " ").trim(),
        summary: entry.summary.replace(/\s+/g, " ").trim(),
        published: entry.published,
        authors: entry.authors || [],
      };
    });

    return {
      totalResults: results.totalResults,
      papers: papers,
    };
  } catch (error) {
    logger.error("Failed to search arXiv papers", {
      query,
      maxResults,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`搜索失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 工具函数：检查是否有 HTML 版本并获取内容
async function getArxivHtmlContent(arxivId: string): Promise<string | null> {
  const cleanArxivId = arxivId.replace(/v\d+$/, "");
  const htmlUrl = `https://arxiv.org/html/${cleanArxivId}`;

  try {
    logger.debug("Attempting to fetch arXiv HTML version", { htmlUrl });

    const response = await axios({
      method: "GET",
      url: htmlUrl,
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ArXiv-Paper-MCP/1.0)",
      },
    });

    // 检查响应状态和内容类型
    if (response.status === 200 && response.headers["content-type"]?.includes("text/html")) {
      const html = response.data;

      // 简单检查是否是有效的论文HTML（而不是错误页面）
      if (html.includes("ltx_document") || html.includes("ltx_page_main") || html.includes("ltx_abstract")) {
        logger.debug("Fetched valid arXiv HTML version", { htmlUrl });
        return html;
      }
    }

    logger.debug("ArXiv HTML version unavailable or invalid", { htmlUrl });
    return null;
  } catch (error) {
    logger.warn("Failed to fetch HTML version, falling back to PDF", {
      htmlUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// 工具函数：从 HTML 中提取文本内容
function extractTextFromHtml(html: string): string {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // 移除脚本和样式标签
    const scripts = document.querySelectorAll("script, style");
    scripts.forEach((el) => el.remove());

    // 获取主要内容区域
    const mainContent =
      document.querySelector(".ltx_page_main") || document.querySelector(".ltx_document") || document.querySelector("body");

    if (!mainContent) {
      throw new Error("无法找到主要内容区域");
    }

    // 提取文本内容
    let text = mainContent.textContent || "";

    // 清理文本：移除多余的空白字符
    text = text.replace(/\s+/g, " ").trim();

    if (text.length < 100) {
      throw new Error("HTML 文本内容过少");
    }

    return text;
  } catch (error) {
    logger.error("Failed to extract text from HTML", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`HTML 解析失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 工具函数：获取 AI 领域最新论文
async function getRecentAIPapers(): Promise<string> {
  const url = "https://arxiv.org/list/cs.AI/recent";

  try {
    logger.info("Fetching recent AI papers", { url });

    const response = await axios({
      method: "GET",
      url: url,
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ArXiv-Paper-MCP/1.0)",
      },
    });

    return response.data;
  } catch (error) {
    logger.error("Failed to fetch recent AI papers", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`获取最新论文失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 工具函数：获取 arXiv PDF 下载链接
function getArxivPdfUrl(input: string): string {
  try {
    let pdfUrl: string;

    if (input.startsWith("http://") || input.startsWith("https://")) {
      pdfUrl = input.replace("/abs/", "/pdf/") + ".pdf";
    } else {
      pdfUrl = `http://arxiv.org/pdf/${input}.pdf`;
    }

    return pdfUrl;
  } catch (error) {
    logger.error("Failed to build arXiv PDF URL", {
      input,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`获取PDF链接失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 工具函数：下载临时 PDF 文件
async function downloadTempPdf(pdfUrl: string): Promise<string> {
  try {
    logger.debug("Downloading temporary PDF", { pdfUrl });

    const response = await axios({
      method: "GET",
      url: pdfUrl,
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ArXiv-Paper-MCP/1.0)",
      },
    });

    // 创建临时文件路径
    const tempPath = path.join(tmpdir(), `arxiv_temp_${Date.now()}.pdf`);
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    return new Promise<string>((resolve, reject) => {
      writer.on("finish", () => {
        logger.debug("Finished downloading temporary PDF", { tempPath });
        resolve(tempPath);
      });
      writer.on("error", (error) => {
        logger.error("Failed to download temporary PDF", {
          tempPath,
          error: error instanceof Error ? error.message : String(error),
        });
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        reject(error);
      });
    });
  } catch (error) {
    logger.error("Temporary PDF download request failed", {
      pdfUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`下载失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 工具函数：提取 PDF 文本内容
async function extractPdfText(pdfPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const texts: string[] = [];
    new PdfReader().parseFileItems(pdfPath, (err, item) => {
      if (err) {
        logger.error("Failed to parse PDF", {
          pdfPath,
          error: String(err),
        });
        reject(new Error("PDF 解析失败: " + err));
      } else if (!item) {
        // 解析结束，拼成一段文本
        const text = texts.join(" ").replace(/\s+/g, " ").trim();
        if (text.length < 100) {
          reject(new Error("PDF 文本提取失败或内容过少"));
        } else {
          resolve(text);
        }
      } else if (item.text) {
        texts.push(item.text);
      }
    });
  });
}

// 工具函数：解析论文内容（优先 HTML，回退 PDF）
async function parsePaperContent(input: string): Promise<{ content: string; source: "html" | "pdf" }> {
  let tempPdfPath: string | null = null;

  try {
    // 获取 arXiv ID
    const arxivId = (input.startsWith("http://") || input.startsWith("https://") ? input.split("/").pop() : input) ?? input;

    // 首先尝试获取 HTML 版本
    logger.debug("Attempting to parse paper from HTML version", { input, arxivId });
    const htmlContent = await getArxivHtmlContent(arxivId);

    let paperText: string;
    let source: "html" | "pdf";

    if (htmlContent) {
      // 使用 HTML 版本
      logger.info("Parsing paper content from HTML version", { input, arxivId });
      paperText = extractTextFromHtml(htmlContent);
      source = "html";
    } else {
      logger.warn("HTML version unavailable, falling back to PDF", { input, arxivId });
      const pdfUrl = getArxivPdfUrl(input);
      tempPdfPath = await downloadTempPdf(pdfUrl);
      paperText = await extractPdfText(tempPdfPath);
      source = "pdf";
    }

    // 构建输出内容
    let outputContent = "";
    outputContent += `=== 论文内容 (来源: ${source.toUpperCase()}) ===\n\n`;
    outputContent += paperText;

    return { content: outputContent, source };
  } catch (error) {
    logger.error("Failed to parse paper content", {
      input,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`论文内容解析失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // 清理临时 PDF 文件
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      try {
        fs.unlinkSync(tempPdfPath);
        logger.debug("Removed temporary PDF file", { tempPdfPath });
      } catch (cleanupError) {
        logger.warn("Failed to remove temporary PDF file", {
          tempPdfPath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
  }
}

export function createArxivMcpServer(): Server {
  // 创建 MCP 服务器
  const server = new Server(
    {
      name: "arxiv-paper-mcp",
      version: "1.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 注册工具列表处理器
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "search_arxiv",
          description: "搜索 arXiv 论文",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "搜索英文关键词",
              },
              maxResults: {
                type: "number",
                description: "最大结果数量",
                default: 5,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "get_recent_ai_papers",
          description: "获取 arXiv AI 领域最新论文（cs.AI/recent）",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_arxiv_pdf_url",
          description: "获取 arXiv PDF 下载链接",
          inputSchema: {
            type: "object",
            properties: {
              input: {
                type: "string",
                description: "arXiv 论文URL（如：http://arxiv.org/abs/2403.15137v1）或 arXiv ID（如：2403.15137v1）",
              },
            },
            required: ["input"],
          },
        },
        {
          name: "parse_paper_content",
          description: "解析论文内容（优先使用 HTML 版本，回退到 PDF）",
          inputSchema: {
            type: "object",
            properties: {
              input: {
                type: "string",
                description: "arXiv 论文URL或 arXiv ID",
              },
            },
            required: ["input"],
          },
        },
      ],
    };
  });

  // 注册工具调用处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const argumentKeys = args && typeof args === "object" ? Object.keys(args) : [];

    logger.info("Starting MCP tool execution", {
      toolName: name,
      argumentKeys,
    });

    try {
      switch (name) {
        case "search_arxiv": {
          const { query, maxResults = 5 } = args as { query: string; maxResults?: number };
          const results = await searchArxivPapers(query, maxResults);

          return {
            content: [
              {
                type: "text",
                text: `找到 ${results.papers.length} 篇相关论文（总计 ${results.totalResults} 篇）：\n\n${results.papers
                  .map(
                    (paper, index) =>
                      `${index + 1}. **${paper.title}**\n   ID: ${paper.id}\n   发布日期: ${paper.published}\n   作者: ${paper.authors.map((author: any) => author.name || author).join(", ")}\n   摘要: ${paper.summary.substring(0, 300)}...\n   URL: ${paper.url}\n`
                  )
                  .join("\n")}`,
              },
            ],
          };
        }

        case "get_recent_ai_papers": {
          const htmlContent = await getRecentAIPapers();

          return {
            content: [
              {
                type: "text",
                text: htmlContent,
              },
            ],
          };
        }

        case "get_arxiv_pdf_url": {
          const { input } = args as { input: string };
          const pdfUrl = getArxivPdfUrl(input);

          return {
            content: [
              {
                type: "text",
                text: `PDF 下载链接: ${pdfUrl}`,
              },
            ],
          };
        }

        case "parse_paper_content": {
          const { input } = args as { input: string };
          const result = await parsePaperContent(input);

          return {
            content: [
              {
                type: "text",
                text: result.content,
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      logger.error("MCP tool execution failed", {
        toolName: name,
        argumentKeys,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        content: [
          {
            type: "text",
            text: `工具执行失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    } finally {
      logger.info("Finished MCP tool execution", {
        toolName: name,
        argumentKeys,
      });
    }
  });

  return server;
}
