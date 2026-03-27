# Graph Foundation — Types, Extractor, Storage, Clusters

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
- **Worktree**: /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-foundation/ (all work happens here)
- **Branch**: feature/graph-foundation
- **Base Branch**: feature/code-graph-db
- **MODEL**: opus
- **AUTHORIZED_ENV**: dev
- **Related Docs**: `docs/specs/code-graph-db/requirements.md`, `docs/specs/code-graph-db/design.md`, `docs/specs/code-graph-db/tasks.md`

---

## Startup Confirmation (MANDATORY — do this FIRST)

```bash
STATUS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-status}"
mkdir -p "$STATUS_DIR"
cat > "$STATUS_DIR/graph-foundation.status" <<STATUSEOF
PHASE=Starting
STATUS=RUNNING
MESSAGE=Agent confirmed startup, beginning work
MODEL=${CLAUDE_MODEL:-opus}
UPDATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUSEOF
```

---

## Objectives

1. Enable the AI coordinator to understand code structure by creating the complete `src/graph/` module — types, config, AST relationship extractor, SQLite storage, and cluster analysis
2. Add `better-sqlite3` dependency to `package.json`
3. Achieve comprehensive test coverage for all new modules
4. Establish patterns for tree-sitter AST traversal across 7 languages so Sprint 2 can wire them into MCP tools

---

## Requirements & Notes

### From Requirements Doc

- **REQ-001**: Extract `calls`, `imports`, `extends`, `implements`, `uses_type` relationships from ASTs for Go, Python, TypeScript, JavaScript, Bash, Rust, Java
- **REQ-002**: Store in embedded SQLite via `better-sqlite3`. DB at `~/.qdrant-mcp/graph/{collectionName}.db`. Incremental updates. Zero external services.
- **REQ-005**: Dependency clusters via connected-components on file-level graph
- **REQ-009**: Configuration via `CODE_ENABLE_GRAPH` (default true), `CODE_GRAPH_MAX_DEPTH` (default 10)

### Technical Notes

- Reuse tree-sitter parser instances from `TreeSitterChunker` — same 7 languages are already initialized
- Node IDs: deterministic SHA256 hash of `filePath:name:nodeType:startLine` (first 16 chars)
- Edge target_id may be unresolved (external dependency) — store as `unresolved:{name}`
- Name validation: `/^[a-zA-Z_$][a-zA-Z0-9_$.*]*$/` — discard names failing regex
- Multi-hop traversal uses application-side `Set<string>` for cycle prevention, NOT recursive CTEs with string LIKE
- Cluster analysis uses `SELECT DISTINCT source_file, target_file FROM edges` — scale guard at 50K pairs

---

## Constraints

### General
- Follow existing code patterns and conventions in qdrant-mcp-server
- Use pino logger (child loggers per component)
- All new modules go under `src/graph/`
- TypeScript strict mode compliance

### Security
- All SQLite queries use parameterized statements (prepared statements via `better-sqlite3`)
- Validate node names against regex before storage
- No string interpolation in SQL

---

## Test Commands

### Quick Iteration Command
```
npx vitest run src/graph/
```

### Relevant Test Files
- `src/graph/__tests__/types.test.ts`
- `src/graph/__tests__/config.test.ts`
- `src/graph/__tests__/extractor.test.ts`
- `src/graph/__tests__/storage.test.ts`
- `src/graph/__tests__/clusters.test.ts`

FULL_SUITE_APPROVED: false

---

### Test Execution Rules — MANDATORY, NO EXCEPTIONS

1. **Run ONLY the Relevant Test Files listed above.** Do not discover, add, or substitute tests.
2. **NEVER run the full suite** unless `FULL_SUITE_APPROVED: true` is set above by Opus.
3. **NEVER delegate test execution to a sub-agent.** Only the main sprint agent runs tests.
4. **Before running any test**, update your status file MESSAGE.
5. **If Relevant Test Files is empty, contains `[TBD]`, or is missing:** Set `STATUS=NEEDS_APPROVAL` immediately.

---

## Testing Strategy

- **Unit tests**: Each module gets its own test file under `src/graph/__tests__/`
- **Test isolation**: SQLite storage tests use in-memory DB (`:memory:`) for speed and isolation
- **Language coverage**: Extractor tests include real code samples for all 7 languages
- **Edge cases**: Cycle detection, empty files, invalid names, oversized graphs

---

## Inline Context

Key type definitions and interfaces this sprint will work with.

