/**
 * MCP tool registrations.
 * Stage 4: query_context / impact_analysis / get_side_effects are live; record_session is a stub (stage 5).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GraphDb } from "./db.js";
import { fullScan, watchProject } from "./watcher.js";
import { GraphQuery, formatSubgraph } from "./query.js";

let db: GraphDb | null = null;
let scanState = { files: 0, lastUpdated: null as string | null };
let watcherStarted = false;

function getDb(): GraphDb {
  if (!db) {
    db = new GraphDb(GraphDb.defaultPath(process.cwd()));
    scanState = fullScan(db, process.cwd());
  }
  if (!watcherStarted) {
    watcherStarted = true;
    try {
      watchProject(db, process.cwd());
    } catch (err) {
      // watcher is best-effort; graph still works from the initial scan
      process.stderr.write(`memory-graph-mcp: watcher failed to start: ${String(err)}\n`);
    }
  }
  return db;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function riskLabel(affectedFileCount: number): "low" | "medium" | "high" {
  if (affectedFileCount <= 1) return "low";
  if (affectedFileCount <= 4) return "medium";
  return "high";
}

export function registerTools(server: McpServer): void {
  server.tool(
    "graph_query_context",
    "Return the dependency subgraph for a file or symbol, plus adjacent modules.",
    {
      path: z.string().describe("File path (relative to project root)"),
      symbol: z.string().optional().describe("Optional symbol name to focus on"),
      depth: z.number().int().min(1).max(10).default(3).describe("Traversal depth"),
    },
    async ({ path: p, symbol, depth }) => {
      const q = new GraphQuery(getDb());
      const fileNode = q.findFile(p) ?? q.findFileBySuffix(p);
      const seed = symbol ? (q.findSymbol(symbol, fileNode?.path ?? undefined) ?? fileNode) : fileNode;
      if (!seed) {
        return textResult(JSON.stringify({ ok: false, error: `Not found in index: ${p}${symbol ? ` (symbol: ${symbol})` : ""}` }, null, 2));
      }
      const g = q.subgraph(seed.id, depth);
      const sessions = getDb().sessionsForFile(seed.id);
      return textResult(
        JSON.stringify(
          {
            ok: true,
            seed: seed.path ?? seed.name,
            node_count: g.nodes.length,
            subgraph: formatSubgraph(g),
            related_sessions: sessions.map((s) => ({
              id: s.id,
              topic: s.topic,
              created_at: s.created_at,
              decisions: s.decisions,
              bugs: s.bugs,
            })),
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "graph_impact_analysis",
    "Given a planned change, return affected nodes and risks.",
    {
      path: z.string().describe("File path to be changed"),
      change: z.string().describe("Description of the planned change"),
    },
    async ({ path: p, change }) => {
      const q = new GraphQuery(getDb());
      const { affected, tables } = q.impact(p);
      const files = affected.filter((n) => n.kind === "file");
      const symbols = affected.filter((n) => n.kind === "symbol");
      return textResult(
        JSON.stringify(
          {
            ok: files.length > 0,
            target: p,
            change,
            affected_files: files.map((f) => f.path),
            affected_symbols: symbols.map((s) => `${s.name} (${s.path})`),
            tables_touched: tables.map((t) => t.name),
            risk: riskLabel(files.length),
            note:
              files.length === 0
                ? "Target not found in index — file may be unindexed or path is wrong."
                : `${files.length - 1} downstream file(s) may break if this change is breaking.`,
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "graph_get_side_effects",
    "Return implicit side effects of a module (DB writes, external calls, etc.).",
    {
      path: z.string().describe("File path (relative to project root)"),
    },
    async ({ path: p }) => {
      const q = new GraphQuery(getDb());
      const fx = q.sideEffects(p);
      const found = fx.reads_tables.length + fx.writes_tables.length + fx.calls.length > 0;
      return textResult(
        JSON.stringify(
          {
            ok: found,
            target: p,
            ...fx,
            note: found ? undefined : "No indexed side effects (or file not in index).",
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "graph_record_session",
    "Record a discussion/debug session with decisions and bugs, linked to related files.",
    {
      topic: z.string().describe("Session topic"),
      decisions: z.array(z.string()).optional().describe("Decisions made"),
      bugs: z.array(z.string()).optional().describe("Bugs encountered/fixed"),
      related_paths: z.array(z.string()).optional().describe("Related file paths (relative to project root)"),
    },
    async ({ topic, decisions, bugs, related_paths }) => {
      const d = getDb();
      const q = new GraphQuery(d);
      const fileNodeIds: number[] = [];
      for (const p of related_paths ?? []) {
        const f = q.findFile(p) ?? q.findFileBySuffix(p);
        if (f) fileNodeIds.push(f.id);
      }
      const id = d.recordSession({ topic, decisions, bugs, fileNodeIds });
      return textResult(
        JSON.stringify(
          {
            ok: true,
            session_id: id,
            linked_files: fileNodeIds.length,
            unlinked_paths: (related_paths ?? []).length - fileNodeIds.length,
          },
          null,
          2
        )
      );
    }
  );

  server.tool(
    "graph_stats",
    "Return index state: node/edge counts, files indexed, last update time.",
    {},
    async () => {
      const d = getDb();
      const s = d.stats();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { ok: true, files: scanState.files, last_updated: scanState.lastUpdated, ...s },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
