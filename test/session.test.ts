import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphDb } from "../src/db.js";

test("recordSession stores session with decisions and bugs", () => {
  const db = new GraphDb(":memory:");
  const fid = db.upsertNode({ kind: "file", name: "src/a.ts", path: "src/a.ts", start_line: 1, end_line: 10 });
  const id = db.recordSession({
    topic: "Investigate N+1 in user loader",
    decisions: ["Use batched query"],
    bugs: ["Missing await on prisma call"],
    fileNodeIds: [fid],
  });
  const sessions = db.sessionsForFile(fid);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].topic, "Investigate N+1 in user loader");
  assert.deepEqual(sessions[0].decisions, ["Use batched query"]);
  assert.deepEqual(sessions[0].bugs, ["Missing await on prisma call"]);
  db.close();
});

test("sessionsForFile returns sessions only for the linked file", () => {
  const db = new GraphDb(":memory:");
  const fa = db.upsertNode({ kind: "file", name: "src/a.ts", path: "src/a.ts", start_line: null, end_line: null });
  const fb = db.upsertNode({ kind: "file", name: "src/b.ts", path: "src/b.ts", start_line: null, end_line: null });
  db.recordSession({ topic: "A session", fileNodeIds: [fa] });
  db.recordSession({ topic: "B session", fileNodeIds: [fb] });
  assert.equal(db.sessionsForFile(fa).length, 1);
  assert.equal(db.sessionsForFile(fa)[0].topic, "A session");
  assert.equal(db.sessionsForFile(fb)[0].topic, "B session");
  db.close();
});

test("session without file links is recorded and unlinked paths are tolerated", () => {
  const db = new GraphDb(":memory:");
  const id = db.recordSession({ topic: "Standalone", decisions: ["D1"] });
  assert.ok(id > 0);
  const any = db.db.prepare("SELECT COUNT(*) AS c FROM sessions").get() as { c: number };
  assert.equal(any.c, 1);
  db.close();
});

test("duplicate file links are deduplicated", () => {
  const db = new GraphDb(":memory:");
  const fid = db.upsertNode({ kind: "file", name: "src/a.ts", path: "src/a.ts", start_line: null, end_line: null });
  db.recordSession({ topic: "dup", fileNodeIds: [fid, fid] });
  const count = db.db
    .prepare("SELECT COUNT(*) AS c FROM session_files WHERE session_id = ?")
    .get(1) as { c: number };
  assert.equal(count.c, 1);
  db.close();
});
