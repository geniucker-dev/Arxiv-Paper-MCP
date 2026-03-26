import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import { startHttpHarness } from "../build/httpTestHarness.js";

function createJsonRpcHeaders(extra = {}) {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...extra,
  };
}

function postJsonRpc(url, message, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      ...createJsonRpcHeaders(),
      ...headers,
    },
    body: JSON.stringify(message),
  });
}

async function readJsonRpcPayload(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (/application\/json/i.test(contentType)) {
    return response.json();
  }

  if (!/text\/event-stream/i.test(contentType)) {
    throw new Error(`Unsupported response content-type: ${contentType}`);
  }

  const ssePayload = await response.text();
  const blocks = ssePayload.split("\n\n");
  for (const rawBlock of blocks) {
    const block = rawBlock.replace(/\r/g, "");
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .filter((line) => line.length > 0);

    for (const line of dataLines) {
      try {
        return JSON.parse(line);
      } catch {
      }
    }
  }

  throw new Error("Failed to parse JSON-RPC payload in SSE response");
}

function rawHttpRequest(url, { method, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = request(
      {
        method,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );

    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function withHarness(run, options = undefined) {
  const harness = await startHttpHarness(options);
  try {
    await run(harness);
  } finally {
    await harness.close();
  }
}

function assertCorsHeaders(headers, origin = undefined) {
  assert.equal(headers.get("access-control-allow-origin"), origin ?? "*");
  assert.match(headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(headers.get("access-control-allow-methods") ?? "", /OPTIONS/);
}

function assertRawCorsHeaders(headers, origin = undefined) {
  const allowOrigin = headers["access-control-allow-origin"];
  const allowMethods = headers["access-control-allow-methods"];
  assert.equal(Array.isArray(allowOrigin) ? allowOrigin[0] : allowOrigin, origin ?? "*");
  assert.match(String(Array.isArray(allowMethods) ? allowMethods[0] : allowMethods), /POST/);
  assert.match(String(Array.isArray(allowMethods) ? allowMethods[0] : allowMethods), /OPTIONS/);
}

test("runtime serves a single MCP endpoint and enforces POST-only transport", async () => {
  await withHarness(async (harness) => {
    const getResponse = await fetch(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "GET",
      headers: { accept: "text/event-stream" },
    });
    assert.equal(getResponse.status, 405);
    assertCorsHeaders(getResponse.headers);

    const getPayload = await getResponse.json();
    assert.equal(getPayload.error?.message, "Method not allowed.");

    const putResponse = await fetch(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "PUT",
    });
    assert.equal(putResponse.status, 405);

    const wrongPathResponse = await fetch(`${harness.baseUrl}/wrong-path`, {
      method: "POST",
      headers: createJsonRpcHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize", params: {} }),
    });
    assert.equal(wrongPathResponse.status, 404);
    assertCorsHeaders(wrongPathResponse.headers);
  });
});

test("runtime responds to CORS preflight requests for browser clients", async () => {
  await withHarness(async (harness) => {
    const origin = "https://lobehub.example.com";
    const preflightResponse = await fetch(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, accept, mcp-protocol-version",
      },
    });

    assert.equal(preflightResponse.status, 204);
    assertCorsHeaders(preflightResponse.headers, origin);
    assert.match(preflightResponse.headers.get("access-control-allow-headers") ?? "", /Content-Type/i);
    assert.match(preflightResponse.headers.get("access-control-expose-headers") ?? "", /Mcp-Protocol-Version/i);
  });
});

test("runtime stays stateless and does not emit or require MCP sessions", async () => {
  await withHarness(async (harness) => {
    const initializeResponse = await postJsonRpc(`${harness.baseUrl}${harness.mcpPath}`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "http-harness-test-client",
          version: "0.0.0-test",
        },
      },
    });

    assert.equal(initializeResponse.status, 200);
    assert.equal(initializeResponse.headers.get("mcp-session-id"), null);
    assertCorsHeaders(initializeResponse.headers);

    const initializePayload = await readJsonRpcPayload(initializeResponse);
    assert.equal(initializePayload.id, 1);
    assert.equal(initializePayload.jsonrpc, "2.0");
    assert.ok(initializePayload.result?.protocolVersion, "initialize result should include protocolVersion");
    assert.equal(initializePayload.result?.serverInfo?.name, "arxiv-paper-mcp");

    const initializedResponse = await postJsonRpc(
      `${harness.baseUrl}${harness.mcpPath}`,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      {
        "mcp-protocol-version": initializePayload.result.protocolVersion,
      }
    );
    assert.equal(initializedResponse.status, 202);
    assert.equal(initializedResponse.headers.get("mcp-session-id"), null);
    assertCorsHeaders(initializedResponse.headers);

    const toolsListResponse = await postJsonRpc(
      `${harness.baseUrl}${harness.mcpPath}`,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      {
        "mcp-protocol-version": initializePayload.result.protocolVersion,
      }
    );
    assert.equal(toolsListResponse.status, 200);
    assert.equal(toolsListResponse.headers.get("mcp-session-id"), null);
    assertCorsHeaders(toolsListResponse.headers);

    const toolsListPayload = await readJsonRpcPayload(toolsListResponse);
    assert.equal(toolsListPayload.id, 2);
    assert.equal(Array.isArray(toolsListPayload.result?.tools), true);
    assert.equal(toolsListPayload.result.tools.length, 4);
  });
});

