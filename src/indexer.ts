/**
 * AST indexer (stage 2): parse TS/JS files with tree-sitter, extract
 * File/Symbol nodes and imports/calls edges, plus DB table access
 * from SQL string literals and common ORM call patterns.
 */
import Parser from "tree-sitter";
import type { Tree, SyntaxNode } from "tree-sitter";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { GraphDb, NodeRow } from "./db.js";

export interface IndexResult {
  files: number;
  symbols: number;
  imports: number;
  calls: number;
  tableRefs: number;
}

type LangName = "typescript" | "typescript_tsx" | "javascript";

let parser: Parser | null = null;
const languageCache = new Map<LangName, unknown>();

function getParser(): Parser {
  if (!parser) parser = new Parser();
  return parser;
}

function languageFor(file: string): unknown | null {
  const lang: LangName | null = file.endsWith(".tsx")
    ? "typescript_tsx"
    : file.endsWith(".ts")
      ? "typescript"
      : /\.(js|jsx|mjs|cjs)$/.test(file)
        ? "javascript"
        : null;
  if (!lang) return null;
  let langObj = languageCache.get(lang);
  if (!langObj) {
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("tree-sitter-typescript");
    const jsMod = nodeRequire("tree-sitter-javascript");
    langObj =
      lang === "javascript"
        ? jsMod.javascript
        : lang === "typescript"
          ? mod.typescript
          : mod.tsx;
    languageCache.set(lang, langObj);
  }
  return langObj;
}

interface Extracted {
  symbols: Array<{ name: string; start: number; end: number }>;
  imports: string[]; // raw module specifiers
  callNames: string[]; // function identifiers called
  tableReads: string[];
  tableWrites: string[];
}

function walk(node: SyntaxNode, out: Extracted, inFunctionDepth: number): void {
  switch (node.type) {
    case "import_statement": {
      const source = node.childForFieldName("source");
      if (source) out.imports.push(source.text.replace(/^['"]|['"]$/g, ""));
      return; // no need to descend
    }
    case "call_expression": {
      const fn = node.childForFieldName("function");
      if (fn) {
        out.callNames.push(fn.text);
        // SQL in call arguments: db.query(`SELECT ...`), execute("INSERT ...")
        collectSqlFromArgs(node, out);
      }
      break;
    }
    case "function_declaration":
    case "method_definition": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        out.symbols.push({ name: nameNode.text, start: node.startPosition.row + 1, end: node.endPosition.row + 1 });
      }
      break;
    }
    case "class_declaration": {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        out.symbols.push({ name: nameNode.text, start: node.startPosition.row + 1, end: node.endPosition.row + 1 });
      }
      break;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      // exported const fn = () => {} / const fn = function() {}
      for (const d of node.namedChildren) {
        if (d.type === "variable_declarator") {
          const nameNode = d.childForFieldName("name");
          const value = d.childForFieldName("value");
          if (nameNode && value && ["arrow_function", "function_expression"].includes(value.type)) {
            out.symbols.push({ name: nameNode.text, start: node.startPosition.row + 1, end: node.endPosition.row + 1 });
          }
        }
      }
      break;
    }
    default:
      break;
  }
  // template literals may hold SQL anywhere
  if (node.type === "template_string") collectSqlFromString(node.text, out);
  for (const child of node.namedChildren) walk(child, out, inFunctionDepth);
}

const SQL_KEYWORDS = /\b(select|insert\s+into|update|delete\s+from)\b/i;

function collectSqlFromArgs(call: SyntaxNode, out: Extracted): void {
  const args = call.childForFieldName("arguments");
  if (!args) return;
  for (const a of args.namedChildren) {
    if (a.type === "string" || a.type === "template_string") collectSqlFromString(a.text, out);
  }
}

