export type RuntimeConfig = {
  host: string;
  port: number;
  path: string;
};

type RuntimeEnv = Record<string, string | undefined>;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_PATH = "/mcp";

function parseHost(rawHost: string | undefined): string {
  const host = rawHost ?? DEFAULT_HOST;
  if (host.trim().length === 0) {
    throw new Error("Invalid MCP_HOST: host must be a non-empty string");
  }
  return host;
}

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("Invalid MCP_PORT: expected an integer between 1 and 65535");
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid MCP_PORT: expected an integer between 1 and 65535");
  }

  return port;
}

function parsePath(rawPath: string | undefined): string {
  const path = rawPath ?? DEFAULT_PATH;

  if (path.length === 0) {
    throw new Error("Invalid MCP_PATH: path must be a non-empty string starting with '/'");
  }

  if (!path.startsWith("/")) {
    throw new Error("Invalid MCP_PATH: path must start with '/'");
  }

  return path;
}

export function loadRuntimeConfig(env: RuntimeEnv = process.env): RuntimeConfig {
  return {
    host: parseHost(env.MCP_HOST),
    port: parsePort(env.MCP_PORT),
    path: parsePath(env.MCP_PATH),
  };
}
