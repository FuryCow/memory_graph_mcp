import { type FSWatcher } from "chokidar";
import { GraphDb } from "./db.js";
export interface IndexerState {
    files: number;
    lastUpdated: string | null;
}
export declare function fullScan(db: GraphDb, root: string): IndexerState;
export declare function watchProject(db: GraphDb, root: string): FSWatcher;
