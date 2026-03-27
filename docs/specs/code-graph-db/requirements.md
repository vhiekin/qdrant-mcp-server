# Requirements: Code Dependency Graph

## Problem Statement

The qdrant-mcp-server currently indexes codebases into isolated vector chunks — each function, class, or block is stored as an independent embedding with no relationship to other code entities. When an AI coding agent (the Cyntegra sprint coordinator) needs to understand how a change propagates through the codebase — which functions call a modified function, what breaks if an interface changes, or where natural module boundaries lie — it must perform multiple sequential semantic searches and manually piece together relationships. This makes sprint decomposition in `/develop-feature` Phase 3 error-prone (sprints accidentally share interfaces) and cross-sprint code review in Phase 5.5 incomplete (changes in one sprint silently break call chains used by another).

## Value Proposition

A code dependency graph enables the AI coordinator to instantly trace call chains, assess blast radius of changes, and identify natural module clusters — turning what was guesswork in sprint decomposition into data-driven decisions, and making cross-sprint integration review mechanically verifiable.

## Glossary

| Term | Definition |
|------|-----------|
| **Node** | A code entity (function, class, interface, type, method) identified by file path + name + type |
| **Edge** | A directed relationship between two nodes (calls, imports, extends, implements, uses-type) |
| **Call chain** | An ordered sequence of edges from a source node to a sink node |
| **Blast radius** | The transitive set of all nodes reachable from a changed node via incoming edges (dependents) |
| **Dependency cluster** | A group of nodes with high internal connectivity and low external connectivity |
| **Graph DB** | A lightweight embedded database (SQLite with adjacency tables) storing nodes and edges alongside Qdrant's vector store |
| **AST visitor** | A tree-sitter-based module that walks parsed syntax trees to extract relationship information |

## Requirements

### REQ-001: AST-Based Relationship Extraction

**WHEN** the indexer processes a file with a supported language (Go, Python, TypeScript, JavaScript, Bash, Rust, Java), the system SHALL extract the following relationship types from the AST:

| Relationship | Description | Example |
|-------------|-------------|---------|
| `calls` | Function/method invocation | `handleCreate()` calls `db.Insert()` |
| `imports` | Module/package import | `indexer.ts` imports from `./chunker/base.js` |
| `extends` | Class inheritance | `class Admin extends User` |
| `implements` | Interface implementation | `TreeSitterChunker` implements `CodeChunker` |
| `uses_type` | Type reference in signature or body | `indexCodebase(config: CodeConfig)` uses `CodeConfig` |

### REQ-002: Graph Storage

The system SHALL store extracted relationships in an embedded SQLite database alongside the existing Qdrant vector store. The graph database SHALL:

- **REQ-002a**: Store nodes with: `id` (deterministic hash), `file_path`, `name`, `type` (function/class/interface/type/method), `language`, `start_line`, `end_line`
- **REQ-002b**: Store edges with: `source_id`, `target_id`, `relationship_type`, `source_file`, `target_file`, `line_number` (where the reference occurs)
- **REQ-002c**: Support the same incremental update pattern as Qdrant — when files change, delete old nodes/edges for those files and re-extract
- **REQ-002d**: Store the database file at `~/.qdrant-mcp/graph/{collectionName}.db` (one DB per indexed codebase, matching the Qdrant collection naming)
- **REQ-002e**: Require zero external services — SQLite runs embedded in the Node.js process via `better-sqlite3`

### REQ-003: MCP Tools — Call Chain Tracing

**WHEN** the `trace_call_chain` tool is invoked with a function/method name (and optional file path), the system SHALL return the ordered call chain from that function down to its leaf dependencies, including:
- Each node in the chain (name, file, type, line numbers)
- The relationship type at each step
- Maximum traversal depth (configurable, default 10)

### REQ-004: MCP Tools — Impact Analysis

**WHEN** the `impact_analysis` tool is invoked with a function/class/interface name (and optional file path), the system SHALL return all nodes that would be affected by a change to that entity:
- Direct dependents (1 hop: who calls/uses this?)
- Transitive dependents (N hops: who depends on the dependents?)
- Grouped by file path for readability
- Maximum traversal depth (configurable, default 10)

