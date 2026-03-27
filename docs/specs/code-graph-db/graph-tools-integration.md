# Graph Tools & Integration — MCP Tools, CodeIndexer Hooks, Server Wiring

## Agent Role

Act as an **architect and coordinator**. You orchestrate work by spawning sub-agents via the Task tool. Do NOT implement code directly in the main process.

**Responsibilities:**
- Design the implementation approach before delegating
- Spawn sub-agents for all file modifications
- Verify work through testing before marking complete
- Coordinate parallel work when tasks are independent

---

## Project Context

- **Project**: qdrant-mcp-server
- **Codebase**: /Users/vhiekin/projects/_tools/qdrant-mcp-server
- **Worktree**: /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-tools-integration/ (all work happens here)
- **Branch**: feature/graph-tools-integration
- **Base Branch**: feature/code-graph-db
- **MODEL**: sonnet
- **AUTHORIZED_ENV**: dev
- **Related Docs**: `docs/specs/code-graph-db/requirements.md`, `docs/specs/code-graph-db/design.md`, `docs/specs/code-graph-db/tasks.md`

### Setup: Merge Parent Branch (Wave 2 Sprint)

Before starting implementation, merge the base branch into your worktree:

```bash
cd /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-tools-integration
git merge feature/code-graph-db --no-edit
```

Also merge the Wave 1 sprint's branch to get the graph foundation modules:

```bash
git merge feature/graph-foundation --no-edit
```

### Setup: Read Predecessor Handoffs

```bash
for f in .worktrees/.handoff/*.md; do
    [ -f "$f" ] && echo "=== $(basename "$f") ===" && cat "$f"
done
```

### Setup: Read Prior Wave Retrospective

```bash
cat docs/specs/code-graph-db/retrospective.md 2>/dev/null || echo "No retrospective notes yet"
```

---

## Startup Confirmation (MANDATORY — do this FIRST)

```bash
STATUS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-status}"
mkdir -p "$STATUS_DIR"
cat > "$STATUS_DIR/graph-tools-integration.status" <<STATUSEOF
PHASE=Starting
STATUS=RUNNING
MESSAGE=Agent confirmed startup, beginning work
MODEL=${CLAUDE_MODEL:-sonnet}
UPDATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUSEOF
```

---

## Objectives

1. Give the AI coordinator access to structural code analysis by registering 6 MCP graph tools with agent-oriented descriptions
2. Create the `GraphIndexer` orchestrator that ties extractor + storage together so graphs are built automatically during indexing
3. Integrate graph indexing into existing `CodeIndexer` (non-fatal, runs after Qdrant) so no manual steps are needed
4. Wire everything up in `index.ts` with env var configuration
5. Ensure all existing tests still pass — no regressions

---

## Requirements & Notes

### From Requirements Doc

- **REQ-003**: `trace_call_chain` — ordered call chain from function to leaf deps
- **REQ-004**: `impact_analysis` — all transitive dependents grouped by file
- **REQ-005**: `dependency_clusters` — cohesive module groups
- **REQ-006**: `get_callers` / `get_callees` — direct 1-hop queries
- **REQ-007**: `shared_interfaces` — nodes referenced by two file sets
- **REQ-008**: Integration with `index_codebase`, `reindex_changes`, `clear_index`, `get_index_status`
- **REQ-009**: `CODE_ENABLE_GRAPH` env var (default true), `CODE_GRAPH_MAX_DEPTH` (default 10)
- **REQ-010**: Graph stats in `get_index_status` response
- **REQ-011**: Agent-oriented tool descriptions with trigger conditions and workflow context

### Technical Notes

- Graph indexer failure is **non-fatal** — catch in CodeIndexer, log error, add to stats.errors[], status="partial"
- Graph tools need codebase `path` to derive collection name → open correct SQLite DB
- When `CODE_ENABLE_GRAPH=false`, tools return a clear disabled message
- If graph DB is missing but Qdrant has data, report `graph.status: "stale"` in index status
- All 6 tools use the existing `withToolLogging` wrapper from `tools/logging.ts`
- Follow schema pattern from `tools/schemas.ts` — Zod schemas as plain objects

---

## Constraints

### General
- Follow existing code patterns in `tools/code.ts` and `tools/schemas.ts`
- All tool descriptions must be agent-oriented (trigger, output, workflow context)
- Do not modify unrelated code
- Use pino logger with child loggers

### Integration Rules
- Graph indexer called AFTER Qdrant indexing completes
- Wrapped in try/catch — never fail the parent operation
- `clearIndex()` deletes graph DB alongside Qdrant collection
- `getIndexStatus()` includes graph stats

