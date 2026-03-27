# Tasks: Code Dependency Graph

## Coverage Matrix

| Requirement | Test Scenario | Tasks |
|------------|--------------|-------|
| REQ-001 | TS-001, TS-008, TS-009 | TASK-1, TASK-2 |
| REQ-002 | TS-001, TS-006 | TASK-3 |
| REQ-003 | TS-002 | TASK-4 |
| REQ-004 | TS-003 | TASK-4 |
| REQ-005 | TS-004 | TASK-5 |
| REQ-006 | TS-012 | TASK-4 |
| REQ-007 | TS-005 | TASK-4 |
| REQ-008 | TS-006, TS-007, TS-010 | TASK-6 |
| REQ-009 | TS-007, TS-013 | TASK-6 |
| REQ-010 | TS-007 | TASK-6 |
| REQ-011 | TS-014 | TASK-7 |
| REQ-012 | TS-015 | TASK-8 |

---

## Epic 1: Enable Structural Code Understanding

*Enables the AI coordinator to see how code entities relate to each other structurally, not just semantically.*

### TASK-1: Graph Types and Configuration

**Files:**
- `src/graph/types.ts` (NEW)
- `src/graph/config.ts` (NEW)

**Steps:**
1. Create `src/graph/types.ts` with interfaces:
   - `GraphNode`: id, file_path, name, node_type, language, start_line, end_line
   - `GraphEdge`: id, source_id, target_id, relationship, source_file, target_file, line_number
   - `RelationshipType`: 'calls' | 'imports' | 'extends' | 'implements' | 'uses_type'
   - `NodeType`: 'function' | 'class' | 'interface' | 'type' | 'method'
   - `GraphStats`: totalNodes, totalEdges, edgesByType, status
   - `CallChain`, `ImpactResult`, `Cluster`, `SharedNode` result types
2. Create `src/graph/config.ts`:
   - `GraphConfig` interface: enabled, maxDepth
   - Default values
   - `parseGraphConfig()` factory from env vars

**Validates:** REQ-009 (config), foundation for all other tasks
**Verification:** TypeScript compiles, types are importable

### TASK-2: AST Relationship Extractor

**Files:**
- `src/graph/extractor.ts` (NEW)

**Steps:**
1. Create `RelationshipExtractor` class
2. Implement `extract(tree: Parser.Tree, code: string, filePath: string, language: string): { nodes: GraphNode[], edges: GraphEdge[] }`
3. Implement language-specific extraction methods:
   - `extractTypeScript(tree, code, filePath)` — import_statement, call_expression, extends_clause, implements_clause, type annotations
   - `extractJavaScript(tree, code, filePath)` — same as TS minus type annotations
   - `extractGo(tree, code, filePath)` — import_declaration, call_expression with receiver, interface embedding
   - `extractPython(tree, code, filePath)` — import_statement, import_from_statement, call, class bases
   - `extractRust(tree, code, filePath)` — use_declaration, call_expression, impl with trait
   - `extractJava(tree, code, filePath)` — import_declaration, method_invocation, superclass/interfaces
   - `extractBash(tree, code, filePath)` — source/., command_name
4. Implement node name validation: `/^[a-zA-Z_$][a-zA-Z0-9_$.*]*$/` — discard invalid names
5. Generate deterministic node IDs: `SHA256(filePath:name:nodeType:startLine)[:16]`
6. Write unit tests for each language

**Validates:** REQ-001
**Verification:** Tests pass for all 7 languages. Each test indexes a known file and asserts specific nodes/edges are extracted.

### TASK-3: SQLite Graph Storage

**Files:**
- `src/graph/storage.ts` (NEW)
- `package.json` (MODIFY — add `better-sqlite3` + `@types/better-sqlite3`)

**Steps:**
1. Add `better-sqlite3` and `@types/better-sqlite3` to dependencies
2. Create `GraphStorage` class:
   - `constructor(collectionName: string)` — resolves DB path `~/.qdrant-mcp/graph/{collectionName}.db`
   - `open()` — create directory, open DB, create tables with schema from design
   - `close()` — close DB connection
   - `destroy()` — delete DB file
3. Implement write methods (all wrapped in transactions):
   - `insertNodes(nodes: GraphNode[]): void`
   - `insertEdges(edges: GraphEdge[]): void`
   - `deleteByFiles(filePaths: string[]): void` — delete nodes and edges where source_file matches
4. Implement single-hop read methods:
   - `getCallers(name, filePath?): GraphNode[]` — JOIN edges→nodes where target matches
   - `getCallees(name, filePath?): GraphNode[]` — JOIN edges→nodes where source matches
