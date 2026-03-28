import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

test("createServer module import and factory creation do not auto-connect transports", async () => {
  const originalConnect = Server.prototype.connect;
  const connectCalls = [];

  Server.prototype.connect = async function patchedConnect(...args) {
    connectCalls.push(args);
    return originalConnect.apply(this, args);
  };

  try {
    const modulePath = new URL(`../build/createServer.js?cacheBust=${Date.now()}`, import.meta.url).href;
    const { createArxivMcpServer } = await import(modulePath);

    assert.equal(typeof createArxivMcpServer, "function");
    assert.equal(connectCalls.length, 0, "importing factory module should not call server.connect");

    const server = createArxivMcpServer();
    assert.ok(server, "factory should return a server instance");
    assert.equal(connectCalls.length, 0, "constructing server should not call server.connect");
  } finally {
    Server.prototype.connect = originalConnect;
  }
});

test("factory-constructed server registers all four tools with expected schema shape", async () => {
  const { createArxivMcpServer } = await import("../build/createServer.js");

  const server = createArxivMcpServer();
  const client = new Client(
    {
      name: "factory-extraction-test-client",
      version: "0.0.0-test",
    },
    {
      capabilities: {},
    }
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    assert.equal(tools.length, 4, "expected exactly four registered tools");

    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.deepEqual([...byName.keys()].sort(), [
      "get_arxiv_pdf_url",
      "get_recent_ai_papers",
      "parse_paper_content",
      "search_arxiv",
    ]);

    const searchArxiv = byName.get("search_arxiv");
    assert.equal(searchArxiv?.inputSchema?.type, "object");
    assert.equal(searchArxiv?.inputSchema?.properties?.query?.type, "string");
    assert.equal(searchArxiv?.inputSchema?.properties?.maxResults?.type, "number");
    assert.equal(searchArxiv?.inputSchema?.properties?.maxResults?.default, 5);
    assert.deepEqual(searchArxiv?.inputSchema?.required, ["query"]);

    const recentAi = byName.get("get_recent_ai_papers");
    assert.equal(recentAi?.inputSchema?.type, "object");
    assert.deepEqual(recentAi?.inputSchema?.properties, {});
    assert.deepEqual(recentAi?.inputSchema?.required, []);

    const pdfUrl = byName.get("get_arxiv_pdf_url");
    assert.equal(pdfUrl?.inputSchema?.type, "object");
    assert.equal(pdfUrl?.inputSchema?.properties?.input?.type, "string");
    assert.deepEqual(pdfUrl?.inputSchema?.required, ["input"]);

    const parseContent = byName.get("parse_paper_content");
    assert.equal(parseContent?.inputSchema?.type, "object");
    assert.equal(parseContent?.inputSchema?.properties?.input?.type, "string");
    assert.deepEqual(parseContent?.inputSchema?.required, ["input"]);
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
});

test("factory keeps call handlers wired with existing success and error envelopes", async () => {
  const { createArxivMcpServer } = await import("../build/createServer.js");

  const server = createArxivMcpServer();
  const client = new Client(
    {
      name: "factory-call-handler-test-client",
      version: "0.0.0-test",
    },
    {
      capabilities: {},
    }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const success = await client.callTool({
      name: "get_arxiv_pdf_url",
      arguments: { input: "2403.15137v1" },
    });

    assert.equal(success.isError ?? false, false);
    assert.equal(success.content[0]?.type, "text");
    assert.match(success.content[0]?.text ?? "", /PDF 下载链接:\s*https:\/\/arxiv\.org\/pdf\/2403\.15137v1\.pdf/);

    const absUrlSuccess = await client.callTool({
      name: "get_arxiv_pdf_url",
      arguments: { input: "https://arxiv.org/abs/2403.15137v1" },
    });

    assert.equal(absUrlSuccess.isError ?? false, false);
    assert.match(absUrlSuccess.content[0]?.text ?? "", /PDF 下载链接:\s*https:\/\/arxiv\.org\/pdf\/2403\.15137v1\.pdf/);

    const pdfUrlSuccess = await client.callTool({
      name: "get_arxiv_pdf_url",
      arguments: { input: "https://arxiv.org/pdf/2403.15137v1.pdf" },
    });

    assert.equal(pdfUrlSuccess.isError ?? false, false);
    assert.match(pdfUrlSuccess.content[0]?.text ?? "", /PDF 下载链接:\s*https:\/\/arxiv\.org\/pdf\/2403\.15137v1\.pdf/);

    const failure = await client.callTool({
      name: "unknown_tool_name",
      arguments: {},
    });

    assert.equal(failure.isError, true);
    assert.equal(failure.content[0]?.type, "text");
    assert.match(failure.content[0]?.text ?? "", /工具执行失败:/);
    assert.match(failure.content[0]?.text ?? "", /Unknown tool: unknown_tool_name/);
  } finally {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  }
});
