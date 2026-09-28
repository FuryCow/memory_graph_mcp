/**
 * SQLite persistence for the knowledge graph.
 * Nodes: File, Symbol, Table (code graph). Sessions/Decisions/Bugs live in
 * dedicated journal tables (stage 5), linked to file nodes via session_files.
 */
import Database from "better-sqlite3";
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
export declare const SCHEMA_VERSION = 2;
export declare class GraphDb {
    readonly db: Database.Database;
    constructor(dbPath: string);
    static defaultPath(projectRoot: string): string;
    private migrate;
    upsertNode(n: NodeRow): number;
    addEdge(e: EdgeRow): void;
    /**
     * Prepare a file for re-indexing: drop its outgoing edges and its symbols.
     * The file node itself is kept so incoming `imports` edges from other files survive.
     */
    deleteFile(pathToDelete: string): void;
    stats(): {
        nodes: Record<string, number>;
        edges: Record<string, number>;
    };
    recordSession(input: {
        topic: string;
        decisions?: string[];
        bugs?: string[];
        fileNodeIds?: number[];
    }): number;
    /** Sessions linked to a file node (newest first). */
    sessionsForFile(fileNodeId: number): Array<{
        id: number;
        topic: string;
        created_at: string;
        decisions: string[];
        bugs: string[];
    }>;
    close(): void;
}