5. Implement multi-hop traversal methods (application-side Set, not CTE):
   - `traceCallChain(name, filePath?, maxDepth?): CallChain`
   - `getImpactRadius(name, filePath?, maxDepth?): ImpactResult`
6. Implement aggregate methods:
   - `getSharedInterfaces(filesA, filesB): SharedNode[]`
   - `getStats(): GraphStats`
7. Write unit tests with in-memory SQLite (`:memory:` mode)

**Validates:** REQ-002, REQ-003, REQ-004, REQ-006, REQ-007
**Verification:** Tests pass — insert/query/delete/traversal correctness. Cycle handling verified.

### TASK-4: MCP Graph Tools and Zod Schemas

**Files:**
- `src/tools/graph.ts` (NEW)
- `src/tools/schemas.ts` (MODIFY)

**Steps:**
1. Add Zod schemas to `schemas.ts`:
   - `TraceCallChainSchema`: path (string), name (string), filePath (string, optional), maxDepth (number, optional)
   - `ImpactAnalysisSchema`: same shape
   - `DependencyClustersSchema`: path (string)
   - `GetCallersSchema`: path (string), name (string), filePath (string, optional)
   - `GetCalleesSchema`: same shape
   - `SharedInterfacesSchema`: path (string), filesA (string[]), filesB (string[])
2. Create `src/tools/graph.ts`:
   - `registerGraphTools(server, deps)` following pattern of `registerCodeTools`
   - Register 6 tools with agent-oriented descriptions from design
   - Each tool: validate inputs, get collection name, open graph storage, run query, format output, return MCP text content
   - Handle `CODE_ENABLE_GRAPH=false` gracefully (return disabled message)
3. Format output as human-readable structured text (indented trees for chains, grouped lists for impact)
4. Write tests verifying tool registration and output formatting

**Validates:** REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-011
**Verification:** Tools are registered, schemas validate correctly, output is readable

### TASK-5: Dependency Cluster Analysis

**Files:**
- `src/graph/clusters.ts` (NEW)

**Steps:**
1. Create `DependencyClusterAnalyzer` class
2. Implement `getClusters(storage: GraphStorage): Cluster[]`:
   - Query `SELECT DISTINCT source_file, target_file FROM edges`
   - Build undirected file-adjacency map
   - BFS to find connected components
   - For each component: count internal vs external edges
   - Sort by size (largest first)
3. Implement scale guard: if >50K file pairs, return error
4. Write unit tests with synthetic graph data

**Validates:** REQ-005
**Verification:** Tests pass — two isolated modules produce two clusters, shared files bridge clusters correctly

---

## Epic 2: Integrate Graph Into Existing Pipeline

*Connects the graph infrastructure to the existing indexing and tool registration pipeline.*

### TASK-6: Graph Indexer + CodeIndexer Integration

**Files:**
- `src/graph/indexer.ts` (NEW)
- `src/code/indexer.ts` (MODIFY)
- `src/code/types.ts` (MODIFY)
- `src/tools/index.ts` (MODIFY)
- `src/index.ts` (MODIFY)

**Steps:**
1. Create `GraphIndexer` class:
   - `constructor(config: GraphConfig)`
   - `indexFiles(files: string[], codebasePath: string, collectionName: string): GraphStats` — parse each file with tree-sitter, extract, resolve cross-file references, batch insert
   - `updateFiles(added, modified, deleted, codebasePath, collectionName): GraphStats` — delete old, re-extract changed
   - `clearGraph(collectionName): void` — destroy DB
   - `getStats(collectionName): GraphStats` — open DB, query stats
2. Modify `src/code/indexer.ts`:
   - Accept optional `GraphIndexer` in constructor
   - In `indexCodebase()`: after Qdrant indexing, call `graphIndexer.indexFiles()` wrapped in try/catch (non-fatal)
   - In `reindexChanges()`: call `graphIndexer.updateFiles()` wrapped in try/catch
   - In `clearIndex()`: call `graphIndexer.clearGraph()` wrapped in try/catch
   - In `getIndexStatus()`: include `graphIndexer.getStats()` in response, detect stale graph
3. Modify `src/code/types.ts`: add `graph?` field to `IndexStatus`
4. Modify `src/tools/index.ts`:
   - Add `GraphIndexer` to `ToolDependencies`
   - Call `registerGraphTools(server, { graphIndexer, codeIndexer })`
5. Modify `src/index.ts`:
   - Parse `CODE_ENABLE_GRAPH` and `CODE_GRAPH_MAX_DEPTH` env vars
   - Instantiate `GraphIndexer` if enabled
   - Pass to `registerAllTools`
6. Write integration tests: index a small codebase, verify both Qdrant and graph populated