### src/code/types.ts (existing CodeChunk)
```typescript
export interface CodeChunk {
  content: string;
  startLine: number;
  endLine: number;
  metadata: {
    filePath: string;
    language: string;
    chunkIndex: number;
    chunkType?: "function" | "class" | "interface" | "block";
    name?: string;
  };
}
```

### src/code/chunker/tree-sitter-chunker.ts (language configs)
```typescript
// Languages already initialized with tree-sitter parsers:
// typescript, javascript, python, go, rust, java, bash
// Chunkable types per language — see initializeParsers() for full list
// The extractor needs to traverse MORE node types than the chunker
// (chunker only finds top-level definitions; extractor needs call sites, imports, type refs)
```

### src/code/chunker/base.ts (CodeChunker interface pattern)
```typescript
export interface CodeChunker {
  chunk(code: string, filePath: string, language: string): Promise<CodeChunk[]>;
  supportsLanguage(language: string): boolean;
  getStrategyName(): string;
}
```

---

## Orchestration Rules

### Code Search (Main Process Only)
```
Sub-agents do NOT have MCP access - provide them file paths directly.
Read existing source files to understand patterns before delegating.
```

### Sub-Agent Delegation
Every sub-agent prompt MUST include:
1. **Objective**: Clear, specific task
2. **Files**: Explicit paths to read/modify (use worktree paths)
3. **Constraints**: Rules that apply
4. **Testing**: What to verify
5. **Completion Criteria**: What "done" looks like

### Working Directory
All work happens inside the worktree:
- RIGHT: `/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-foundation/src/graph/types.ts`
- WRONG: `/Users/vhiekin/projects/_tools/qdrant-mcp-server/src/graph/types.ts`

### Branch / Commit Discipline (CRITICAL)
```bash
cd /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/graph-foundation
git branch --show-current   # must print: feature/graph-foundation
```

### Parallel Execution
- Launch TASK-1 (types/config) first — it has no dependencies
- Then launch TASK-2 (extractor) and TASK-3 (storage) in parallel — both depend only on types
- Then TASK-5 (clusters) — depends on storage

### Model Selection
- Sub-agents for implementation: `model: "sonnet"`
- Sub-agents for complex AST traversal logic design: `model: "opus"`

### Status Reporting
```bash
STATUS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-status}"
mkdir -p "$STATUS_DIR"
cat > "$STATUS_DIR/graph-foundation.status" <<STATUSEOF
PHASE=[current phase name]
STATUS=[RUNNING|NEEDS_APPROVAL|BLOCKED|COMPLETE]
MESSAGE=[brief description]
MODEL=${CLAUDE_MODEL:-opus}
UPDATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUSEOF
```

---

## Implementation Order

### Phase 1: Types and Config (TASK-1)
1. Create `src/graph/types.ts` — all type definitions (GraphNode, GraphEdge, RelationshipType, NodeType, GraphStats, CallChain, ImpactResult, Cluster, SharedNode, GraphConfig)
2. Create `src/graph/config.ts` — parseGraphConfig() from env vars, defaults
3. Write unit tests for config parsing

### Phase 2: AST Relationship Extractor (TASK-2)
1. Read existing `src/code/chunker/tree-sitter-chunker.ts` to understand parser initialization pattern
2. Create `src/graph/extractor.ts` — RelationshipExtractor class
3. Implement language-specific extraction for each of 7 languages:
   - **TypeScript**: `import_statement` (module specifier), `call_expression` (function + receiver), `extends_clause`, `implements_clause`, type annotations in parameters/return types
   - **JavaScript**: Same as TS minus type annotations
   - **Go**: `import_declaration` (package paths), `call_expression` (with receiver for methods like `s.db.Insert()`), interface embedding in type declarations
   - **Python**: `import_statement`, `import_from_statement`, `call` (with attribute access for methods), class bases in `class_definition`
   - **Rust**: `use_declaration`, `call_expression`, `macro_invocation`, `impl_item` with trait reference
   - **Java**: `import_declaration`, `method_invocation`, `superclass`, `super_interfaces`
   - **Bash**: `command` nodes (for `source`/`.`), `command_name` for function calls
4. Implement node name validation regex
5. Implement deterministic node ID generation (SHA256)
6. Write comprehensive tests per language with real code samples

### Phase 3: SQLite Storage (TASK-3)
1. Add `better-sqlite3` and `@types/better-sqlite3` to package.json
2. Create `src/graph/storage.ts` — GraphStorage class
3. Implement schema creation (nodes + edges tables with indexes)
4. Implement write operations (insertNodes, insertEdges, deleteByFiles) — all in transactions
5. Implement single-hop queries (getCallers, getCallees)
6. Implement multi-hop traversal (traceCallChain, getImpactRadius) — app-side Set for cycle prevention
7. Implement getSharedInterfaces, getStats
8. Write tests with in-memory SQLite (`:memory:` for test isolation)

