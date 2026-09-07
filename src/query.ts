/**
 * Retrieval layer (stage 4): BFS subgraph extraction, impact analysis,
 * side-effect queries. Produces compact LLM-friendly output.
 */
import type { GraphDb } from "./db.js";

export interface GraphNodeInfo {
  id: number;
  kind: string;
  name: string;
  path: string | null;
  start_line: number | null;
  end_line: number | null;
}

export interface GraphEdgeInfo {
  src: number;
  dst: number;
  kind: string;
}

interface Adjacency {
  // nodeId → outgoing/incoming edges
  out: Map<number, GraphEdgeInfo[]>;
  in: Map<number, GraphEdgeInfo[]>;
  nodes: Map<number, GraphNodeInfo>;
}

export class GraphQuery {
  constructor(private readonly db: GraphDb) {}

  private loadAdjacency(): Adjacency {
    const nodes = new Map<number, GraphNodeInfo>();
    for (const r of this.db.db.prepare(
      "SELECT id, kind, name, path, start_line, end_line FROM nodes"
    ).all() as Array<GraphNodeInfo>) {
      nodes.set(r.id, r);
    }
    const out = new Map<number, GraphEdgeInfo[]>();
    const inc = new Map<number, GraphEdgeInfo[]>();
    for (const r of this.db.db.prepare(
      "SELECT src, dst, kind FROM edges"
    ).all() as Array<GraphEdgeInfo>) {
      if (!out.has(r.src)) out.set(r.src, []);
      out.get(r.src)!.push(r);
      if (!inc.has(r.dst)) inc.set(r.dst, []);
      inc.get(r.dst)!.push(r);
    }
    return { out, in: inc, nodes };
  }

  /**
   * BFS from a seed node over undirected edges, up to `depth`.
   * Returns visited nodes and the edges between them.
   */
  subgraph(seedId: number, depth: number, maxNodes = 60): { nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] } {
    const adj = this.loadAdjacency();
    const visited = new Set<number>([seedId]);
    let frontier = [seedId];
    const edges: GraphEdgeInfo[] = [];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        const rels = [...(adj.out.get(id) ?? []), ...(adj.in.get(id) ?? [])];
        for (const e of rels) {
          edges.push(e);
          const other = e.src === id ? e.dst : e.src;
          if (!visited.has(other)) {
            visited.add(other);
            next.push(other);
            if (visited.size >= maxNodes) break;
          }
        }
        if (visited.size >= maxNodes) break;
      }
      frontier = next;
    }
    // keep only edges whose both endpoints are visited (cleaner subgraph)
    const kept = edges.filter((e) => visited.has(e.src) && visited.has(e.dst));
    const unique = [...new Map(kept.map((e) => [`${e.src}:${e.dst}:${e.kind}`, e])).values()];
    return { nodes: [...visited].map((id) => adj.nodes.get(id)!).filter(Boolean), edges: unique };
  }

  findFile(pathStr: string): GraphNodeInfo | null {
    const row = this.db.db
      .prepare("SELECT id, kind, name, path, start_line, end_line FROM nodes WHERE path = ? AND kind = 'file'")
      .get(pathStr) as GraphNodeInfo | undefined;
    return row ?? null;
  }

  findFileBySuffix(pathStr: string): GraphNodeInfo | null {
    const row = this.db.db
      .prepare("SELECT id, kind, name, path, start_line, end_line FROM nodes WHERE path LIKE ? AND kind = 'file' ORDER BY LENGTH(path) LIMIT 1")
      .get(`%${pathStr.replace(/\\/g, "/")}`) as GraphNodeInfo | undefined;
    return row ?? null;
  }

  findSymbol(name: string, pathStr?: string): GraphNodeInfo | null {
    const row = pathStr
      ? this.db.db
          .prepare("SELECT id, kind, name, path, start_line, end_line FROM nodes WHERE name = ? AND path = ? AND kind = 'symbol' ORDER BY id LIMIT 1")
          .get(name, pathStr) as GraphNodeInfo | undefined
      : this.db.db
          .prepare("SELECT id, kind, name, path, start_line, end_line FROM nodes WHERE name = ? AND kind = 'symbol' ORDER BY LENGTH(path) LIMIT 1")
          .get(name) as GraphNodeInfo | undefined;
    return row ?? null;
  }

  /** Reverse-dependency blast radius: all files that (transitively) import/call into this file. */
  impact(pathStr: string, maxDepth = 5): { affected: GraphNodeInfo[]; tables: GraphNodeInfo[] } {
    const fileNode = this.findFile(pathStr) ?? this.findFileBySuffix(pathStr);
    if (!fileNode) return { affected: [], tables: [] };
    const adj = this.loadAdjacency();
    // traverse inbound imports/calls/contains edges from the file and its symbols
    const affected = new Set<number>([fileNode.id]);
    const tables = new Set<number>();
    let frontier = [fileNode.id];
    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const e of adj.in.get(id) ?? []) {
          if (e.kind !== "imports" && e.kind !== "calls" && e.kind !== "contains") continue;
          const srcNode = adj.nodes.get(e.src);
          if (!srcNode) continue;
          if (srcNode.kind === "table") {
            tables.add(e.src);
            continue;
          }
          if (!affected.has(e.src)) {
            affected.add(e.src);
            next.push(e.src);
          }
        }
      }
      frontier = next;
    }
    // tables this file (or its symbols) touch
    for (const id of affected) {
      for (const e of adj.out.get(id) ?? []) {
        if (e.kind === "reads_table" || e.kind === "writes_table") tables.add(e.dst);
      }
    }
    return {
      affected: [...affected].map((id) => adj.nodes.get(id)!),
      tables: [...tables].map((id) => adj.nodes.get(id)!),
    };
  }

  /** Side effects of one file: table reads/writes and external calls. */
  sideEffects(pathStr: string): {
    reads_tables: string[];
    writes_tables: string[];
    calls: string[];
  } {
    const fileNode = this.findFile(pathStr) ?? this.findFileBySuffix(pathStr);
    if (!fileNode) return { reads_tables: [], writes_tables: [], calls: [] };
    const reads: string[] = [];
    const writes: string[] = [];
    const calls: string[] = [];
    for (const e of this.db.db
      .prepare(
        `SELECT e.kind, n.name, n.kind AS dst_kind FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ?`
      )
      .all(fileNode.id) as Array<{ kind: string; name: string; dst_kind: string }>) {
      if (e.kind === "reads_table") reads.push(e.name);
      else if (e.kind === "writes_table") writes.push(e.name);
      else if (e.kind === "calls" && e.dst_kind === "symbol") calls.push(e.name);
    }
    return { reads_tables: [...new Set(reads)].sort(), writes_tables: [...new Set(writes)].sort(), calls: [...new Set(calls)].sort() };
  }
}

/** Compact LLM-friendly rendering of a subgraph. */
export function formatSubgraph(g: { nodes: GraphNodeInfo[]; edges: GraphEdgeInfo[] }): string {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const label = (n: GraphNodeInfo): string => {
    if (n.kind === "file") return n.path ?? n.name;
    if (n.kind === "table") return `table:${n.name}`;
    return `${n.name}()`;
  };
  const lines = g.nodes.map((n) => `[${n.kind}] ${label(n)}${n.kind === "symbol" && n.path ? ` (${n.path})` : ""}`);
  const edgeLines = g.edges.map((e) => {
    const s = byId.get(e.src);
    const d = byId.get(e.dst);
    return `${s ? label(s) : e.src} --${e.kind}--> ${d ? label(d) : e.dst}`;
  });
  return [...lines, "", ...edgeLines].join("\n");
}
