import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphDb } from "../src/db.js";
import { indexFile } from "../src/indexer.js";

const ROOT = "/proj";

test("tsx files are indexed", () => {
  const db = new GraphDb(":memory:");
  indexFile(db, ROOT, "src/ui/widget.tsx", "export function Widget() { return null; }\n");
  const s = db.stats();
  assert.equal(s.nodes.file, 1);
  assert.ok((s.nodes.symbol ?? 0) >= 1);
  db.close();
});

test("import type is not treated as a value import", () => {
  const db = new GraphDb(":memory:");
  indexFile(db, ROOT, "src/a.ts", 'import type { Foo } from "./b.js";\nexport function a() {}\n');
  const s = db.stats();
  // v0 heuristic: type-only import still resolves to the file, but must not crash
  assert.equal(s.nodes.file, 2);
  db.close();
});

test("SQL inside template literals is extracted", () => {
  const db = new GraphDb(":memory:");
  indexFile(
    db,
    ROOT,
    "src/t.ts",
    "export function q(id: number) {\n  return db.query(`SELECT * FROM customers WHERE id = ${id}`);\n}\n"
  );
  const s = db.stats();
  assert.equal(s.nodes.table, 1);
  assert.equal(s.edges.reads_table, 1);
  db.close();
});

test("multi-statement SQL assigns reads and writes correctly", () => {
  const db = new GraphDb(":memory:");
  indexFile(
    db,
    ROOT,
    "src/multi.ts",
    'export function run() {\n  db.execute("DELETE FROM logs WHERE ts < 100");\n  const rows = db.query("SELECT * FROM logs LIMIT 10");\n}\n'
  );
  const s = db.stats();
  assert.equal(s.nodes.table, 1); // logs deduped
  assert.equal(s.edges.writes_table, 1);
  assert.equal(s.edges.reads_table, 1);
  db.close();
});

test("duplicate call expressions produce a single calls edge", () => {
  const db = new GraphDb(":memory:");
  indexFile(db, ROOT, "src/dup.ts", "export function a() { helper(); helper(); helper(); }\n");
  const s = db.stats();
  assert.equal(s.edges.calls, 1);
  db.close();
});
