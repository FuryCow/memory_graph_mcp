/**
 * SQLite persistence for the knowledge graph.
 * Nodes: File, Symbol, Table (code graph). Sessions/Decisions/Bugs live in
 * dedicated journal tables (stage 5), linked to file nodes via session_files.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
export const SCHEMA_VERSION = 2;
export class GraphDb {
    db;
    constructor(dbPath) {
        if (dbPath !== ":memory:") {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.migrate();
    }
    static defaultPath(projectRoot) {
        return path.join(projectRoot, ".memory-graph", "graph.db");
    }
    migrate() {
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
        // Stage 5: session journal
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS session_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('decision','bug')),
        text TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS session_files (
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        file_node_id INTEGER NOT NULL REFERENCES nodes(id),
        PRIMARY KEY (session_id, file_node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_files_file ON session_files(file_node_id);
    `);
        this.db
            .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING")
            .run(String(SCHEMA_VERSION));
    }
    upsertNode(n) {
        const row = this.db
            .prepare(`INSERT INTO nodes (kind, name, path, start_line, end_line)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind, name, path) DO UPDATE SET
           start_line = excluded.start_line,
           end_line = excluded.end_line
         RETURNING id`)
            .get(n.kind, n.name, n.path ?? "", n.start_line, n.end_line);
        return row.id;
    }
    addEdge(e) {
        this.db
            .prepare("INSERT OR IGNORE INTO edges (src, dst, kind) VALUES (?, ?, ?)")
            .run(e.src, e.dst, e.kind);
    }
    /**
     * Prepare a file for re-indexing: drop its outgoing edges and its symbols.
     * The file node itself is kept so incoming `imports` edges from other files survive.
     */
    deleteFile(pathToDelete) {
        const tx = this.db.transaction(() => {
            this.db.prepare("DELETE FROM edges WHERE src IN (SELECT id FROM nodes WHERE path = ?)").run(pathToDelete);
            this.db.prepare("DELETE FROM nodes WHERE path = ? AND kind = 'symbol'").run(pathToDelete);
        });
        tx();
    }
    stats() {
        const nodeKinds = ["file", "symbol", "table"];
        const edgeKinds = ["imports", "calls", "reads_table", "writes_table", "contains"];
        const nodes = Object.fromEntries(nodeKinds.map((k) => [k, 0]));
        for (const r of this.db
            .prepare("SELECT kind, COUNT(*) AS c FROM nodes GROUP BY kind")
            .all()) {
            nodes[r.kind] = r.c;
        }
        const edges = Object.fromEntries(edgeKinds.map((k) => [k, 0]));
        for (const r of this.db
            .prepare("SELECT kind, COUNT(*) AS c FROM edges GROUP BY kind")
            .all()) {
            edges[r.kind] = r.c;
        }
        return { nodes, edges };
    }
    // ── Session journal (stage 5) ──────────────────────────────────────────
    recordSession(input) {
        const tx = this.db.transaction(() => {
            const { lastInsertRowid } = this.db
                .prepare("INSERT INTO sessions (topic) VALUES (?)")
                .run(input.topic);
            const sessionId = Number(lastInsertRowid);
            const insItem = this.db.prepare("INSERT INTO session_items (session_id, type, text) VALUES (?, ?, ?)");
            for (const d of input.decisions ?? [])
                insItem.run(sessionId, "decision", d);
            for (const b of input.bugs ?? [])
                insItem.run(sessionId, "bug", b);
            // skip file node ids that don't exist (defensive: FK constraint would fail)
            const insFile = this.db.prepare("INSERT OR IGNORE INTO session_files (session_id, file_node_id) VALUES (?, ?)");
            const exists = this.db.prepare("SELECT 1 FROM nodes WHERE id = ?");
            for (const fid of input.fileNodeIds ?? []) {
                if (exists.get(fid))
                    insFile.run(sessionId, fid);
            }
            return sessionId;
        });
        return tx();
    }
    /** Sessions linked to a file node (newest first). */
    sessionsForFile(fileNodeId) {
        const rows = this.db
            .prepare(`SELECT DISTINCT s.id, s.topic, s.created_at
         FROM sessions s JOIN session_files sf ON sf.session_id = s.id
         WHERE sf.file_node_id = ? ORDER BY s.created_at DESC`)
            .all(fileNodeId);
        const items = this.db.prepare("SELECT session_id, type, text FROM session_items").all();
        const bySession = new Map();
        for (const it of items) {
            if (!bySession.has(it.session_id))
                bySession.set(it.session_id, { decisions: [], bugs: [] });
            const bucket = bySession.get(it.session_id);
            (it.type === "decision" ? bucket.decisions : bucket.bugs).push(it.text);
        }
        return rows.map((r) => ({ ...r, ...(bySession.get(r.id) ?? { decisions: [], bugs: [] }) }));
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=db.js.map