---

## Test Commands

### Quick Iteration Command
```
npx vitest run src/tools/__tests__/graph.test.ts src/graph/__tests__/indexer.test.ts
```

### Relevant Test Files
- `src/tools/__tests__/graph.test.ts`
- `src/graph/__tests__/indexer.test.ts`

### Performance Verification (NFR-001 through NFR-004)
Performance tests require the full pipeline (Sprint 1 + Sprint 2 integrated). These are verified during Phase 6 integration review, not during individual sprints. The coordinator will run `src/graph/__tests__/performance.test.ts` after all sprints merge.

FULL_SUITE_APPROVED: false

---

### Test Execution Rules — MANDATORY, NO EXCEPTIONS

1. **Run ONLY the Relevant Test Files listed above.** Do not discover, add, or substitute tests.
2. **NEVER run the full suite** unless `FULL_SUITE_APPROVED: true` is set above.
3. **NEVER delegate test execution to a sub-agent.** Only the main sprint agent runs tests.

---

## Testing Strategy

- **Tool tests**: Verify registration, input validation, output format, disabled mode
- **Integration tests**: GraphIndexer end-to-end (index → query → update → clear)
- **Error paths**: Non-fatal graph failure, stale detection, missing DB
- **Regression**: Existing code tool tests must still pass

---

## Inline Context

Key interfaces from Sprint 1 (graph-foundation) that this sprint consumes.

### src/graph/types.ts (from Sprint 1)
```typescript
export interface GraphNode {
  id: string;
  file_path: string;
  name: string;
  node_type: NodeType;
  language: string;
  start_line: number;
  end_line: number;
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relationship: RelationshipType;
  source_file: string;
  target_file: string | null;
  line_number: number | null;
}

export type RelationshipType = 'calls' | 'imports' | 'extends' | 'implements' | 'uses_type';
export type NodeType = 'function' | 'class' | 'interface' | 'type' | 'method';

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  edgesByType: Record<string, number>;
  status: 'active' | 'stale' | 'disabled';
}

export interface GraphConfig {
  enabled: boolean;
  maxDepth: number;
}
```

### src/graph/storage.ts API (from Sprint 1)
```typescript
class GraphStorage {
  constructor(collectionName: string)
  open(): void
  close(): void
  destroy(): void
  insertNodes(nodes: GraphNode[]): void
  insertEdges(edges: GraphEdge[]): void
  deleteByFiles(filePaths: string[]): void
  getCallers(name: string, filePath?: string): GraphNode[]
  getCallees(name: string, filePath?: string): GraphNode[]
  traceCallChain(name: string, filePath?: string, maxDepth?: number): CallChain
  getImpactRadius(name: string, filePath?: string, maxDepth?: number): ImpactResult
  getDependencyClusters(): Cluster[]
  getSharedInterfaces(filesA: string[], filesB: string[]): SharedNode[]
  getStats(): GraphStats
}
```

### src/graph/extractor.ts API (from Sprint 1)
```typescript
class RelationshipExtractor {
  extract(tree: Parser.Tree, code: string, filePath: string, language: string):
    { nodes: GraphNode[], edges: GraphEdge[] }
}
```

### Existing tool registration pattern (src/tools/code.ts)
```typescript
export function registerCodeTools(server: McpServer, deps: CodeToolDependencies): void {
  server.registerTool("tool_name", {
    title: "Tool Title",
    description: "Tool description",
    inputSchema: schemas.SchemaName,
  }, withToolLogging("tool_name", async (input, extra) => {
    // implementation
    return { content: [{ type: "text", text: result }] };
  }));
}
```

---

## Orchestration Rules

### Code Search (Main Process Only)
Sub-agents do NOT have MCP access. Read existing source files to understand patterns, then provide file paths to sub-agents.

### Sub-Agent Delegation
Every sub-agent prompt MUST include:
1. **Objective**: Clear, specific task
2. **Files**: Explicit worktree paths to read/modify
3. **Constraints**: Rules that apply
4. **Testing**: What to verify
5. **Completion Criteria**: What "done" looks like

### Working Directory
- RIGHT: `/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-tools-integration/src/tools/graph.ts`
- WRONG: `/Users/vhiekin/projects/_tools/qdrant-mcp-server/src/tools/graph.ts`

### Branch / Commit Discipline (CRITICAL)
```bash
cd /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-tools-integration
git branch --show-current   # must print: feature/graph-tools-integration
```

### Parallel Execution
- Launch Zod schemas + tool registration in parallel with GraphIndexer (no dependencies between them)
- CodeIndexer integration must wait for both to complete

