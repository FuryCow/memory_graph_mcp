/**
 * Incremental indexer driver (stage 3): initial full scan + chokidar watcher
 * that re-indexes only changed files. Uses mtime as change detector.
 */
import fs from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { GraphDb } from "./db.js";
import { indexFile } from "./indexer.js";
import { listSourceFiles } from "./walker.js";

export interface IndexerState {
  files: number;
  lastUpdated: string | null;
}

const mtimeCache = new Map<string, number>();

function indexOne(db: GraphDb, root: string, rel: string): boolean {
  const abs = path.join(root, rel);
  let source: string;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    return false;
  }
  const mtime = fs.statSync(abs).mtimeMs;
  const cached = mtimeCache.get(rel);
  if (cached === mtime) return false; // unchanged
  mtimeCache.set(rel, mtime);
  indexFile(db, root, rel, source);
  return true;
}

export function fullScan(db: GraphDb, root: string): IndexerState {
  const files = listSourceFiles(root);
  for (const rel of files) {
    try {
      indexOne(db, root, rel);
    } catch {
      // skip files that fail to parse
    }
  }
  return { files: files.length, lastUpdated: new Date().toISOString() };
}

export function watchProject(db: GraphDb, root: string): FSWatcher {
  const absRoot = path.resolve(root);
  const watcher = watch(
    listSourceFiles(root).map((f) => path.join(absRoot, f)),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    }
  );

  const reindex = (absPath: string): void => {
    const rel = path.relative(absRoot, absPath).replace(/\\/g, "/");
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) return;
    try {
      if (indexOne(db, absRoot, rel)) {
        process.stderr.write(`memory-graph-mcp: reindexed ${rel}\n`);
      }
    } catch {
      // parse errors — keep old graph state for this file
    }
  };

  watcher.on("add", reindex);
  watcher.on("change", reindex);
  watcher.on("unlink", (absPath) => {
    const rel = path.relative(absRoot, absPath).replace(/\\/g, "/");
    db.deleteFile(rel);
    mtimeCache.delete(rel);
    process.stderr.write(`memory-graph-mcp: removed ${rel}\n`);
  });

  return watcher;
}
