/**
 * Project walker: enumerate source files under a root, respecting .gitignore-ish
 * exclusions. Python support arrives with tree-sitter-python later in stage 2/3.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".memory-graph",
  "coverage",
  ".next",
  ".venv",
  "venv",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export function listSourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  const rootPosix = rootDir.replace(/\\/g, "/");
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!DEFAULT_EXCLUDES.has(e.name) && !e.name.startsWith(".")) visit(full);
      } else if (e.isFile() && SOURCE_EXTENSIONS.has(path.extname(e.name))) {
        out.push(full.replace(/\\/g, "/").slice(rootPosix.length + 1));
      }
    }
  };
  visit(rootDir);
  return out;
}
