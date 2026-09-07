# memory_graph_mcp

MCP-сервер, строящий и поддерживающий **постоянный граф знаний проекта**: AST-зависимости кода, связи бизнес-логики ↔ схема БД, история дебаг-сессий, неявные сайд-эффекты.

При запросе фичи агент получает **подграф зависимостей**, а не список похожих файлов — защита от поломки смежных модулей.

## Tools (v0.1.0)

| Tool | Назначение |
|---|---|
| `graph_query_context` | файл/символ → подграф зависимостей + смежные модули + связанные сессии |
| `graph_impact_analysis` | планируемое изменение → затронутые узлы, таблицы и уровень риска |
| `graph_get_side_effects` | неявные эффекты модуля: чтение/запись таблиц, вызовы |
| `graph_record_session` | фиксация обсуждения/дебага с решениями и багами, привязка к файлам |
| `graph_stats` | состояние индекса: узлы, рёбра, файлы, время обновления |

## Установка

Требуется Node.js ≥ 18.

```bash
git clone git@github.com:FuryCow/memory_graph_mcp.git
cd memory_graph_mcp
npm install
npm run build
```

## Подключение

Сервер работает по stdio. Укажите в конфиге MCP-клиента рабочей директорией **корень индексируемого проекта** — индекс строится по `process.cwd()` и хранится в `.memory-graph/graph.db`.

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "memory-graph": {
      "command": "node",
      "args": ["C:\\path\\to\\memory_graph_mcp\\dist\\src\\index.js"],
      "cwd": "C:\\path\\to\\your\\project"
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

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

> На Windows путь к `index.js` экранируйте (`\\`) или используйте прямой слэш.

## Графовая модель

- **Узлы:** `File`, `Symbol`, `Table` (журнал: `Session`, `Decision`, `Bug`)
- **Рёбра:** `imports`, `calls`, `contains`, `reads_table`, `writes_table`

Индексер (tree-sitter) извлекает импорты, определения и вызовы функций, обращения к БД из SQL-строк (`SELECT/INSERT/UPDATE/DELETE`) и ORM-паттерны (Prisma, drizzle). Watcher (chokidar) инкрементально пересчитывает граф при изменении файлов (< 1 с).

## Стек

TypeScript / Node, `@modelcontextprotocol/sdk`, `tree-sitter`, `better-sqlite3`, `chokidar`.

## Разработка

```bash
npm run build   # tsc
npm test        # node --test dist/test/*.test.js
npm run lint    # tsc --noEmit
```

## Статус

- ✅ Этап 0: репозиторий инициализирован, пуш в origin
- ✅ Этап 1: скелет проекта, MCP-сервер отвечает на `tools/list`
- ✅ Этап 2: AST-индексер (tree-sitter), SQLite-персистентность
- ✅ Этап 3: инкрементальные обновления (chokidar watcher, mtime-кэш)
- ✅ Этап 4: retrieval — BFS-подграфы, impact analysis, сайд-эффекты, LLM-формат
- ✅ Этап 5: session journal — сессии/решения/баги, связанные сессии в query_context
- ✅ Этап 6: публикация — README, лицензия, тег v0.1.0

## Лицензия

MIT
