#!/usr/bin/env node
/**
 * memory_graph_mcp — MCP server bootstrap (stdio transport).
 * Stage 1: server starts and answers tools/list with tool stubs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  {
    name: "memory-graph-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

registerTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive; log to stderr only (stdout is the MCP channel).
  process.stderr.write("memory-graph-mcp: server started on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`memory-graph-mcp: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
