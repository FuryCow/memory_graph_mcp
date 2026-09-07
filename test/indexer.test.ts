import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphDb } from "../src/db.js";
import { indexFile } from "../src/indexer.js";

const ROOT = "/proj";

function index(db: GraphDb, rel: string, source: string): void {
  indexFile(db, ROOT, rel, source);
}

test("extracts imports edge between files", () => {
  const db = new GraphDb(":memory:");
  index(db, "src/a.ts", 'import { helper } from "./b";\nexport function a() { return helper(); }\n');
  index(db, "src/b.ts", "export function helper() { return 1; }\n");
  const s = db.stats();
  assert.equal(s.nodes.file, 2);
  assert.equal(s.edges.imports, 1);
  db.close();
});

test("extracts symbols with line ranges", () => {
  const db = new GraphDb(":memory:");
  index(db, "src/c.ts", "export function foo() {}\nexport class Bar {}\nconst baz = () => {};\n");
  const s = db.stats();
  assert.equal(s.nodes.symbol, 3);
  db.close();
});

test("extracts SQL reads and writes from string literals", () => {
  const db = new GraphDb(":memory:");
  index(
    db,
    "src/d.ts",
    [
      'const rows = db.query("SELECT * FROM users WHERE id = ?", [id]);',
      'db.execute("INSERT INTO orders (id) VALUES (?)", [1]);',
      'db.execute("UPDATE users SET name = ? WHERE id = ?", [n, id]);',
      'db.execute("DELETE FROM sessions WHERE id = ?", [id]);',
    ].join("\n")
  );
  const s = db.stats();
  assert.equal(s.nodes.table, 3); // users, orders, sessions
  assert.equal(s.edges.reads_table, 1);
  assert.equal(s.edges.writes_table, 3);
  db.close();
});

test("extracts prisma ORM table access", () => {
  const db = new GraphDb(":memory:");
  index(
    db,
    "src/e.ts",
    [
      "const users = await prisma.user.findMany();",
      "await prisma.user.create({ data });",
      "await db.orders.update({ where });",
    ].join("\n")
  );
  const s = db.stats();
  assert.equal(s.nodes.table, 2); // user, orders
  assert.equal(s.edges.reads_table, 1);
  assert.equal(s.edges.writes_table, 2);
  db.close();
});

test("re-indexing a file replaces its nodes and edges", () => {
  const db = new GraphDb(":memory:");
  index(db, "src/f.ts", 'import { x } from "./g";\nexport function f() {}\n');
  index(db, "src/f.ts", 'import { y } from "./h";\nexport function f2() {}\n');
  const s = db.stats();
  assert.equal(s.nodes.file, 3); // f.ts + g.ts + h.ts
  assert.equal(s.edges.imports, 1);
  db.close();
});

test("external package imports are not resolved to files", () => {
  const db = new GraphDb(":memory:");
  index(db, "src/i.ts", 'import fs from "node:fs";\nimport { z } from "zod";\nexport function i() {}\n');
  const s = db.stats();
  assert.equal(s.nodes.file, 1);
  assert.equal(s.edges.imports, 0);
  db.close();
});
