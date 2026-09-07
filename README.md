# memory_graph_mcp

MCP-сервер, строящий и поддерживающий постоянный граф знаний проекта: AST-зависимости кода, связи бизнес-логики ↔ схема БД, история дебаг-сессий, неявные сайд-эффекты.

## Tools (v0)

- `graph.query_context` — файл/символ → подграф зависимостей + смежные модули
- `graph.impact_analysis` — планируемое изменение → затронутые узлы и риски
- `graph.get_side_effects` — неявные эффекты модуля
- `graph.record_session` — фиксация обсуждения/дебага
- `graph.stats` — состояние индекса

## Стек

TypeScript / Node, `@modelcontextprotocol/sdk`, `tree-sitter`, `better-sqlite3`, `chokidar`.

## Статус

- ✅ Этап 0: репозиторий инициализирован, пуш в origin
- ✅ Этап 1: скелет проекта, MCP-сервер отвечает на `tools/list`
- ✅ Этап 2: AST-индексер (tree-sitter) — File/Symbol/Table узлы, imports/calls/reads_table/writes_table рёбра, SQL-строки + Prisma/drizzle-паттерны, SQLite-персистентность
- 🚧 Этап 3: инкрементальные обновления (watcher)
