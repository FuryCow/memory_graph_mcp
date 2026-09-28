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
export declare class GraphQuery {
    private readonly db;
    constructor(db: GraphDb);
    private loadAdjacency;
    /**
     * BFS from a seed node over undirected edges, up to `depth`.
     * Returns visited nodes and the edges between them.
     */
    subgraph(seedId: number, depth: number, maxNodes?: number): {
        nodes: GraphNodeInfo[];
        edges: GraphEdgeInfo[];
    };
    findFile(pathStr: string): GraphNodeInfo | null;
    findFileBySuffix(pathStr: string): GraphNodeInfo | null;
    findSymbol(name: string, pathStr?: string): GraphNodeInfo | null;
    /** Reverse-dependency blast radius: all files that (transitively) import/call into this file. */
    impact(pathStr: string, maxDepth?: number): {
        affected: GraphNodeInfo[];
        tables: GraphNodeInfo[];
    };
    /** Side effects of one file: table reads/writes and external calls. */
    sideEffects(pathStr: string): {
        reads_tables: string[];
        writes_tables: string[];
        calls: string[];
    };
}
/** Compact LLM-friendly rendering of a subgraph. */
export declare function formatSubgraph(g: {
    nodes: GraphNodeInfo[];
    edges: GraphEdgeInfo[];
}): string;
