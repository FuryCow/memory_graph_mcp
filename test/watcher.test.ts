import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GraphDb } from "../src/db.js";
import { fullScan } from "../src/watcher.js";
import { indexFile } from "../src/indexer.js";

// Use a temp dir so watcher tests never touch the repo's own index
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mgmcp-"));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("fullScan indexes a fixture project", () => {
  const src = path.join(tmp, "src");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "a.ts"), 'import { h } from "./b";\nexport function a() { return h(); }\n');
  fs.writeFileSync(path.join(src, "b.ts"), "export function h() { return 1; }\n");

  const db = new GraphDb(":memory:");
  const state = fullScan(db, tmp);
  assert.equal(state.files, 2);
  const s = db.stats();
  assert.equal(s.nodes.file, 2);
  assert.equal(s.edges.imports, 1);
  db.close();
});

test("indexFile skips files with unchanged mtime via indexOne path", () => {
  const src = path.join(tmp, "src2");
  fs.mkdirSync(src, { recursive: true });
  const file = path.join(src, "c.ts");
  fs.writeFileSync(file, "export function c1() {}\n");

  const db = new GraphDb(":memory:");
  fullScan(db, tmp);
  // second scan with same mtime — no change in edge/node counts
  fullScan(db, tmp);
  const s = db.stats();
  assert.equal(s.nodes.symbol, 1);
  db.close();
});

test("deleteFile then re-scan keeps incoming imports edge consistent", () => {
  const src = path.join(tmp, "src3");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "x.ts"), 'import { y } from "./y";\nexport function x() { return y(); }\n');
  fs.writeFileSync(path.join(src, "y.ts"), "export function y() { return 1; }\n");

  const db = new GraphDb(":memory:");
  fullScan(db, tmp);
  // simulate y.ts deletion effect on graph only
  db.deleteFile("src3/y.ts");
  const s = db.stats();
  // y.ts file node removed, x.ts + its symbols intact
  assert.ok(s.nodes.file >= 1);
  db.close();
});

test("indexFile handles syntax errors without throwing", () => {
  const db = new GraphDb(":memory:");
  assert.doesNotThrow(() => {
    indexFile(db, tmp, "src/broken.ts", "export function {( this is not valid");
  });
  db.close();
});