test("runtime serves real tool calls over stateless HTTP without session headers", async () => {
  await withHarness(async (harness) => {
    const initializeResponse = await postJsonRpc(`${harness.baseUrl}${harness.mcpPath}`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "http-tool-call-client",
          version: "0.0.0-test",
        },
      },
    });

    assert.equal(initializeResponse.status, 200);
    const initializePayload = await readJsonRpcPayload(initializeResponse);

    const initializedResponse = await postJsonRpc(
      `${harness.baseUrl}${harness.mcpPath}`,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      {
        "mcp-protocol-version": initializePayload.result.protocolVersion,
      }
    );
    assert.equal(initializedResponse.status, 202);

    const toolCallResponse = await postJsonRpc(
      `${harness.baseUrl}${harness.mcpPath}`,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_arxiv_pdf_url",
          arguments: {
            input: "2403.15137v1",
          },
        },
      },
      {
        "mcp-protocol-version": initializePayload.result.protocolVersion,
      }
    );

    assert.equal(toolCallResponse.status, 200);
    assert.equal(toolCallResponse.headers.get("mcp-session-id"), null);
    assertCorsHeaders(toolCallResponse.headers);

    const toolCallPayload = await readJsonRpcPayload(toolCallResponse);
    assert.equal(toolCallPayload.id, 2);
    assert.equal(toolCallPayload.result?.isError ?? false, false);
    assert.match(toolCallPayload.result?.content?.[0]?.text ?? "", /PDF 下载链接:/);
  });
});

test("runtime enforces Streamable HTTP POST header and payload requirements", async () => {
  await withHarness(async (harness) => {
    const missingAcceptResponse = await rawHttpRequest(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(missingAcceptResponse.statusCode, 406);
    assertRawCorsHeaders(missingAcceptResponse.headers);

    const invalidAcceptResponse = await fetch(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(invalidAcceptResponse.status, 406);
    assertCorsHeaders(invalidAcceptResponse.headers);

    const invalidContentTypeResponse = await fetch(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "text/plain",
      },
      body: "not-json",
    });
    assert.equal(invalidContentTypeResponse.status, 415);
    assertCorsHeaders(invalidContentTypeResponse.headers);

    const malformedJsonResponse = await rawHttpRequest(`${harness.baseUrl}${harness.mcpPath}`, {
      method: "POST",
      headers: createJsonRpcHeaders(),
      body: "{\"jsonrpc\": \"2.0\",",
    });
    assert.equal(malformedJsonResponse.statusCode, 400);
    assertRawCorsHeaders(malformedJsonResponse.headers);
  });
});

test("runtime rejects unsupported MCP-Protocol-Version after initialization", async () => {
  await withHarness(async (harness) => {
    const initializeResponse = await postJsonRpc(`${harness.baseUrl}${harness.mcpPath}`, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "protocol-test-client", version: "0.0.0" },
      },
    });

    assert.equal(initializeResponse.status, 200);
    assert.equal(initializeResponse.headers.get("mcp-session-id"), null);
    const initializePayload = await readJsonRpcPayload(initializeResponse);

    const invalidProtocolResponse = await postJsonRpc(
      `${harness.baseUrl}${harness.mcpPath}`,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      {
        "mcp-protocol-version": "not-a-real-version",
      }
    );

    assert.equal(invalidProtocolResponse.status, 400);
    assertCorsHeaders(invalidProtocolResponse.headers);
    const invalidProtocolPayload = await invalidProtocolResponse.json();
    assert.match(
      invalidProtocolPayload.error?.message ?? "",
      /Bad Request: Unsupported protocol version:/
    );
    assert.ok(initializePayload.result?.protocolVersion);
  });
});
