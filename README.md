<div align="center">

# 🧠 memory_graph_mcp

**An MCP server that gives your AI agent a persistent knowledge graph of your project.**

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-stdio-8A2BE2)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-21%2F21-brightgreen)](#development)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)

*AST dependencies · DB-schema links · debugging sessions · side effects*

</div>

---

## 💡 Why

When a feature is requested, the agent receives a **dependency subgraph**, not a list of similar files — protecting adjacent modules from breaking changes.

```
graph_query_context("src/api/users.ts")

┌─────────────────┐     imports      ┌─────────────────┐
│  src/db/users.ts │ ◄────────────── │ src/api/users.ts │
└────────┬────────┘                  └─────────────────┘
         │ writes_table
         ▼
   [table: users]   ◄── also touched by 2 other files
```

Instead of *"here are 5 files matching `users`"* the agent learns: *changing this file affects two other modules, writes to the `users` table, and a past debug session recorded a missing `await` bug here.*

## 🛠 Tools

| Tool | Purpose |
|---|---|
| `graph_query_context` | file/symbol → dependency subgraph + adjacent modules + related sessions |
| `graph_impact_analysis` | planned change → affected nodes, tables, and risk level |
| `graph_get_side_effects` | implicit module effects: table reads/writes, calls |
| `graph_record_session` | record a discussion/debug session with decisions and bugs, linked to files |
| `graph_stats` | index state: nodes, edges, files, last update time |

## 📦 Installation

> Requires Node.js ≥ 18

```bash
git clone git@github.com:FuryCow/memory_graph_mcp.git
cd memory_graph_mcp
npm install
npm run build
```

## 🔌 Connecting

The server communicates over stdio. Set the **root of the project you want to index** as the working directory (`cwd`) in your MCP client config — the index is built from `process.cwd()` and stored in `.memory-graph/graph.db`.

### Claude Desktop / Cursor

The configuration is identical for both clients; only the config file location differs:

- **Claude Desktop:** `claude_desktop_config.json` (menu → Settings → Developer → Edit Config)
- **Cursor:** `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "memory-graph": {
      "command": "node",
      "args": ["/absolute/path/to/memory_graph_mcp/dist/src/index.js"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

> 💡 On Windows, escape paths (`C:\\path\\to\\...`) or use forward slashes (`C:/path/to/...`).

## 🗺 Graph model

| | |
|---|---|
| **Nodes** | `File`, `Symbol`, `Table` — journal: `Session`, `Decision`, `Bug` |
| **Edges** | `imports`, `calls`, `contains`, `reads_table`, `writes_table` |

The indexer ([tree-sitter](https://tree-sitter.github.io/)) extracts imports, function definitions and calls, and database access from SQL strings (`SELECT/INSERT/UPDATE/DELETE`) and ORM patterns (Prisma, drizzle). A watcher ([chokidar](https://github.com/paulmillr/chokidar)) incrementally re-indexes the graph on file changes — typically **under a second**.

## 🧰 Stack

| Layer | Technology |
|---|---|
| Server | `@modelcontextprotocol/sdk` (stdio) |
| Parsing | `tree-sitter` (TypeScript / TSX / JavaScript) |
| Storage | `better-sqlite3` (WAL) in `.memory-graph/graph.db` |
| Watching | `chokidar` (mtime-based incremental re-index) |

## 🚀 Development

```bash
npm run build   # tsc
npm test        # node --test dist/test/*.test.js
npm run lint    # tsc --noEmit
```

## 📄 License

[MIT](LICENSE)