### Phase 4: Cluster Analysis (TASK-5)
1. Create `src/graph/clusters.ts` — DependencyClusterAnalyzer
2. Implement connected-components via BFS on file-adjacency graph
3. Implement scale guard (>50K file pairs = error)
4. Write tests with synthetic graph data

### Phase 5: Integration Testing
1. Run all tests: `npx vitest run src/graph/`
2. Fix any failures
3. Verify TypeScript compiles: `npx tsc --noEmit`

---

## Code Review Checklist (Before Completing)

**Security:**
- [ ] All SQLite queries use parameterized statements
- [ ] Node names validated against regex before storage
- [ ] No string interpolation in SQL
- [ ] No secrets in logs

**Correctness:**
- [ ] Cycle detection works in multi-hop traversal (Set-based, not string)
- [ ] Incremental delete removes edges for both source and target files
- [ ] Unresolved edges stored with `unresolved:` prefix
- [ ] Empty/null names handled gracefully

**Testing:**
- [ ] Each language extractor has tests with real code samples
- [ ] Storage tests use in-memory SQLite for isolation
- [ ] Multi-hop traversal tested with cycles
- [ ] Cluster detection tested with isolated and bridged modules

---

## Success Criteria

- [ ] `src/graph/types.ts` — all types defined, TypeScript compiles
- [ ] `src/graph/config.ts` — parses env vars correctly
- [ ] `src/graph/extractor.ts` — extracts relationships for all 7 languages
- [ ] `src/graph/storage.ts` — CRUD + traversal operations work
- [ ] `src/graph/clusters.ts` — connected-components detection works
- [ ] `package.json` has `better-sqlite3` dependency
- [ ] All unit tests pass (`npx vitest run src/graph/`)
- [ ] TypeScript compiles clean (`npx tsc --noEmit`)

---

## Deliverables

- [ ] `src/graph/types.ts` (NEW)
- [ ] `src/graph/config.ts` (NEW)
- [ ] `src/graph/extractor.ts` (NEW)
- [ ] `src/graph/storage.ts` (NEW)
- [ ] `src/graph/clusters.ts` (NEW)
- [ ] `src/graph/__tests__/types.test.ts` (NEW)
- [ ] `src/graph/__tests__/config.test.ts` (NEW)
- [ ] `src/graph/__tests__/extractor.test.ts` (NEW)
- [ ] `src/graph/__tests__/storage.test.ts` (NEW)
- [ ] `src/graph/__tests__/clusters.test.ts` (NEW)
- [ ] `package.json` (MODIFIED — better-sqlite3)
- [ ] Code committed to `feature/graph-foundation`

---

## Retrospective (MANDATORY before completing)

```bash
mkdir -p docs/specs/code-graph-db
cat >> docs/specs/code-graph-db/retrospective.md <<'RETROEOF'

## graph-foundation Retrospective

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
cat > .worktrees/.handoff/graph-foundation.md <<'HANDOFF'
# Sprint: graph-foundation — Handoff

## Summary
- [What was accomplished — key changes, files modified]

## Remaining
- [What's left to do, or "(none)" if complete]

## Issues
- [Blockers, concerns, unexpected discoveries, or "(none)"]

## Next Steps
- [API surface: what functions/types are available for Sprint 2]
- [Key interfaces Sprint 2 needs to consume]
HANDOFF
```

---

## Agent Input Requests (Optional)

```bash
source ~/.claude/scripts/agent-handoff.sh
export SPRINT_NAME="graph-foundation"
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
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","event":"phase_transition","phase":"Starting","detail":"Sprint launched"}' >> "$LOGS_DIR/graph-foundation.jsonl"
```

---

## Notes for Agent

- The existing `TreeSitterChunker` in `src/code/chunker/tree-sitter-chunker.ts` shows exactly how to initialize parsers. The extractor should follow the same pattern but traverse MORE node types (the chunker only finds top-level definitions; the extractor needs call sites, imports, type references inside function bodies).
- `better-sqlite3` is synchronous — no need for async wrappers. This is a feature, not a limitation — it makes transactions and queries simpler.
- For cross-file edge resolution, this sprint does NOT need to resolve edges — that's Sprint 2's job when it wires up the GraphIndexer. This sprint just needs the storage and extractor APIs to support it.
- Test with real code samples from the qdrant-mcp-server codebase itself where possible (copy snippets into test fixtures).
