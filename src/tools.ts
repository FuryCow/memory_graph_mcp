/**
 * MCP tool registrations.
 * Stage 2: graph_stats is live (AST indexer); the rest remain stubs for stages 3–5.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GraphDb } from "./db.js";
import { indexFile } from "./indexer.js";
import { listSourceFiles } from "./walker.js";
import fs from "node:fs";

let db: GraphDb | null = null;
let indexed = false;

function getDb(): GraphDb {
  if (!db) db = new GraphDb(GraphDb.defaultPath(process.cwd()));
  if (!indexed) {
    indexed = true;
    const root = process.cwd();
    for (const rel of listSourceFiles(root)) {
      try {
        const abs = root.replace(/\\/g, "/") + "/" + rel;
        const source = fs.readFileSync(abs, "utf8");
        indexFile(db, root, rel, source);
      } catch {
        // skip unreadable files
      }
    }
  }
  return db;
}

const stub = (tool: string) => async () => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(
        { ok: true, tool, stage: "stub", message: "Not implemented yet (stages 3–5)" },
        null,
        2
      ),
    },
  ],
});

export function registerTools(server: McpServer): void {
  server.tool(
    "graph_query_context",
    "Return the dependency subgraph for a file or symbol, plus adjacent modules.",
    {
      path: z.string().describe("File path (relative to project root)"),
      symbol: z.string().optional().describe("Optional symbol name to focus on"),
      depth: z.number().int().min(1).max(10).default(3).describe("Traversal depth"),
    },
    stub("graph.query_context")
  );

  server.tool(
    "graph_impact_analysis",
    "Given a planned change, return affected nodes and risks.",
    {
      path: z.string().describe("File path to be changed"),
      change: z.string().describe("Description of the planned change"),
    },
    stub("graph.impact_analysis")
  );

  server.tool(
    "graph_get_side_effects",
    "Return implicit side effects of a module (DB writes, external calls, etc.).",
    {
      path: z.string().describe("File path (relative to project root)"),
    },
    stub("graph.get_side_effects")
  );

  server.tool(
    "graph_record_session",
    "Record a discussion/debug session with decisions and bugs.",
    {
      topic: z.string().describe("Session topic"),
      decisions: z.array(z.string()).optional().describe("Decisions made"),
      bugs: z.array(z.string()).optional().describe("Bugs encountered/fixed"),
      related_paths: z.array(z.string()).optional().describe("Related file paths"),
    },
    stub("graph.record_session")
  );

  server.tool(
    "graph_stats",
    "Return index state: node/edge counts, last update time.",
    {},
    async () => {
      const d = getDb();
      const s = d.stats();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, ...s }, null, 2),
          },
        ],
      };
    }
  );
}
