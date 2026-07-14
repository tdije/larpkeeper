# Larpkeeper

Larpkeeper is a vendor-neutral context maintainer for agent-heavy repos.
It keeps project memory small, current, and readable: what matters now, what can wait, and what should stay in archive.

## What It Does

- audits context health before broad reading;
- packs a small profile-aware file set for a task;
- compiles raw worklogs/journals into a short current-truth layer;
- maps source code with task ranking, symbols, imports, related tests, and lightweight dependency signals;
- tracks a durable workflow shape: audit -> pack -> repo-map -> guard -> work -> finish -> verify -> compile;
- describes safe automation plans for scheduled audits, pressure checks, digest, and compacting;
- turns high token spend into a spend-guard plan with max agents, blocked expensive lanes, and next scoped commands;
- scaffolds, audits, and journals the context files agents should use;
- adds thin adapters for AGENTS, Claude, and Codex-style runtimes;
- warns when context is bloated or stale.

## Why It Exists

Agent projects tend to collect too many notes, too many rules, and too much old history.
Larpkeeper turns that into a short operating layer so the next session starts from the right files instead of the whole attic.

## New Agent Layers

Larpkeeper now borrows the useful parts of several proven agent patterns without forcing a project onto a heavy framework:

- **Karpathy-style context compiler**: raw worklogs and journals stay available, while `compile-memory` creates a short `docs/COMPILED_CONTEXT.md` with current truth, recent durable facts, touched files, next steps, memory rows, and budget.
- **Aider-style repo map v2**: `repo-map` ranks source files by task terms, symbols, size, recency, related tests, imports, and lightweight fan-in signals so agents inspect the right code first.
- **LangGraph-style durable workflow**: `workflow-status` shows whether the project has audit, pack, worklog, journal, compiled context, and guard state ready for long-running work.
- **OpenHands-style guarded automation**: `automation-plan` describes scheduled and pressure-triggered automation while keeping destructive actions out of automatic paths.

These commands are report-only by default. Commands that write files require `--apply`.

## Quick Start

```bash
larp audit /path/to/project
larp recommend /path/to/project
larp pack /path/to/project --task "fix webapp"
larp repo-map /path/to/project --task "fix webapp"
larp spend-guard /path/to/project --since today
larp compile-memory /path/to/project --apply
larp workflow-status /path/to/project
larp automation-plan /path/to/project
```

For setup:

```bash
larp setup /path/to/project --owner-name "Your Name" --apply
```

`--owner-name` records how agents should address the human in every prompt, update, report, and final answer. This is intentional: if an agent starts losing context or acting confused, the missing or wrong address form is visible immediately.

## Install

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/tdije/larpkeeper/main/install.sh | bash
```

Or with npm:

```bash
npm install -g github:tdije/larpkeeper
```

## Updates

Larpkeeper checks GitHub at most once per day during normal CLI use. If a newer version exists, it prints a short suggestion:

```bash
larp upgrade
```

Manual update commands:

```bash
larp check-update
larp upgrade
larp version
```

Disable the automatic check:

```bash
LARPK_NO_UPDATE_CHECK=1 larp audit .
```

## Main Commands

```bash
larp audit /path/to/project
larp pitch /path/to/project
larp recommend /path/to/project
larp pack /path/to/project --task "..."
larp prune /path/to/project
larp runs-prune /path/to/project --keep-days 14 --keep-last 20
larp conflicts /path/to/project --json --structured
larp doctor /path/to/project
larp pressure /path/to/project --brief
larp repo-map /path/to/project --task "..."
larp token-burn /path/to/project --since today
larp spend-guard /path/to/project --since today
larp compile-memory /path/to/project --apply
larp workflow-status /path/to/project
larp automation-plan /path/to/project
larp setup /path/to/project --apply
larp bootstrap /path/to/project --apply
larp journal /path/to/project --type session --note "..." --apply
larp finish /path/to/project --done "..." --next "..." --evidence "..." --apply
```

`runs-prune` is dry-run by default and only considers `run-*` artifacts. It keeps complete run groups, including stdout/stderr/metadata siblings; pass `--apply` only after reviewing the candidate list.

`conflicts --json` keeps the legacy array response. Use `--json --structured` for version 2 output with separate `semanticConflicts`, `consistencyHints`, and `duplicationHints` fields.

Aliases:
`larpkeeper`, `larp`, `lorekeeper`, `lore`, `context-gardener`

## Included

- JSON project profiles
- compact context index
- current state and worklog files
- journal and archive policy scaffolding
- source ranking and budget reports
- compiled context cards
- repo-map v2 with symbols/imports/tests/signals
- durable workflow status reports
- guarded automation plans
- zsh statusline hook
- Codex / Claude / AGENTS adapters

## Command Highlights

### `compile-memory`

Turns append-only operational history into a compact compiled layer:

```bash
larp compile-memory . --apply
```

Writes `docs/COMPILED_CONTEXT.md` with current truth, recent durable facts, touched files, next/open loops, memory rows, and context budget. Full raw worklogs remain in the repo or archive; the compiled file is the lightweight starting point for future agents.

### `repo-map`

Builds a task-focused map of source files:

```bash
larp repo-map . --task "fix publishing channel routing"
```

The map includes paths, line counts, symbols, imports, related tests, and signals such as recent/small/imported-by. It is meant to replace broad source dumps before coding.

### `workflow-status`

Shows whether the durable work loop is ready:

```bash
larp workflow-status .
```

Expected loop:

```text
audit -> pack -> repo-map -> tool-guard -> work -> finish -> verify -> compile-memory
```

### `automation-plan`

Shows the safe automation design for a project:

```bash
larp automation-plan .
```

The plan separates read-only maintenance from guarded write steps. It should never auto-delete or auto-prune without explicit human approval.

### `spend-guard`

Turns token pressure into an operating mode:

```bash
larp spend-guard . --since today --lang ru
```

It reuses safe `token-burn` aggregates without printing raw prompt/log bodies, then reports local burn estimate, avoidable startup context, max parallel agents, whether expensive model lanes need explicit approval, what is blocked by default, and the next scoped commands.

When a project has a task completion hook such as `scripts/task-done.sh`, use it after meaningful completed work to keep repo worklog, Obsidian, and Graphiti aligned. Write simple structured entries: what was done, what became better, evidence/tests, deploy status, decisions/blockers, and next step. For a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise.

Destination policy:

- repo md: operational detail, full worklog, current state changes, decisions, tests, deploy notes, source paths;
- Obsidian: durable human memory, owner preferences, cross-project summaries, long-lived decisions, links back to repo docs;
- Graphiti: compact machine-readable sourced facts only, with confidence/currentness; no raw logs or transcripts;
- chat/DM: concise rich Markdown for the owner with what changed, checks, deploy status, and next step.

## Repo Structure

- `bin/context-gardener.mjs` - CLI
- `profiles/` - project profiles
- `docs/` - compact operating docs
- `adapters/` - runtime-specific context blocks
- `skills/` - Codex skill bundle

## Quality Gate

```bash
npm test
node --check bin/context-gardener.mjs
```