### REQ-005: MCP Tools — Dependency Clusters

**WHEN** the `dependency_clusters` tool is invoked with a codebase path, the system SHALL return groups of files/functions that form cohesive modules:
- Each cluster: list of files, internal edge count, external edge count
- Sorted by cluster size (largest first)
- Useful for identifying natural sprint boundaries

### REQ-006: MCP Tools — Get Callers / Get Callees

**WHEN** the `get_callers` tool is invoked with a function name, the system SHALL return all direct callers (1 hop incoming edges).

**WHEN** the `get_callees` tool is invoked with a function name, the system SHALL return all direct callees (1 hop outgoing edges).

Both tools SHALL support optional file path filtering to disambiguate functions with the same name.

### REQ-007: MCP Tools — Shared Interfaces

**WHEN** the `shared_interfaces` tool is invoked with two sets of file paths, the system SHALL return:
- All nodes that are referenced by files in BOTH sets
- The specific relationship types from each set to the shared nodes
- This enables detecting when two sprints would touch the same interfaces

### REQ-008: Indexing Integration

The graph extraction SHALL integrate with the existing indexing pipeline:
- **REQ-008a**: WHEN `index_codebase` is called, the system SHALL build/rebuild the graph DB alongside the Qdrant index
- **REQ-008b**: WHEN `reindex_changes` is called, the system SHALL incrementally update the graph DB (delete old edges for changed files, re-extract)
- **REQ-008c**: WHEN `clear_index` is called, the system SHALL also delete the corresponding graph DB file
- **REQ-008d**: Graph extraction SHALL NOT block or slow the vector indexing by more than 30% (measured as wall-clock time increase on a codebase with up to 100K nodes)

### REQ-009: Configuration

The system SHALL support the following configuration via environment variables:
- `CODE_ENABLE_GRAPH` — Enable/disable graph extraction (default: `true`)
- `CODE_GRAPH_MAX_DEPTH` — Maximum traversal depth for call chain/impact tools (default: `10`)

### REQ-010: Graph Status

**WHEN** the `get_index_status` tool is called, the response SHALL include graph statistics:
- Total nodes, total edges
- Breakdown by relationship type
- Whether graph is enabled/available

### REQ-011: Tool Discoverability — Agent-Oriented Descriptions

The system SHALL register each graph tool with an MCP `description` that encodes:
- **When** the agent should use the tool (trigger condition)
- **What** the tool returns (output shape)
- **How** it fits into the agent's workflow (e.g., "before sprint decomposition", "during code review")

The descriptions SHALL be written from the agent's perspective, not as generic API documentation. Agents that have never seen these tools before should understand when to reach for them from the description alone.

### REQ-012: Coordinator Workflow Integration

The graph tools SHALL be accompanied by updates to the agent orchestration templates and skills so that:
- **REQ-012a**: The `/develop-feature` skill's Phase 3 (sprint decomposition) SHALL instruct the coordinator to call `dependency_clusters` and `shared_interfaces` before assigning tasks to sprints
- **REQ-012b**: The sprint prompt template's code review checklist SHALL include running `impact_analysis` on changed functions to verify no cross-sprint breakage
- **REQ-012c**: The `CLAUDE.md` semantic search mandate section SHALL be extended to include graph tools as a recommended step alongside `mcp__claude-context__search_code`

### Non-Functional Requirements

| NFR | Metric |
|-----|--------|
| **NFR-001: Indexing overhead** | Graph extraction adds < 30% wall-clock time to `index_codebase` on a codebase with up to 100K nodes |
| **NFR-002: Query latency** | `get_callers`, `get_callees` respond in < 100ms for codebases up to 100K nodes |
| **NFR-003: Multi-hop latency** | `trace_call_chain`, `impact_analysis` with depth 10 respond in < 500ms for codebases up to 100K nodes |
| **NFR-004: Cluster latency** | `dependency_clusters` responds in < 2s for codebases up to 100K nodes |
| **NFR-005: Disk footprint** | Graph DB file < 50MB for a 100K-node codebase |
| **NFR-006: Zero external deps** | No additional services required — SQLite is embedded, no network calls |
| **NFR-007: Backward compatibility** | Existing MCP tools (`search_code`, `index_codebase`, etc.) continue to work identically when graph is disabled |

