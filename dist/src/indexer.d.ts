import type { GraphDb } from "./db.js";
export interface IndexResult {
    files: number;
    symbols: number;
    imports: number;
    calls: number;
    tableRefs: number;
}
export declare function indexFile(db: GraphDb, rootDir: string, filePath: string, source: string): void;
