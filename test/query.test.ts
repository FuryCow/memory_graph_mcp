import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphDb } from "../src/db.js";
import { indexFile } from "../src/indexer.js";
import { GraphQuery, formatSubgraph } from "../src/query.js";

const ROOT = "/proj";

function makeDb(): { db: GraphDb; q: GraphQuery } {
  const db = new GraphDb(":memory:");
  const q = new GraphQuery(db);
  return { db, q };
}

test("subgraph follows imports across folders", () => {
  const { db, q } = makeDb();
  indexFile(db, ROOT, "src/services/order.ts", 'import { getUser } from "../users/repo.js";\nexport function placeOrder() { return getUser(); }\n');
  indexFile(db, ROOT, "src/users/repo.ts", 'import { log } from "../util/log.js";\nexport function getUser() { log("q"); return 1; }\n');
  indexFile(db, ROOT, "src/util/log.ts", "export function log(m: string) {}\n");

  const seed = q.findFile("src/services/order.ts");
  assert.ok(seed);
  const g = q.subgraph(seed!.id, 3);
  const paths = g.nodes.filter((n) => n.kind === "file").map((n) => n.path);
  assert.ok(paths.includes("src/users/repo.ts"), "repo.ts must be in subgraph");
  assert.ok(paths.includes("src/util/log.ts"), "log.ts (2 hops away) must be in subgraph");
  db.close();
});

test("impact analysis finds reverse dependencies from another folder", () => {
  const { db, q } = makeDb();
  indexFile(db, ROOT, "src/core/config.ts", "export function cfg() { return 1; }\n");
  indexFile(db, ROOT, "src/api/handler.ts", 'import { cfg } from "../core/config.js";\nexport function handler() { return cfg(); }\n');
  indexFile(db, ROOT, "src/api/routes.ts", 'import { handler } from "./handler.js";\nexport function routes() { return handler(); }\n');

  const { affected, tables } = q.impact("src/core/config.ts");
  const paths = affected.filter((n) => n.kind === "file").map((n) => n.path);
  assert.ok(paths.includes("src/api/handler.ts"), "direct dependent must be affected");
  assert.ok(paths.includes("src/api/routes.ts"), "transitive dependent must be affected");
  assert.equal(tables.length, 0);
  db.close();
});

test("impact includes tables touched by the file", () => {
  const { db, q } = makeDb();
  indexFile(db, ROOT, "src/db/orders.ts", 'export function save() { db.execute("INSERT INTO orders VALUES (1)"); }\n');
  const { tables } = q.impact("src/db/orders.ts");
  assert.ok(tables.map((t) => t.name).includes("orders"));
  db.close();
});

test("side effects lists reads, writes and calls", () => {
  const { db, q } = makeDb();
  indexFile(
    db,
    ROOT,
    "src/svc/mixed.ts",
    [
      'import { helper } from "../lib/helper.js";',
      'export function run() { db.query("SELECT * FROM users"); helper(); }',
      'export function save() { db.execute("UPDATE users SET a=1"); }',
    ].join("\n")
  );
  const fx = q.sideEffects("src/svc/mixed.ts");
  assert.deepEqual(fx.reads_tables, ["users"]);
  assert.deepEqual(fx.writes_tables, ["users"]);
  assert.ok(fx.calls.includes("helper"));
  db.close();
});

test("findFileBySuffix resolves partial paths", () => {
  const { db, q } = makeDb();
  indexFile(db, ROOT, "src/deep/nested/thing.ts", "export function t() {}\n");
  const n = q.findFileBySuffix("nested/thing.ts");
  assert.ok(n);
  assert.equal(n!.path, "src/deep/nested/thing.ts");
  db.close();
});

test("formatSubgraph produces compact text", () => {
  const { db, q } = makeDb();
  indexFile(db, ROOT, "a.ts", 'import { b } from "./b.js";\nexport function a() { return b(); }\n');
  indexFile(db, ROOT, "b.ts", "export function b() { return 1; }\n");
  const seed = q.findFile("a.ts")!;
  const out = formatSubgraph(q.subgraph(seed.id, 2));
  assert.ok(out.includes("[file] a.ts"));
  assert.ok(out.includes("--imports-->"));
  db.close();
});

test("missing file returns null seed / empty impact", () => {
  const { db, q } = makeDb();
  assert.equal(q.findFile("nope.ts"), null);
  const { affected } = q.impact("nope.ts");
  assert.equal(affected.length, 0);
  db.close();
});