function collectSqlFromString(text: string, out: Extracted): void {
  const body = text.replace(/^['"`]|['"`]$/g, "");
  if (!SQL_KEYWORDS.test(body)) return;
  // writes first, then blank them out so `delete from x` is not misread as a read
  const writes = [
    ...body.matchAll(/\binsert\s+into\s+([a-zA-Z_][\w.]*)/gi),
  ].map((m) => m[1]);
  for (const m of body.matchAll(/\bupdate\s+([a-zA-Z_][\w.]*)/gi)) writes.push(m[1]);
  for (const m of body.matchAll(/\bdelete\s+from\s+([a-zA-Z_][\w.]*)/gi)) writes.push(m[1]);
  const work = body.replace(/\b(?:insert\s+into|update|delete\s+from)\s+[a-zA-Z_][\w.]*/gi, " ");
  const reads = [...work.matchAll(/\bfrom\s+([a-zA-Z_][\w.]*)/gi)].map((m) => m[1]);
  out.tableReads.push(...reads.filter(validTableName));
  out.tableWrites.push(...writes.filter(validTableName));
}

/** Filter obvious SQL-heuristic false positives (qualified names, junk tokens). */
function validTableName(t: string): boolean {
  if (!/^[a-z_][a-z0-9_]*$/i.test(t)) return false; // reject dotted / odd tokens like "time."
  if (SQL_NOISE_WORDS.has(t.toLowerCase())) return false;
  return true;
}

const SQL_NOISE_WORDS = new Set([
  "the", "this", "where", "select", "insert", "update", "delete", "from", "set", "values",
  "dual", "your", "you", "table", "schema", "here", "query", "example",
]);

/** ORM patterns: prisma `prisma.user.findMany()`, drizzle `db.select().from(users)` */
const ORM_READ = /\b(?:prisma|db)\.([a-zA-Z_]\w*)\.(?:findMany|findFirst|findUnique|select|get)\b/g;
const ORM_WRITE = /\b(?:prisma|db)\.([a-zA-Z_]\w*)\.(?:create|update|delete|upsert|insert|set)\b/g;

function extractOrmTables(text: string, out: Extracted): void {
  for (const m of text.matchAll(ORM_READ)) if (validTableName(m[1])) out.tableReads.push(m[1]);
  for (const m of text.matchAll(ORM_WRITE)) if (validTableName(m[1])) out.tableWrites.push(m[1]);
}

function resolveImport(fromFile: string, spec: string, rootDir: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // external package
  // ESM-style "./b.js" usually means "./b.ts" in a TS project
  const stripped = spec.replace(/\.js$/, "");
  const hasExt = /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(stripped);
  const candidates = hasExt
    ? [stripped]
    : [stripped + ".ts", stripped + ".tsx", stripped + ".js", stripped + "/index.ts", stripped + "/index.js"];
  const resolved = candidates.map((c) => normalizePath(fromFile, c, rootDir));
  // Prefer a candidate that actually exists on disk; otherwise take the first (.ts)
  const existing = resolved.find((r) => r !== null && fs.existsSync(path.join(rootDir, r)));
  return existing ?? resolved[0] ?? null;
}

function normalizePath(fromFile: string, spec: string, rootDir: string): string | null {
  const posix = (p: string) => p.replace(/\\/g, "/");
  const dir = posix(fromFile).split("/").slice(0, -1);
  let parts: string[];
  if (spec.startsWith("/")) {
    parts = posix(rootDir).split("/").concat(spec.slice(1).split("/"));
  } else {
    parts = dir.concat(spec.split("/"));
  }
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

export function indexFile(db: GraphDb, rootDir: string, filePath: string, source: string): void {
  const lang = languageFor(filePath);
  if (!lang) return;
  const p = getParser();
  p.setLanguage(lang as never);
  const tree: Tree = p.parse(source);

  const extracted: Extracted = { symbols: [], imports: [], callNames: [], tableReads: [], tableWrites: [] };
  walk(tree.rootNode, extracted, 0);
  extractOrmTables(source, extracted);

  // Rewrite file node + descendants
  db.deleteFile(filePath);
  const fileNode: NodeRow = { kind: "file", name: filePath, path: filePath, start_line: 1, end_line: tree.rootNode.endPosition.row + 1 };
  const fileId = db.upsertNode(fileNode);

  for (const sym of extracted.symbols) {
    const symId = db.upsertNode({ kind: "symbol", name: sym.name, path: filePath, start_line: sym.start, end_line: sym.end });
    db.addEdge({ src: fileId, dst: symId, kind: "contains" }); // file → symbol containment
  }

  for (const spec of extracted.imports) {
    const target = resolveImport(filePath, spec, rootDir);
    if (target) {
      const targetId = db.upsertNode({ kind: "file", name: target, path: target, start_line: null, end_line: null });
      db.addEdge({ src: fileId, dst: targetId, kind: "imports" });
    }
  }

  // calls: only free functions (v0 heuristic); member-call chains like
  // `db.execute` / `prisma.user.findMany` are noise — filtered, refined in stage 4
  for (const name of new Set(extracted.callNames)) {
    if (name.includes(".")) continue;
    const symId = db.upsertNode({ kind: "symbol", name, path: filePath, start_line: null, end_line: null });
    db.addEdge({ src: fileId, dst: symId, kind: "calls" });
  }

  for (const t of new Set(extracted.tableReads)) {
    const tid = db.upsertNode({ kind: "table", name: t, path: null, start_line: null, end_line: null });
    db.addEdge({ src: fileId, dst: tid, kind: "reads_table" });
  }
  for (const t of new Set(extracted.tableWrites)) {
    const tid = db.upsertNode({ kind: "table", name: t, path: null, start_line: null, end_line: null });
    db.addEdge({ src: fileId, dst: tid, kind: "writes_table" });
  }
}
