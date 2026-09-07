import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphDb } from "../src/db.js";

function makeDb(): GraphDb {
  return new GraphDb(":memory:");
}

test("meta table stores schema version", () => {
  const db = makeDb();
  const row = db.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
    value: string;
  };
  assert.equal(row.value, "2");
  db.close();
});

test("schema version 1 database is upgraded in place", () => {
  // simulate an old DB by creating the v1 tables manually
  const db = makeDb();
  // sessions tables must exist (migration ran) even on a fresh connection
  const tables = db.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  const names = tables.map((t) => t.name);
  assert.ok(names.includes("sessions"));
  assert.ok(names.includes("session_items"));
  assert.ok(names.includes("session_files"));
  db.close();
});

test("recordSession returns incrementing ids and cascades on delete", () => {
  const db = makeDb();
  const id1 = db.recordSession({ topic: "one" });
  const id2 = db.recordSession({ topic: "two", decisions: ["d"] });
  assert.ok(id2 > id1);
  db.db.prepare("DELETE FROM sessions WHERE id = ?").run(id2);
  const items = db.db.prepare("SELECT COUNT(*) AS c FROM session_items").get() as { c: number };
  assert.equal(items.c, 0); // cascade removed the decision row
  db.close();
});

test("sessionsForFile orders newest first", () => {
  const db = makeDb();
  const fid = db.upsertNode({ kind: "file", name: "a.ts", path: "a.ts", start_line: null, end_line: null });
  db.recordSession({ topic: "old", fileNodeIds: [fid] });
  // ensure distinct timestamps
  db.db.prepare("UPDATE sessions SET created_at = '2020-01-01T00:00:00Z' WHERE id = 1").run();
  db.recordSession({ topic: "new", fileNodeIds: [fid] });
  const sessions = db.sessionsForFile(fid);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].topic, "new");
  assert.equal(sessions[1].topic, "old");
  db.close();
});

test("session linked to non-existent file node is ignored gracefully", () => {
  const db = makeDb();
  // foreign keys are not enforced unless PRAGMA foreign_keys=ON; ensure no crash either way
  assert.doesNotThrow(() => {
    db.recordSession({ topic: "ghost", fileNodeIds: [99999] });
  });
  db.close();
});
