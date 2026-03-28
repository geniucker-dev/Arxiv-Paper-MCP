#!/usr/bin/env node

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createArxivMcpServer } from "./createServer.js";
import { getConfiguredLogLevel, logger } from "./logger.js";
import { loadRuntimeConfig, RuntimeConfig } from "./runtimeConfig.js";

type RuntimeInstance = {
  baseUrl: string;
  close: () => Promise<void>;
};

const CORS_ALLOW_METHODS_MCP = "POST, OPTIONS";
const CORS_ALLOW_METHODS_HEALTH = "GET, OPTIONS";
const CORS_ALLOW_HEADERS = "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Authorization";
const CORS_EXPOSE_HEADERS = "Content-Type, Mcp-Protocol-Version, Mcp-Session-Id";

function getRequestSummary(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) {
    return {
      batch: true,
      size: payload.length,
      methods: payload
        .map((entry) => (typeof entry === "object" && entry !== null && "method" in entry ? entry.method : undefined))
        .filter((method) => typeof method === "string"),
    };
  }

  if (typeof payload === "object" && payload !== null) {
    const request = payload as { id?: unknown; method?: unknown };
    return {
      batch: false,
      id: request.id,
      method: request.method,
    };
  }

  return { batch: false, payloadType: typeof payload };
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  if (res.headersSent) {
    return;
  }

  const payload = {
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  };

  res.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function getCorsHeaders(req: IncomingMessage, allowMethods: string = CORS_ALLOW_METHODS_MCP): Record<string, string> {
  const originHeader = req.headers.origin;
  const allowOrigin = typeof originHeader === "string" && originHeader.length > 0 ? originHeader : "*";

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": allowMethods,
    "access-control-allow-headers": CORS_ALLOW_HEADERS,
    "access-control-expose-headers": CORS_EXPOSE_HEADERS,
    vary: "Origin",
  };
}

function writePreflightResponse(req: IncomingMessage, res: ServerResponse): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(204, {
    ...getCorsHeaders(req),
  });
  res.end();
}

function writeHealthResponse(req: IncomingMessage, res: ServerResponse): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(200, {
    "content-type": "application/json",
    ...getCorsHeaders(req, CORS_ALLOW_METHODS_HEALTH),
  });
  res.end(JSON.stringify({ status: "ok" }));
}

function writeNotFound(req: IncomingMessage, res: ServerResponse): void {
  if (res.headersSent) {
    return;
  }

  res.writeHead(404, {
    "content-type": "text/plain; charset=utf-8",
    ...getCorsHeaders(req),
  });
  res.end("Not Found");
}

function validatePostHeaders(req: IncomingMessage, res: ServerResponse): boolean {
  const accept = req.headers.accept;
  if (
    typeof accept !== "string" ||
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  ) {
    writeJsonRpcError(
      res,
      406,
      -32000,
      "Not Acceptable: Client must accept both application/json and text/event-stream",
      getCorsHeaders(req)
    );
    return false;
  }

  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.includes("application/json")) {
    writeJsonRpcError(
      res,
      415,
      -32000,
      "Unsupported Media Type: Content-Type must be application/json",
      getCorsHeaders(req)
    );
    return false;
  }

  return true;
}

function attachResponseCleanup(
  req: IncomingMessage,
  res: ServerResponse,
  transport: StreamableHTTPServerTransport,
  server: ReturnType<typeof createArxivMcpServer>
): void {
  let cleanedUp = false;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await Promise.allSettled([transport.close(), server.close()]);
  };

  const cleanupLater = (): void => {
    void cleanup();
  };

  req.once("close", cleanupLater);
  res.once("close", cleanupLater);
  res.once("finish", cleanupLater);
}

async function parseRequestJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody);
}

export async function startServerRuntime(config: Partial<RuntimeConfig> = {}): Promise<RuntimeInstance> {
  const resolvedConfig = {
    ...loadRuntimeConfig(),
    ...config,
  };

  const handleMcpRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const startedAt = Date.now();

    if (req.method !== "POST") {
      if (req.method === "OPTIONS") {
        logger.debug("Handled MCP CORS preflight request", {
          path: req.url,
          origin: req.headers.origin,
        });
        writePreflightResponse(req, res);
        return;
      }

      logger.warn("Rejected non-POST MCP request", {
        method: req.method,
        path: req.url,
      });
      writeJsonRpcError(res, 405, -32000, "Method not allowed.", {
        allow: "POST, OPTIONS",
        ...getCorsHeaders(req),
      });
      return;
    }

    if (!validatePostHeaders(req, res)) {
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = await parseRequestJson(req);
    } catch {
      logger.warn("Rejected malformed JSON payload", {
        method: req.method,
        path: req.url,
      });
      writeJsonRpcError(res, 400, -32700, "Parse error: Invalid JSON", getCorsHeaders(req));
      return;
    }

    logger.info("Accepted MCP request", {
      method: req.method,
      path: req.url,
      ...getRequestSummary(parsedBody),
    });

    const corsHeaders = getCorsHeaders(req);
    for (const [headerName, headerValue] of Object.entries(corsHeaders)) {
      res.setHeader(headerName, headerValue);
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = createArxivMcpServer();
    attachResponseCleanup(req, res, transport, server);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      logger.info("Completed MCP request", {
        method: req.method,
        path: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        ...getRequestSummary(parsedBody),
      });
    } catch (error) {
      logger.error("Failed to handle MCP request", {
        method: req.method,
        path: req.url,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ...getRequestSummary(parsedBody),
      });
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error", getCorsHeaders(req));
      }
    }
  };

  const httpServer = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (requestUrl.pathname === "/health") {
      writeHealthResponse(req, res);
      return;
    }

    if (requestUrl.pathname !== resolvedConfig.path) {
      logger.warn("Rejected request for unknown path", {
        method: req.method,
        path: requestUrl.pathname,
      });
      writeNotFound(req, res);
      return;
    }

    await handleMcpRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(resolvedConfig.port, resolvedConfig.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve HTTP server address");
  }

  const baseUrl = `http://${resolvedConfig.host}:${(address as AddressInfo).port}`;

  const close = async (): Promise<void> => {
    logger.info("Shutting down MCP Streamable HTTP server", {
      baseUrl,
      path: resolvedConfig.path,
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  logger.info("MCP Streamable HTTP server listening", {
    endpoint: `${baseUrl}${resolvedConfig.path}`,
    host: resolvedConfig.host,
    port: address.port,
    path: resolvedConfig.path,
    logLevel: getConfiguredLogLevel(),
  });

  return {
    baseUrl,
    close,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = await startServerRuntime();

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