### Model Selection
Sub-agents: `model: "sonnet"` for all tasks (well-scoped implementation work).

### Status Reporting
```bash
STATUS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-status}"
mkdir -p "$STATUS_DIR"
cat > "$STATUS_DIR/graph-tools-integration.status" <<STATUSEOF
PHASE=[current phase name]
STATUS=[RUNNING|NEEDS_APPROVAL|BLOCKED|COMPLETE]
MESSAGE=[brief description]
MODEL=${CLAUDE_MODEL:-sonnet}
UPDATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUSEOF
```

---

## Implementation Order

### Phase 1: Zod Schemas (TASK-4 part 1)
1. Read `src/tools/schemas.ts` for pattern reference
2. Add 6 new schemas:
   - `TraceCallChainSchema`: path (string), name (string), filePath (string, optional), maxDepth (number, optional, default 10)
   - `ImpactAnalysisSchema`: same shape as TraceCallChain
   - `DependencyClustersSchema`: path (string)
   - `GetCallersSchema`: path (string), name (string), filePath (string, optional)
   - `GetCalleesSchema`: same shape as GetCallers
   - `SharedInterfacesSchema`: path (string), filesA (string array), filesB (string array)

### Phase 2: MCP Tool Registration (TASK-4 part 2 + TASK-7)
1. Create `src/tools/graph.ts`
2. Define `GraphToolDependencies` interface (needs codeIndexer for collection name resolution, graphIndexer)
3. Register 6 tools with **agent-oriented descriptions** (exact text from design):
   - `trace_call_chain`: "Use BEFORE modifying a function to understand what it depends on..."
   - `impact_analysis`: "Use BEFORE planning changes to understand the blast radius..."
   - `dependency_clusters`: "Use during sprint decomposition to find natural module boundaries..."
   - `get_callers`: "Quick lookup: find all functions that directly call a given function..."
   - `get_callees`: "Quick lookup: find all functions that a given function directly calls..."
   - `shared_interfaces`: "Use during sprint decomposition to detect coupling between two sets of files..."
4. Each tool handler: validate path, get collection name (reuse CodeIndexer.getCollectionName pattern), open GraphStorage, run query, format output, return MCP text content
5. Handle `CODE_ENABLE_GRAPH=false` — return "Graph analysis is disabled" message
6. Format outputs as human-readable text (indented trees for chains, grouped lists for impact)

### Phase 3: GraphIndexer Orchestrator (TASK-6 part 1)
1. Create `src/graph/indexer.ts`
2. Implement `GraphIndexer`:
   - Constructor takes `GraphConfig`
   - `indexFiles(files, codebasePath, collectionName)`: parse files, extract, resolve cross-file refs, batch insert
   - `updateFiles(added, modified, deleted, codebasePath, collectionName)`: delete old, re-extract changed
   - `clearGraph(collectionName)`: destroy DB
   - `getStats(collectionName)`: open DB, query stats, return GraphStats
3. Cross-file resolution: after extracting all files, match unresolved targets to node table by name (unique match → resolve; ambiguous → proximity heuristic; still ambiguous → leave unresolved)

### Phase 4: CodeIndexer Integration (TASK-6 part 2)
1. Modify `src/code/indexer.ts`:
   - Accept optional `GraphIndexer` in constructor
   - In `indexCodebase()`: after Qdrant store phase, call `graphIndexer.indexFiles()` in try/catch
   - In `reindexChanges()`: call `graphIndexer.updateFiles()` in try/catch
   - In `clearIndex()`: call `graphIndexer.clearGraph()` in try/catch
   - In `getIndexStatus()`: call `graphIndexer.getStats()`, detect stale graph
2. Modify `src/code/types.ts`: add `graph?` field to `IndexStatus` interface
3. Modify `src/tools/index.ts`: add `registerGraphTools()`, update `ToolDependencies`
4. Modify `src/index.ts`: parse env vars, instantiate GraphIndexer, pass to tools

### Phase 5: Testing & Verification
1. Write tests for graph tools (tool registration, input validation, output format):
   - Happy path: each tool returns expected output structure
   - Disabled path (TS-007): when `CODE_ENABLE_GRAPH=false`, tools return disabled message
   - Graph DB missing: tool returns "not indexed" or stale message
2. Write tests for GraphIndexer:
   - Happy path: index, update, clear, stats
   - Error paths: graph indexer throws → CodeIndexer catches, logs, returns partial stats
   - Stale detection: Qdrant has data but graph DB missing → `graph.status: "stale"`
