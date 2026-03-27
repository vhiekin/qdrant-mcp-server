# Design: Code Dependency Graph

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MCP Server (index.ts)                           │
│                                                                         │
│  Existing:                          New:                                │
│  ┌──────────────┐                   ┌────────────────┐                 │
│  │ CodeIndexer   │──── calls ────→  │ GraphIndexer    │                │
│  │ (indexer.ts)  │                   │ (graph/         │                │
│  │               │                   │  indexer.ts)    │                │
│  └──────┬───────┘                   └──────┬─────────┘                 │
│         │                                   │                           │
│         │ chunks                             │ nodes + edges            │
│         ▼                                   ▼                           │
│  ┌──────────────┐                   ┌────────────────┐                 │
│  │ Qdrant       │                   │ SQLite DB       │                │
│  │ (vectors)    │                   │ (graph)         │                │
│  │ localhost:6333│                   │ ~/.qdrant-mcp/  │                │
│  └──────────────┘                   │  graph/*.db     │                │
│                                     └────────────────┘                 │
│  Existing:                          New:                                │
│  ┌──────────────┐                   ┌────────────────┐                 │
│  │ Code Tools   │                   │ Graph Tools     │                │
│  │ (tools/      │                   │ (tools/         │                │
│  │  code.ts)    │                   │  graph.ts)      │                │
│  └──────────────┘                   └────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. AST Relationship Extractor (`src/graph/extractor.ts`)

**Validates**: REQ-001

Extracts relationships from tree-sitter ASTs. Reuses the same tree-sitter parsers already initialized by `TreeSitterChunker`. Operates as a second pass on already-parsed ASTs.

```
                    ┌──────────────────────────────┐
                    │     RelationshipExtractor     │
                    ├──────────────────────────────┤
                    │ extract(tree, code,           │
                    │         filePath, language)    │
                    │   → { nodes[], edges[] }      │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
   ┌─────────────────┐ ┌──────────────┐ ┌───────────────┐
   │ extractImports() │ │ extractCalls()│ │ extractTypes() │
   │                  │ │              │ │               │
   │ import/require   │ │ func calls   │ │ extends       │
   │ from/import      │ │ method calls │ │ implements    │
   │ Go imports       │ │              │ │ type refs     │
   └─────────────────┘ └──────────────┘ └───────────────┘
```

**Language-specific extraction strategies:**

| Language | Imports | Calls | Types |
|----------|---------|-------|-------|
| **TypeScript/JS** | `import_statement` → module specifier | `call_expression` → function name + receiver | `extends_clause`, `implements_clause`, type annotations |
| **Go** | `import_declaration` → package path | `call_expression` → `pkg.Func()` or `receiver.Method()` | `type_spec` with `interface_type` or struct embedding |
| **Python** | `import_statement`, `import_from_statement` | `call` → function name + attribute access | `argument_list` in class definition (bases) |
| **Rust** | `use_declaration` | `call_expression`, `macro_invocation` | `impl_item` with trait, `type_item` |
| **Java** | `import_declaration` | `method_invocation` | `superclass`, `super_interfaces` |
| **Bash** | `command` (source/.), function refs | `command_name` nodes | N/A |

**Node extraction** — from each chunkable AST node, extract:
- `id`: deterministic hash of `filePath:name:type:startLine`
- `file_path`: relative path from codebase root
- `name`: function/class/interface/type name
- `node_type`: function | class | interface | type | method
- `language`: from file extension
- `start_line`, `end_line`: source location

**Edge extraction** — from AST traversal within and around each node:
- `source_id` → `target_id` (may be unresolved if target is in another file)
- `relationship`: calls | imports | extends | implements | uses_type
- `line_number`: where the reference occurs in source
- Cross-file resolution: edges initially store target as `(name, possible_file)` — resolved to actual node IDs during a post-processing pass after all files are extracted

### 2. Graph Storage Manager (`src/graph/storage.ts`)

**Validates**: REQ-002

Manages the SQLite database via `better-sqlite3` (synchronous API — fast, no async overhead for small queries).

**Database schema:**

```sql
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,   -- SHA256 hash
  file_path   TEXT NOT NULL,      -- relative to codebase root
  name        TEXT NOT NULL,      -- function/class/type name
  node_type   TEXT NOT NULL,      -- function|class|interface|type|method
  language    TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL
);

CREATE TABLE edges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id       TEXT NOT NULL,
  target_id       TEXT NOT NULL,     -- resolved node ID (or unresolved marker)
  relationship    TEXT NOT NULL,      -- calls|imports|extends|implements|uses_type
  source_file     TEXT NOT NULL,
  target_file     TEXT,              -- NULL if unresolved (external dep)
  line_number     INTEGER,
  FOREIGN KEY (source_id) REFERENCES nodes(id)
  -- No FK on target_id: allows unresolved external refs
);

-- Indexes for query performance
CREATE INDEX idx_nodes_file ON nodes(file_path);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_type ON nodes(node_type);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_source_file ON edges(source_file);
CREATE INDEX idx_edges_target_file ON edges(target_file);
CREATE INDEX idx_edges_relationship ON edges(relationship);
```

**Storage location**: `~/.qdrant-mcp/graph/{collectionName}.db`

- One SQLite file per indexed codebase (matches Qdrant collection naming)
- Auto-created on first index, deleted on `clear_index`

**API:**

```typescript
class GraphStorage {
  constructor(collectionName: string)

  // Lifecycle
  open(): void                          // Create/open DB, run migrations
  close(): void                         // Close DB connection
  destroy(): void                       // Delete DB file

  // Write (within transactions for performance)
  insertNodes(nodes: GraphNode[]): void
  insertEdges(edges: GraphEdge[]): void
  deleteByFiles(filePaths: string[]): void  // Delete nodes+edges for files

  // Read — single-hop
  getCallers(name: string, filePath?: string): GraphNode[]
  getCallees(name: string, filePath?: string): GraphNode[]

  // Read — multi-hop (recursive CTEs)
  traceCallChain(name: string, filePath?: string, maxDepth?: number): CallChain
  getImpactRadius(name: string, filePath?: string, maxDepth?: number): ImpactResult

  // Read — aggregate
  getDependencyClusters(): Cluster[]
  getSharedInterfaces(filesA: string[], filesB: string[]): SharedNode[]
  getStats(): GraphStats
}
```

**Multi-hop traversal strategy:**

Recursive CTEs with string-based cycle detection (`path NOT LIKE '%' || id || '%'`) degrade to O(n^2) on deep/wide graphs. Instead, use a **hybrid approach**:

- **SQLite CTE** handles depth-limited traversal (no cycle detection in SQL)
- **Application-side Set** tracks visited node IDs to prevent cycles and enforce depth limit

```typescript
function traceCallChain(startName: string, filePath?: string, maxDepth = 10): CallChain {
  const visited = new Set<string>();
  const chain: ChainNode[] = [];

  // Get starting node(s)
  const startNodes = db.prepare(
    'SELECT * FROM nodes WHERE name = ? AND (file_path = ? OR ? IS NULL)'
  ).all(startName, filePath, filePath);

  function traverse(nodeId: string, depth: number) {
    if (depth > maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const callees = db.prepare(
      'SELECT e.*, n.* FROM edges e JOIN nodes n ON n.id = e.target_id WHERE e.source_id = ? AND e.relationship = ?'
    ).all(nodeId, 'calls');

    for (const callee of callees) {
      chain.push({ ...callee, depth });
      traverse(callee.target_id, depth + 1);
    }
  }
  // ... start traversal from each startNode
}
```

**Impact analysis (reverse direction):**

Same traversal but follows **incoming** edges (`e.target_id = c.node_id`) to find all dependents. Uses the same Set-based cycle prevention.

### 3. Graph Indexer (`src/graph/indexer.ts`)

**Validates**: REQ-008

Orchestrates the graph extraction pipeline. Called by `CodeIndexer` during indexing.

```
CodeIndexer.indexCodebase()
  │
  ├── [existing] scan → chunk → embed → store in Qdrant
  │
  └── [new] if CODE_ENABLE_GRAPH:
        │
        ├── GraphIndexer.indexFiles(files, codebasePath, collectionName)
        │     │
        │     ├── Open/create SQLite DB
        │     ├── For each file:
        │     │     ├── Parse with tree-sitter (reuse parser instances)
        │     │     ├── RelationshipExtractor.extract(tree, code, file, lang)
        │     │     │   → { nodes[], edges[] }
        │     │     └── Accumulate nodes + edges
        │     │
        │     ├── Resolve cross-file edges (match target names to node IDs)
        │     ├── Batch INSERT nodes + edges in transaction
        │     └── Close DB
        │
        └── Return GraphStats alongside IndexStats
```

**Integration points with existing CodeIndexer:**

1. `indexCodebase()` — after chunking loop (step 3), call `graphIndexer.indexFiles()` with the same file list. **Wrapped in try/catch** — graph failure is non-fatal (adds error to stats, sets status to "partial"). Qdrant indexing is already complete at this point.
2. `reindexChanges()` — after detecting changes, call `graphIndexer.updateFiles(added, modified, deleted)`. Same non-fatal error handling.
3. `clearIndex()` — call `graphIndexer.clearGraph(collectionName)`. Failure logged but doesn't prevent Qdrant deletion.
4. `getIndexStatus()` — include `graphIndexer.getStats(collectionName)` in response. If graph DB is missing/empty while Qdrant has data, report `graph.status: "stale"`.

**Cross-file resolution strategy:**

After all files are processed, unresolved edge targets (name-only) are matched against the full node table:
1. Exact match on `name` — if unique, resolve
2. If ambiguous (multiple nodes with same name), use file proximity heuristic:
   - Same directory → highest priority
   - Same parent directory → medium priority
   - Same package/module (for Go: same import path) → low priority
3. If still ambiguous → leave as unresolved (store target_name in target_id with `unresolved:` prefix)

### 4. Dependency Cluster Analysis (`src/graph/clusters.ts`)

**Validates**: REQ-005

Identifies cohesive modules using a simple connected-components algorithm on the file-level dependency graph:

1. Build an undirected file-adjacency graph: edge between file A and file B if any node in A references any node in B
2. Find connected components (BFS/DFS)
3. For each component, count internal edges (within) vs external edges (crossing)
4. Sort by component size (file count), largest first

This is intentionally simple — not Louvain or spectral clustering. The goal is sprint boundary identification, not academic community detection.

**Scale guard**: The file-adjacency graph is built from a SQL query (`SELECT DISTINCT source_file, target_file FROM edges`), not by loading all edges into memory. At 100K nodes, the distinct file pairs are typically <10K entries — well within memory. If >50K file pairs, the tool returns an error suggesting the codebase be indexed at a more granular level.

### 5. MCP Graph Tools (`src/tools/graph.ts`)

**Validates**: REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-011

New tool registration module following the existing pattern in `tools/code.ts`.

| Tool | Input | Output | SQL Strategy |
|------|-------|--------|-------------|
| `trace_call_chain` | `{path, name, filePath?, maxDepth?}` | Ordered chain with depth annotations | App-side traversal (outgoing) |
| `impact_analysis` | `{path, name, filePath?, maxDepth?}` | Grouped dependents by file | App-side traversal (incoming) |
| `dependency_clusters` | `{path}` | Cluster list with internal/external edge counts | Connected components on file graph |
| `get_callers` | `{path, name, filePath?}` | Direct callers (1 hop) | Simple JOIN |
| `get_callees` | `{path, name, filePath?}` | Direct callees (1 hop) | Simple JOIN |
| `shared_interfaces` | `{path, filesA, filesB}` | Nodes referenced by both sets | Two-way JOIN on edges |

#### Agent-Oriented Tool Descriptions (REQ-011)

MCP tool descriptions are the primary mechanism by which agents discover when to use a tool. Each description must encode a **trigger condition**, **output shape**, and **workflow context**. Written from the agent's perspective:

```typescript
// trace_call_chain
description: "Use BEFORE modifying a function to understand what it depends on. "
  + "Traces the full call path from a function down to its leaf dependencies. "
  + "Returns an indented tree showing each function called, its file location, and depth. "
  + "Essential for assessing whether a change will have downstream side effects."

// impact_analysis
description: "Use BEFORE planning changes to understand the blast radius. "
  + "Given a function, class, or interface, returns ALL code that would be affected by changing it — "
  + "direct callers, transitive dependents, and type consumers, grouped by file. "
  + "Critical for sprint decomposition: if the blast radius spans multiple modules, the change needs careful sequencing."

// dependency_clusters
description: "Use during sprint decomposition to find natural module boundaries in the codebase. "
  + "Returns groups of tightly-coupled files (files that reference each other frequently) "
  + "with internal vs external edge counts. High internal / low external = good sprint boundary. "
  + "Call this BEFORE splitting work into parallel sprints to avoid cross-sprint coupling."

// get_callers
description: "Quick lookup: find all functions that directly call a given function (1 hop). "
  + "Use for targeted investigation when you need to know 'who calls this?' without a full impact analysis. "
  + "Provide filePath to disambiguate if multiple functions share the same name."

// get_callees
description: "Quick lookup: find all functions that a given function directly calls (1 hop). "
  + "Use to understand a function's immediate dependencies before modifying it. "
  + "Provide filePath to disambiguate if multiple functions share the same name."

// shared_interfaces
description: "Use during sprint decomposition to detect coupling between two sets of files. "
  + "Given two file lists (e.g., proposed Sprint A files and Sprint B files), returns all "
  + "functions, types, and interfaces that BOTH sets depend on. Shared interfaces are a signal "
  + "that the sprints need to be sequenced (not parallelized) or that the shared code needs "
  + "its own sprint. Critical for avoiding cross-sprint conflicts."
```

**Design principle**: Descriptions use the agent's vocabulary ("sprint decomposition", "blast radius", "cross-sprint coupling") rather than database terminology ("queries the graph", "returns adjacency list"). This makes tool selection intuitive for agents already familiar with the sprint workflow.

**Tool output format** (consistent with existing tools):

```typescript
// All graph tools return MCP text content
return {
  content: [{
    type: "text",
    text: formattedResult  // Human-readable, structured text
  }]
};
```

**Example `trace_call_chain` output:**

```
Call chain from handleCreate (src/handlers/create.ts:15-42):

  handleCreate (src/handlers/create.ts:15)
    → validateInput (src/validation/input.ts:8)
    → db.Insert (src/database/queries.ts:45)
      → buildQuery (src/database/builder.ts:12)
    → sendNotification (src/notifications/email.ts:22)

Depth: 3, Nodes: 5, Edges: 4
```

### 6. Configuration Extension (`src/graph/config.ts`)

**Validates**: REQ-009

New environment variables parsed in `index.ts`:

```typescript
const graphConfig: GraphConfig = {
  enabled: process.env.CODE_ENABLE_GRAPH !== "false",  // default: true
  maxDepth: parseInt(process.env.CODE_GRAPH_MAX_DEPTH || "10", 10),
};
```

Passed to `GraphIndexer` constructor. When `enabled: false`:
- Graph extraction is skipped during indexing
- Graph tools return `{ content: [{ type: "text", text: "Graph analysis is disabled. Set CODE_ENABLE_GRAPH=true to enable." }] }`
- No SQLite DB is created

### 7. Enhanced Index Status (`src/code/indexer.ts` modification)

**Validates**: REQ-010

Extend `getIndexStatus()` response to include graph stats when available:

```typescript
// Existing fields...
interface IndexStatus {
  isIndexed: boolean;
  status: IndexingStatus;
  // ...existing fields...

  // New graph fields
  graph?: {
    enabled: boolean;
    totalNodes: number;
    totalEdges: number;
    edgesByType: Record<string, number>;
  };
}
```

### 8. Coordinator Workflow Integration (Template & Skill Updates)

**Validates**: REQ-012

These are changes to files **outside** the qdrant-mcp-server repo — they live in `claude-workspace-config` and the projects' `CLAUDE.md`. They ensure agents actually use the graph tools at the right moments.

#### 8a. `/develop-feature` Phase 3 Update (REQ-012a)

In the `/develop-feature` skill (`~/.claude/skills/develop-feature/SKILL.md`), add to the Phase 3 "Sprint Decomposition" section:

```markdown
### Graph-Assisted Decomposition (when graph index is available)

Before assigning tasks to sprints, run these graph queries to inform the decomposition:

1. **Find module boundaries**: Call `dependency_clusters` on the codebase path.
   Clusters with high internal / low external edge counts are natural sprint boundaries.

2. **Check for shared interfaces**: For each pair of proposed sprints, call
   `shared_interfaces` with their respective file lists. If shared nodes exist,
   either: (a) sequence the sprints (dependent wave), or (b) extract shared
   code into its own Wave 1 sprint.

3. **Assess blast radius**: For the core entity being changed, call `impact_analysis`
   to see full transitive dependents. If the blast radius spans multiple proposed
   sprints, reconsider the decomposition.
```

#### 8b. Sprint Prompt Template Code Review Update (REQ-012b)

In the sprint prompt template (`~/.claude/templates/sprint-prompt-template.md`), add to the Code Review Checklist:

```markdown
- [ ] Cross-sprint impact: Run `impact_analysis` on each modified function/type.
      Verify no dependents exist in other active sprints' file sets.
```

#### 8c. CLAUDE.md Semantic Search Section Update (REQ-012c)

In `~/projects/CLAUDE.md`, extend the "Semantic Code Search (MANDATORY)" section:

```markdown
### Graph Analysis Tools (when available)

After semantic search, use graph tools for structural questions:
- `trace_call_chain` — understand downstream dependencies before modifying code
- `impact_analysis` — assess blast radius before sprint decomposition or code review
- `dependency_clusters` — find natural module boundaries for sprint decomposition
- `shared_interfaces` — detect coupling between proposed parallel sprints

These tools query the code dependency graph (built during indexing).
They complement semantic search: semantic search finds code by meaning,
graph tools find code by structural relationships.
```

#### Files Changed (outside qdrant-mcp-server)

| File | Repo | Change |
|------|------|--------|
| `skills/develop-feature/SKILL.md` | claude-workspace-config | Add graph-assisted decomposition to Phase 3 |
| `templates/sprint-prompt-template.md` | claude-workspace-config | Add impact_analysis to code review checklist |
| `~/projects/CLAUDE.md` | projects root | Add graph tools to semantic search section |

## Correctness Properties (Invariants)

1. **Node uniqueness**: Each `(file_path, name, node_type, start_line)` tuple maps to exactly one node ID
2. **Edge consistency**: Deleting a file's nodes cascades to delete all edges where that file is source
3. **Incremental idempotency**: Running `reindex_changes` with no changes produces identical graph state
4. **Cycle safety**: Recursive CTEs terminate via depth limit AND path-based cycle detection
5. **Collection alignment**: Graph DB file uses same collection name as Qdrant — `clear_index` deletes both

## Security Considerations

| Threat | Mitigation |
|--------|-----------|
| **SQL injection via tool input** | All queries use parameterized statements (`better-sqlite3` prepared statements). No string interpolation in SQL. |
| **Path traversal in file paths** | Reuse existing `validatePath()` from CodeIndexer. All file paths are relative to validated codebase root. |
| **DoS via deep recursion** | Max depth capped at configurable limit (default 10). Recursive CTE terminates at depth limit. |
| **Large result sets** | All query tools have implicit LIMIT (100 for single-hop, 500 for multi-hop, 50 for clusters). |
| **Symlink attacks on DB file** | DB directory (`~/.qdrant-mcp/graph/`) created with `mkdirSync` — not following symlinks. DB file opened with `better-sqlite3` which doesn't follow symlinks by default. |
| **Stored content in edge target_id** | Unresolved edges store `unresolved:{name}` where `name` comes from source AST. Names are validated against `/^[a-zA-Z_$][a-zA-Z0-9_$.*]*$/` before storage. Names failing validation are discarded (edge not stored). All reads use parameterized queries, so even malformed values cannot cause SQL injection. |

## Error Handling

| Failure Mode | Behavior | Recovery |
|-------------|----------|----------|
| SQLite DB corrupt | Log error, skip graph for this codebase | `clear_index` + re-index |
| `better-sqlite3` not installed | Graph disabled with warning at startup | `npm install better-sqlite3` |
| Tree-sitter parse failure | Skip graph for that file (same as chunker fallback) | Automatic on next index |
| Unresolvable cross-file reference | Store as `unresolved:name` edge | Re-resolves on full reindex |
| DB file permissions | Log error, disable graph for session | Fix permissions manually |
| Disk full | Transaction rollback, partial graph | Free disk space + reindex |
| Graph indexer throws during `indexCodebase()` | **Non-fatal**: catch in CodeIndexer, log error, add to `stats.errors[]`, set `stats.status = "partial"`. Qdrant index is already complete at this point (graph runs after Qdrant). Return stats with graph error noted. |
| Graph/Qdrant sync divergence (crash mid-graph) | On next `getIndexStatus()`, if Qdrant has data but graph DB is missing or empty, report `graph.status: "stale"`. On next `index_codebase` or `reindex_changes`, graph is rebuilt from scratch (delete + re-extract) since graph extraction is fast relative to embedding. |

## File Changes Summary

| File | Change | Description |
|------|--------|-------------|
| `src/graph/extractor.ts` | **NEW** | AST relationship extraction per language |
| `src/graph/storage.ts` | **NEW** | SQLite graph storage with recursive CTEs |
| `src/graph/indexer.ts` | **NEW** | Graph indexing orchestrator |
| `src/graph/clusters.ts` | **NEW** | Connected-components cluster detection |
| `src/graph/config.ts` | **NEW** | Graph configuration types |
| `src/graph/types.ts` | **NEW** | GraphNode, GraphEdge, GraphStats types |
| `src/tools/graph.ts` | **NEW** | 6 MCP tool registrations |
| `src/tools/schemas.ts` | **MODIFY** | Add Zod schemas for graph tools |
| `src/tools/index.ts` | **MODIFY** | Register graph tools, add GraphIndexer to deps |
| `src/code/indexer.ts` | **MODIFY** | Call GraphIndexer during index/reindex/clear, extend getIndexStatus |
| `src/code/types.ts` | **MODIFY** | Add graph fields to IndexStatus |
| `src/index.ts` | **MODIFY** | Parse graph config env vars, instantiate GraphIndexer, pass to tools |
| `package.json` | **MODIFY** | Add `better-sqlite3` dependency |

**Outside qdrant-mcp-server (REQ-012):**

| File | Repo | Change |
|------|------|--------|
| `skills/develop-feature/SKILL.md` | claude-workspace-config | Add graph-assisted decomposition to Phase 3 |
| `templates/sprint-prompt-template.md` | claude-workspace-config | Add impact_analysis to code review checklist |
| `~/projects/CLAUDE.md` | projects root | Add graph tools to semantic search section |

## Dependency Graph (New Modules)

```
index.ts
  │
  ├── graph/config.ts          (no internal deps)
  ├── graph/types.ts           (no internal deps)
  │
  ├── graph/storage.ts         ← depends on: types.ts, config.ts
  │     └── better-sqlite3
  │
  ├── graph/extractor.ts       ← depends on: types.ts
  │     └── tree-sitter (reuses existing parsers)
  │
  ├── graph/clusters.ts        ← depends on: storage.ts, types.ts
  │
  ├── graph/indexer.ts          ← depends on: extractor.ts, storage.ts, clusters.ts, config.ts
  │
  └── tools/graph.ts           ← depends on: graph/indexer.ts, tools/schemas.ts
```

No circular dependencies. All new modules depend downward only.