## Test Scenarios

### TS-001: Basic Relationship Extraction (REQ-001)
- Index a TypeScript file with `import` statements and function calls
- Verify edges are created for each import and each call site
- Verify node metadata (name, type, file, lines) is correct

### TS-002: Cross-File Call Chain (REQ-003)
- Index a codebase where `A.ts:funcA()` calls `B.ts:funcB()` calls `C.ts:funcC()`
- Call `trace_call_chain("funcA")`
- Verify chain returns A → B → C with correct relationship types

### TS-003: Impact Analysis (REQ-004)
- Index a codebase where `Interface.ts:IFoo` is implemented by `A.ts:ClassA` and used by `B.ts:funcB()`
- Call `impact_analysis("IFoo")`
- Verify both ClassA and funcB appear as affected

### TS-004: Dependency Clusters (REQ-005)
- Index a codebase with two clearly separated modules (e.g., `auth/*` and `billing/*`) with minimal cross-references
- Call `dependency_clusters`
- Verify two distinct clusters are returned

### TS-005: Shared Interfaces (REQ-007)
- Index a codebase with a shared `types.ts` imported by both `module-a/` and `module-b/`
- Call `shared_interfaces` with module-a files and module-b files
- Verify `types.ts` entities appear as shared

### TS-006: Incremental Update (REQ-008b)
- Index a codebase, then modify one file to add a new function call
- Call `reindex_changes`
- Verify old edges for that file are removed and new edges are added

### TS-007: Graph Disabled (NFR-007)
- Set `CODE_ENABLE_GRAPH=false`
- Call `index_codebase`
- Verify Qdrant indexing works normally and no graph DB file is created
- Verify graph-specific tools return a clear "graph not enabled" message

### TS-008: Go Language Support (REQ-001)
- Index Go files with method receivers, interface implementations, and package imports
- Verify correct edge extraction for Go-specific patterns (e.g., `(s *Server) HandleCreate()` calls `s.db.Insert()`)

### TS-009: Python Language Support (REQ-001)
- Index Python files with `from x import y`, class inheritance (`class Foo(Bar):`), and function calls
- Verify correct edge extraction

### TS-010: Performance — Indexing Overhead (NFR-001)
- Index the qdrant-mcp-server codebase itself (~50 files) with and without graph enabled
- Verify graph adds < 30% overhead

### TS-011: Performance — Query Latency (NFR-002, NFR-003)
- On a synthetic codebase with 10K nodes, run `get_callers` and verify < 100ms
- Run `trace_call_chain` with depth 10 and verify < 500ms

### TS-012: Get Callers / Get Callees Correctness (REQ-006)
- Index a codebase where `funcA()` calls `funcB()` and `funcC()`, and `funcD()` also calls `funcB()`
- Call `get_callees("funcA")` — verify returns `funcB` and `funcC`
- Call `get_callers("funcB")` — verify returns `funcA` and `funcD`
- Call `get_callers("funcB", filePath="specific.ts")` — verify file filtering works

### TS-013: Max Depth Configuration (REQ-009)
- Set `CODE_GRAPH_MAX_DEPTH=3`
- Index a chain: A calls B calls C calls D calls E
- Call `trace_call_chain("A")` — verify chain stops at D (depth 3), does not include E
- Set `CODE_GRAPH_MAX_DEPTH=10` (default) — verify full chain returns

### TS-014: Tool Descriptions Are Agent-Oriented (REQ-011)
- For each graph tool, verify the registered MCP description contains:
  - A trigger condition ("Use BEFORE...", "Use during...")
  - An output description
  - A workflow context reference
- Verify descriptions do NOT use generic API language ("Queries the database...", "Returns a list of...")

### TS-015: Coordinator Template Integration (REQ-012)
- Verify `/develop-feature` skill Phase 3 text mentions `dependency_clusters` and `shared_interfaces`
- Verify sprint prompt template code review checklist mentions `impact_analysis`
- Verify `CLAUDE.md` semantic search section references graph tools