3. Run tests: `npx vitest run src/tools/__tests__/graph.test.ts src/graph/__tests__/indexer.test.ts`
4. Run type check: `npx tsc --noEmit`
5. Verify existing tests still pass: `npx vitest run src/tools/__tests__/code.test.ts`

---

## Code Review Checklist (Before Completing)

**Security:**
- [ ] No hardcoded credentials
- [ ] Tool inputs validated via Zod schemas
- [ ] Graph storage uses parameterized queries (inherited from Sprint 1)

**Correctness:**
- [ ] Graph failure in CodeIndexer is non-fatal (caught, logged, stats.errors)
- [ ] `clearIndex` deletes both Qdrant collection AND graph DB
- [ ] `getIndexStatus` correctly detects stale graph
- [ ] Tools handle `CODE_ENABLE_GRAPH=false` gracefully
- [ ] Cross-sprint impact: Run `impact_analysis` on each modified function/type. Verify no dependents exist in other active sprints' file sets.

**Testing:**
- [ ] Tool registration tests pass
- [ ] GraphIndexer integration tests pass
- [ ] Existing code tool tests unaffected

---

## Success Criteria

- [ ] 6 MCP graph tools registered with agent-oriented descriptions
- [ ] `GraphIndexer` orchestrates extraction → resolution → storage
- [ ] `CodeIndexer` calls graph indexer (non-fatal) during index/reindex/clear
- [ ] `getIndexStatus` includes graph stats
- [ ] `CODE_ENABLE_GRAPH=false` disables graph entirely
- [ ] All new tests pass
- [ ] Existing tests unaffected
- [ ] TypeScript compiles clean

---

## Deliverables

- [ ] `src/tools/graph.ts` (NEW)
- [ ] `src/graph/indexer.ts` (NEW)
- [ ] `src/tools/schemas.ts` (MODIFIED — 6 new schemas)
- [ ] `src/tools/index.ts` (MODIFIED — register graph tools)
- [ ] `src/code/indexer.ts` (MODIFIED — graph integration)
- [ ] `src/code/types.ts` (MODIFIED — graph in IndexStatus)
- [ ] `src/index.ts` (MODIFIED — env vars, GraphIndexer instantiation)
- [ ] `src/tools/__tests__/graph.test.ts` (NEW)
- [ ] `src/graph/__tests__/indexer.test.ts` (NEW)
- [ ] Code committed to `feature/graph-tools-integration`

---

## Retrospective (MANDATORY before completing)

```bash
cat >> docs/specs/code-graph-db/retrospective.md <<'RETROEOF'

## graph-tools-integration Retrospective

### Observations
- [observation 1]

### Prompt/Process Feedback
- [what was unclear or missing]

### Improvement Ideas
- [suggestion]

RETROEOF
```

---

## Handoff (MANDATORY before completing or when blocked)

```bash
mkdir -p .worktrees/.handoff
cat > .worktrees/.handoff/graph-tools-integration.md <<'HANDOFF'
# Sprint: graph-tools-integration — Handoff

## Summary
- [What was accomplished]

## Remaining
- [What's left, or "(none)"]

## Issues
- [Blockers/concerns, or "(none)"]

## Next Steps
- [How to verify the full pipeline end-to-end]
HANDOFF
```

---

## Agent Input Requests (Optional)

```bash
source ~/.claude/scripts/agent-handoff.sh
export SPRINT_NAME="graph-tools-integration"
```

---

## Decision Log (Context Recovery)

```bash
LOGS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-logs}"
LOGS_DIR="${LOGS_DIR%/.sprint-status}/.sprint-logs"
mkdir -p "$LOGS_DIR"
```

---

## Activity Log (Observability)

```bash
LOGS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-logs}"
LOGS_DIR="${LOGS_DIR%/.sprint-status}/.sprint-logs"
mkdir -p "$LOGS_DIR"
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","event":"phase_transition","phase":"Starting","detail":"Sprint launched"}' >> "$LOGS_DIR/graph-tools-integration.jsonl"
```

---

## Notes for Agent

- Read Sprint 1's handoff file before starting — it describes the API surface you're consuming
- The `CodeIndexer.getCollectionName()` method is private. **Resolution**: Change its visibility from `private` to `public` (it's a pure function with no side effects — safe to expose). The graph tools need it to derive the collection name → SQLite DB path from a codebase path. Do NOT duplicate the logic — call it on the existing CodeIndexer instance.
- Tool descriptions must use agent vocabulary ("sprint decomposition", "blast radius") not database terms
- The output formatting should match the style of existing tools in `tools/code.ts` — structured text, not JSON
