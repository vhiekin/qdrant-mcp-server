# Graph Workflow Templates — Agent Skill & Template Updates

## Agent Role

Act as an **implementer**. This is a simple text-editing sprint — add the specified sections to 3 existing markdown files. No code logic, no architecture decisions.

---

## Project Context

- **Project**: claude-workspace-config + projects root
- **Codebase**: /Users/vhiekin/projects
- **Worktree**: N/A (direct edits to config files, not a code worktree)
- **Branch**: N/A (config files are deployed via install.sh, not branched)
- **Base Branch**: N/A
- **MODEL**: haiku
- **AUTHORIZED_ENV**: dev

---

## Startup Confirmation (MANDATORY — do this FIRST)

```bash
STATUS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-status}"
mkdir -p "$STATUS_DIR"
cat > "$STATUS_DIR/graph-workflow-templates.status" <<STATUSEOF
PHASE=Starting
STATUS=RUNNING
MESSAGE=Agent confirmed startup, beginning template updates
MODEL=${CLAUDE_MODEL:-haiku}
UPDATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUSEOF
```

---

## Objectives

1. Add graph-assisted decomposition guidance to `/develop-feature` skill Phase 3
2. Add `impact_analysis` cross-sprint check to sprint prompt template code review checklist
3. Add graph tools reference to `~/projects/CLAUDE.md` semantic search section

---

## Requirements & Notes

### From Requirements Doc

- **REQ-012a**: `/develop-feature` Phase 3 must instruct coordinator to call `dependency_clusters` and `shared_interfaces` before assigning tasks to sprints
- **REQ-012b**: Sprint prompt template code review checklist must include `impact_analysis` for cross-sprint breakage
- **REQ-012c**: `CLAUDE.md` semantic search section must reference graph tools

### Exact Text to Add

The exact text for each addition is specified in the design document section "8. Coordinator Workflow Integration". Copy it verbatim.

---

## Constraints

- Do NOT restructure or reformat existing content in these files
- Only ADD new sections/bullets — do not modify existing text
- Preserve exact indentation and formatting of surrounding content

---

## Test Commands

### Quick Iteration Command
```
# No automated tests — verify via reading the files
cat ~/.claude/skills/develop-feature/SKILL.md | grep -c "dependency_clusters"
cat ~/.claude/templates/sprint-prompt-template.md | grep -c "impact_analysis"
cat ~/projects/CLAUDE.md | grep -c "Graph Analysis Tools"
```

### Relevant Test Files
N/A — text-only changes verified by grep

FULL_SUITE_APPROVED: false

---

## Testing Strategy

- **Verification by grep**: Confirm added text is present in each file
- **No automated test suite**: Text-only changes to markdown files
- **Syntax check**: Verify skill YAML frontmatter not broken after edit

---

## Implementation Order

### Step 1: Update `/develop-feature` skill (REQ-012a)

**File**: `/Users/vhiekin/projects/claude-workspace-config/skills/develop-feature/SKILL.md`
(This is the source of truth — deployed to `~/.claude/skills/develop-feature/SKILL.md` via install.sh)

**Where**: Inside Phase 3, after the "Sprint Decomposition (MANDATORY)" section header and before the "### Decomposition Rules" subsection.

**Add this subsection**:

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

### Step 2: Update sprint prompt template (REQ-012b)

**File**: `/Users/vhiekin/projects/claude-workspace-config/global/templates/sprint-prompt-template.md`

**Where**: Inside the "## Code Review Checklist (Before Completing)" section, under the "**Testing:**" sub-list, add a new bullet.

**Add this bullet**:

```markdown
- [ ] Cross-sprint impact: Run `impact_analysis` on each modified function/type.
      Verify no dependents exist in other active sprints' file sets.
```

### Step 3: Update CLAUDE.md (REQ-012c)

**File**: `/Users/vhiekin/projects/CLAUDE.md`

**Where**: After the "## Semantic Code Search (MANDATORY)" section's existing content (after the "**RIGHT:** Directly calling..." line), before the next `---` separator.