**Validates:** REQ-008, REQ-009, REQ-010
**Verification:** `index_codebase` populates both Qdrant and graph. `reindex_changes` updates graph incrementally. `clear_index` removes both. `get_index_status` shows graph stats.

---

## Epic 3: Enable Agent Workflow Integration

*Ensures agents know about and use graph tools at the right moments in the development workflow.*

### TASK-7: Agent-Oriented Tool Descriptions

**Files:**
- `src/tools/graph.ts` (already created in TASK-4)

**Steps:**
1. Review and refine each tool's MCP `description` field to match the exact text from design section 5
2. Verify descriptions contain trigger conditions, output descriptions, and workflow context
3. Verify descriptions do NOT use generic API language
4. Write a test that reads each registered tool's description and asserts it contains expected keywords ("sprint", "blast radius", "before modifying", etc.)

**Validates:** REQ-011
**Verification:** Description keyword tests pass

### TASK-8: Coordinator Template and Skill Updates

**Files (outside qdrant-mcp-server):**
- `~/.claude/skills/develop-feature/SKILL.md` (MODIFY — managed by claude-workspace-config)
- `~/.claude/templates/sprint-prompt-template.md` (MODIFY — managed by claude-workspace-config)
- `~/projects/CLAUDE.md` (MODIFY)

**Steps:**
1. In `/develop-feature` skill Phase 3 "Sprint Decomposition" section, add the "Graph-Assisted Decomposition" subsection from design
2. In sprint prompt template Code Review Checklist, add `impact_analysis` cross-sprint check
3. In `~/projects/CLAUDE.md` semantic search section, add "Graph Analysis Tools" subsection
4. Verify changes don't break existing skill loading (syntax check)

**Validates:** REQ-012
**Verification:** Skills load correctly. Text is present in each file.

---

## Execution Order

```
TASK-1 (types/config) ─┐
                        ├─→ TASK-2 (extractor) ─┐
                        ├─→ TASK-3 (storage) ────┼─→ TASK-5 (clusters) ─┐
                        │                        │                       │
                        │                        └─→ TASK-4 (tools) ─────┤
                        │                                                │
                        └────────────────────────────────────────────────┼─→ TASK-6 (integration)
                                                                         │
                                                                         ├─→ TASK-7 (descriptions) ← can overlap with TASK-6
                                                                         │
                                                                         └─→ TASK-8 (templates) ← independent, can parallel
```

---

## Sprint Decomposition

### Sprint 1: `graph-foundation` (Wave 1)

- **Tasks**: TASK-1, TASK-2, TASK-3, TASK-5
- **Focus**: All new `src/graph/` modules — types, config, extractor, storage, clusters. The complete graph infrastructure with no external dependencies.
- **Repo**: qdrant-mcp-server
- **Key Files**: `src/graph/types.ts`, `src/graph/config.ts`, `src/graph/extractor.ts`, `src/graph/storage.ts`, `src/graph/clusters.ts`, `package.json`
- **Estimated scope**: 6 new files + package.json modification + tests
- **Model**: opus
- **Why opus**: Wave 1 foundation sprint establishing patterns for tree-sitter AST traversal across 7 languages. Novel extraction logic with ambiguous edge cases (Go receivers, Python decorators, Bash source commands). Sets the patterns Sprint 2 builds on.

### Sprint 2: `graph-tools-integration` (Wave 2, depends: Sprint 1)

- **Tasks**: TASK-4, TASK-6, TASK-7
- **Focus**: MCP tool registration with agent-oriented descriptions, CodeIndexer integration, index.ts wiring. Connects the graph infrastructure to the existing server.
- **Repo**: qdrant-mcp-server
- **Key Files**: `src/tools/graph.ts`, `src/tools/schemas.ts`, `src/tools/index.ts`, `src/code/indexer.ts`, `src/code/types.ts`, `src/index.ts`
- **Estimated scope**: 1 new file + 5 modified files + tests
- **Model**: sonnet
- **Why sonnet**: Well-scoped integration work following established patterns from `tools/code.ts` and `tools/schemas.ts`. Sprint 1 output provides all types and APIs to consume.

### Sprint 3: `graph-workflow-templates` (Wave 2, parallel with Sprint 2)

- **Tasks**: TASK-8
- **Focus**: Template and skill updates outside qdrant-mcp-server. Adds graph tool references to `/develop-feature` Phase 3, sprint prompt template, and CLAUDE.md.
- **Repo**: claude-workspace-config + projects root
- **Key Files**: `skills/develop-feature/SKILL.md`, `templates/sprint-prompt-template.md`, `~/projects/CLAUDE.md`
- **Estimated scope**: 3 modified files (text additions only)
- **Model**: haiku
- **Why haiku**: Pure text additions to existing markdown files. No code logic, no architectural decisions. Copy design text into the right locations.
