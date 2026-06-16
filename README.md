# Larpkeeper

Larpkeeper is a vendor-neutral context maintainer for agent-heavy repos.
It keeps project memory small, current, and readable: what matters now, what can wait, and what should stay in archive.

## What It Does

- audits context health before broad reading;
- packs a small profile-aware file set for a task;
- scaffolds, audits, and journals the context files agents should use;
- adds thin adapters for AGENTS, Claude, and Codex-style runtimes;
- warns when context is bloated or stale.

## Why It Exists

Agent projects tend to collect too many notes, too many rules, and too much old history.
Larpkeeper turns that into a short operating layer so the next session starts from the right files instead of the whole attic.

## Quick Start

```bash
larp audit /path/to/project
larp recommend /path/to/project
larp pack /path/to/project --task "fix webapp"
```

For setup:

```bash
larp setup /path/to/project --apply
```

## Install

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/tdije/larpkeeper/main/install.sh | bash
```

Or with npm:

```bash
npm install -g github:tdije/larpkeeper
```

## Main Commands

```bash
larp audit /path/to/project
larp pitch /path/to/project
larp recommend /path/to/project
larp pack /path/to/project --task "..."
larp prune /path/to/project
larp doctor /path/to/project
larp pressure /path/to/project --brief
larp setup /path/to/project --apply
larp bootstrap /path/to/project --apply
larp journal /path/to/project --type session --note "..." --apply
```

Aliases:
`larpkeeper`, `larp`, `lorekeeper`, `lore`, `context-gardener`

## Included

- JSON project profiles
- compact context index
- current state and worklog files
- journal and archive policy scaffolding
- source ranking and budget reports
- zsh statusline hook
- Codex / Claude / AGENTS adapters

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
