import { startServerRuntime } from "./index.js";

export type HttpHarnessOptions = {
  host?: string;
  port?: number;
  mcpPath?: string;
};

export type HttpHarness = {
  baseUrl: string;
  mcpPath: string;
  close: () => Promise<void>;
};

function normalizeMcpPath(inputPath: string): string {
  return inputPath.startsWith("/") ? inputPath : `/${inputPath}`;
}

export async function startHttpHarness(options: HttpHarnessOptions = {}): Promise<HttpHarness> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const mcpPath = normalizeMcpPath(options.mcpPath ?? "/mcp");
  const runtime = await startServerRuntime({ host, port, path: mcpPath });

  return {
    baseUrl: runtime.baseUrl,
    mcpPath,
    close: runtime.close,
  };
}
