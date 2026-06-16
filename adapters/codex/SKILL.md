---
name: larpkeeper
description: Use when project context is missing, bloated, contradictory, stale, or spread across markdown, AGENTS/CLAUDE files, Hermes, Graphiti, Obsidian, handoffs, worklogs, or local skills. Audits, initializes, prunes, packs, and journals project context using the vendor-neutral Larpkeeper CLI.
---

# Larpkeeper Adapter

This is the Codex adapter for the vendor-neutral `Larpkeeper` repo.

Use it when:

- the user asks to clean, organize, compress, gather, or audit project context;
- an agent seems confused by too many markdown files or old instructions;
- a project lacks `CONTEXT_INDEX.md`, `CURRENT_STATE.md`, decisions, worklog, or archive policy;
- Graphiti/Hermes/Obsidian memory conflicts with repo docs;
- you need a compact context pack before implementation.

## Core Rule

Do not solve context bloat by reading everything.

Run the CLI first, then read only the files it ranks as high signal.

## Commands

From the `Larpkeeper` repo:

```bash
larp audit /path/to/project
larp pitch /path/to/project
larp recommend /path/to/project
larp pack /path/to/project --task "..."
larp bootstrap /path/to/project
larp maintain /path/to/project
larp journal /path/to/project --type session --note "..."
```

If the binary is not installed, run `node "$LARPK_HOME/bin/context-gardener.mjs" ...`.

Use `--apply` only when the user explicitly wants files created or changed.

## Workflow

1. Run `audit` first.
2. Run `pitch` or produce the same value summary: before/default-start, avoided percent/tokens, why it matters, top risks, missing files, and next safe command.
3. Run `recommend` when the next maintenance move is unclear.
4. Run `pack --task "..."` before implementation and read only the returned files plus touched source files.
5. Run `budget --brief` when the user asks what token/context savings mean.
6. Run `bootstrap --apply`, `maintain --apply`, or `compact-handoff --apply` only when the user wants files changed.
7. Run `journal --apply` or `finish --apply` to record durable maintenance evidence.

## Source Priority

Trust sources in this order:

`runtime/code > active repo docs > handoff/worklog > Hermes project cards > Graphiti current rows > Obsidian/canonical notes > compact mirrors > raw old chats`

## Safety

- Never delete context automatically.
- Archive before removing from active docs.
- Keep active docs as indexes, not transcripts.
- Append journal entries for every applied context change.
- If Graphiti is enabled, append only durable facts and include source paths.