**Add this subsection**:

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

### Step 4: Deploy config changes

After editing source files in `claude-workspace-config`:

```bash
cd /Users/vhiekin/projects/claude-workspace-config
./install.sh
```

This deploys updated skills and templates to `~/.claude/`.

### Step 5: Verify

```bash
grep -c "dependency_clusters" ~/.claude/skills/develop-feature/SKILL.md
# Expected: >= 1

grep -c "impact_analysis" ~/.claude/templates/sprint-prompt-template.md
# Expected: >= 1

grep -c "Graph Analysis Tools" ~/projects/CLAUDE.md
# Expected: >= 1
```

---

## Orchestration Rules

### Code Search (Main Process Only)
Not applicable — this sprint edits markdown files only, no code search needed.

### Sub-Agent Delegation
Not applicable — single-agent sprint, all edits done directly.

### Parallel Execution
Steps 1-3 can be done in sequence (small edits, no parallelism needed).

### Model Selection
This sprint runs as haiku. No sub-agents needed.

### Working Directory
Edit source files in `claude-workspace-config` repo, then deploy via `install.sh`. For `CLAUDE.md`, edit directly at `~/projects/CLAUDE.md`.

### Status Reporting
```bash
STATUS_DIR="${STATUS_DIR:-/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-status}"
cat > "$STATUS_DIR/graph-workflow-templates.status" <<STATUSEOF
PHASE=[current phase]
STATUS=[RUNNING|COMPLETE]
MESSAGE=[brief description]
MODEL=${CLAUDE_MODEL:-haiku}
UPDATED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATUSEOF
```

---

## Code Review Checklist (Before Completing)

- [ ] `/develop-feature` skill still loads correctly (no YAML frontmatter broken)
- [ ] Sprint prompt template formatting is consistent with surrounding content
- [ ] CLAUDE.md section is under the right parent heading
- [ ] No existing text was modified or removed
- [ ] `install.sh` deployed successfully

---

## Success Criteria

- [ ] `/develop-feature` Phase 3 mentions `dependency_clusters` and `shared_interfaces`
- [ ] Sprint prompt template code review checklist mentions `impact_analysis`
- [ ] `CLAUDE.md` has "Graph Analysis Tools" subsection
- [ ] `install.sh` deployed without errors

---

## Deliverables

- [ ] `claude-workspace-config/skills/develop-feature/SKILL.md` (MODIFIED)
- [ ] `claude-workspace-config/global/templates/sprint-prompt-template.md` (MODIFIED)
- [ ] `~/projects/CLAUDE.md` (MODIFIED)

---

## Retrospective (MANDATORY before completing)

```bash
cat >> /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/code-graph-db/docs/specs/code-graph-db/retrospective.md <<'RETROEOF'

## graph-workflow-templates Retrospective

### Observations
- [observation 1]

### Prompt/Process Feedback
- [what was unclear or missing]

RETROEOF
```

---

## Handoff (MANDATORY before completing or when blocked)

```bash
mkdir -p /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.handoff
cat > /Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.handoff/graph-workflow-templates.md <<'HANDOFF'
# Sprint: graph-workflow-templates — Handoff

## Summary
- [Files modified, sections added]

## Remaining
- (none)

## Issues
- (none)
HANDOFF
```

---

## Agent Input Requests (Optional)

```bash
source ~/.claude/scripts/agent-handoff.sh
export SPRINT_NAME="graph-workflow-templates"
```

---

## Decision Log (Context Recovery)

```bash
LOGS_DIR="/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-logs"
mkdir -p "$LOGS_DIR"
```

---

## Activity Log (Observability)

```bash
LOGS_DIR="/Users/vhiekin/projects/_tools/qdrant-mcp-server/.worktrees/.sprint-logs"
mkdir -p "$LOGS_DIR"
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","event":"phase_transition","phase":"Starting","detail":"Sprint launched"}' >> "$LOGS_DIR/graph-workflow-templates.jsonl"
```
