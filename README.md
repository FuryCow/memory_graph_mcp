# memory_graph_mcp

An MCP server that builds and maintains a **persistent project knowledge graph**: AST code dependencies, business-logic ↔ database-schema links, debugging-session history, and implicit side effects.

When a feature is requested, the agent receives a **dependency subgraph**, not a list of similar files — protecting adjacent modules from breaking changes.

## Tools (v0.1.0)

| Tool | Purpose |
|---|---|
| `graph_query_context` | file/symbol → dependency subgraph + adjacent modules + related sessions |
| `graph_impact_analysis` | planned change → affected nodes, tables, and risk level |
| `graph_get_side_effects` | implicit module effects: table reads/writes, calls |
| `graph_record_session` | record a discussion/debug session with decisions and bugs, linked to files |
| `graph_stats` | index state: nodes, edges, files, last update time |

## Installation

Requires Node.js ≥ 18.

```bash
git clone git@github.com:FuryCow/memory_graph_mcp.git
cd memory_graph_mcp
npm install
npm run build
```

## Connecting

The server communicates over stdio. Set the **root of the project you want to index** as the working directory in your MCP client config — the index is built from `process.cwd()` and stored in `.memory-graph/graph.db`.

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

> On Windows, escape paths (`C:\\path\\to\\...`) or use forward slashes (`C:/path/to/...`).

## Graph model

- **Nodes:** `File`, `Symbol`, `Table` (journal: `Session`, `Decision`, `Bug`)
- **Edges:** `imports`, `calls`, `contains`, `reads_table`, `writes_table`

The indexer (tree-sitter) extracts imports, function definitions and calls, and database access from SQL strings (`SELECT/INSERT/UPDATE/DELETE`) and ORM patterns (Prisma, drizzle). A watcher (chokidar) incrementally re-indexes the graph on file changes (< 1 s).

## Stack

TypeScript / Node, `@modelcontextprotocol/sdk`, `tree-sitter`, `better-sqlite3`, `chokidar`.

## Development

```bash
npm run build   # tsc
npm test        # node --test dist/test/*.test.js
npm run lint    # tsc --noEmit
```

## License

MIT
