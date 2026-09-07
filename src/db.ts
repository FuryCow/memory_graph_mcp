/**
 * SQLite persistence for the knowledge graph.
 * Nodes: File, Symbol, Table. Edges: imports, calls, reads_table, writes_table.
 * (Session/Decision/Bug arrive in stage 5.)
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type NodeKind = "file" | "symbol" | "table";
export type EdgeKind = "imports" | "calls" | "reads_table" | "writes_table" | "contains";

export interface NodeRow {
  id?: number;
  kind: NodeKind;
  name: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
}

export interface EdgeRow {
  src: number;
  dst: number;
  kind: EdgeKind;
}

export const SCHEMA_VERSION = 1;

export class GraphDb {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  static defaultPath(projectRoot: string): string {
    return path.join(projectRoot, ".memory-graph", "graph.db");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('file','symbol','table')),
        name TEXT NOT NULL,
        path TEXT,
        start_line INTEGER,
        end_line INTEGER,
        UNIQUE (kind, name, path)
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
      CREATE TABLE IF NOT EXISTS edges (
        src INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        dst INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('imports','calls','reads_table','writes_table','contains')),
        PRIMARY KEY (src, dst, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
    `);
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING"
      )
      .run(String(SCHEMA_VERSION));
  }

  upsertNode(n: NodeRow): number {
    const row = this.db
      .prepare(
        `INSERT INTO nodes (kind, name, path, start_line, end_line)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind, name, path) DO UPDATE SET
           start_line = excluded.start_line,
           end_line = excluded.end_line
         RETURNING id`
      )
      .get(n.kind, n.name, n.path ?? "", n.start_line, n.end_line) as { id: number };
    return row.id;
  }

  addEdge(e: EdgeRow): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO edges (src, dst, kind) VALUES (?, ?, ?)"
      )
      .run(e.src, e.dst, e.kind);
  }

  /**
   * Prepare a file for re-indexing: drop its outgoing edges and its symbols.
   * The file node itself is kept so incoming `imports` edges from other files survive.
   */
  deleteFile(pathToDelete: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM edges WHERE src IN (SELECT id FROM nodes WHERE path = ?)").run(pathToDelete);
      this.db.prepare("DELETE FROM nodes WHERE path = ? AND kind = 'symbol'").run(pathToDelete);
    });
    tx();
  }

  stats(): { nodes: Record<string, number>; edges: Record<string, number> } {
    const nodeKinds = ["file", "symbol", "table"];
    const edgeKinds = ["imports", "calls", "reads_table", "writes_table", "contains"];
    const nodes: Record<string, number> = Object.fromEntries(nodeKinds.map((k) => [k, 0]));
    for (const r of this.db
      .prepare("SELECT kind, COUNT(*) AS c FROM nodes GROUP BY kind")
      .all() as Array<{ kind: string; c: number }>) {
      nodes[r.kind] = r.c;
    }
    const edges: Record<string, number> = Object.fromEntries(edgeKinds.map((k) => [k, 0]));
    for (const r of this.db
      .prepare("SELECT kind, COUNT(*) AS c FROM edges GROUP BY kind")
      .all() as Array<{ kind: string; c: number }>) {
      edges[r.kind] = r.c;
    }
    return { nodes, edges };
  }

  close(): void {
    this.db.close();
  }
}
