import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../build/runtimeConfig.js";

test("runtime config uses defaults when MCP_* env vars are absent", () => {
  const config = loadRuntimeConfig({});

  assert.deepEqual(config, {
    host: "127.0.0.1",
    port: 3000,
    path: "/mcp",
  });
});

test("runtime config reads MCP_HOST, MCP_PORT, MCP_PATH overrides", () => {
  const config = loadRuntimeConfig({
    MCP_HOST: "0.0.0.0",
    MCP_PORT: "8080",
    MCP_PATH: "/rpc",
  });

  assert.deepEqual(config, {
    host: "0.0.0.0",
    port: 8080,
    path: "/rpc",
  });
});

test("runtime config rejects non-numeric MCP_PORT", () => {
  assert.throws(
    () => loadRuntimeConfig({ MCP_PORT: "abc" }),
    /Invalid MCP_PORT: expected an integer between 1 and 65535/
  );
});

test("runtime config rejects out-of-range MCP_PORT", () => {
  assert.throws(
    () => loadRuntimeConfig({ MCP_PORT: "70000" }),
    /Invalid MCP_PORT: expected an integer between 1 and 65535/
  );
});

test("runtime config rejects MCP_PATH without a leading slash", () => {
  assert.throws(() => loadRuntimeConfig({ MCP_PATH: "mcp" }), /Invalid MCP_PATH: path must start with '\/'/);
});

test("runtime config rejects empty MCP_HOST", () => {
  assert.throws(() => loadRuntimeConfig({ MCP_HOST: "" }), /Invalid MCP_HOST: host must be a non-empty string/);
});
