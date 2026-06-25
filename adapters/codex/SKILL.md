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
larp repo-map /path/to/project --task "..."
larp tool-guard /path/to/project --task "..."
larp bootstrap /path/to/project
larp maintain /path/to/project
larp journal /path/to/project --type session --note "..."
```

If the binary is not installed, run `node "$LARPK_HOME/bin/context-gardener.mjs" ...`.

Use `--apply` only when the user explicitly wants files created or changed.

During setup, prefer `--owner-name "..."`. Explain that this stores how to address the human in the managed adapter; agents should use that name in every user-facing prompt, update, report, and final answer, so context loss or confused behavior becomes visible immediately.

When a project has `scripts/task-done.sh`, close meaningful completed work with:

```bash
npm run task:done -- --title "What changed" --result "What became better" --files "..." --tests "..."
```

Use plain structured language for the project owner. For a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise. Do not omit important facts: what was done, what became better, evidence/tests, deploy status, decisions/blockers, and next step. Do not paste raw logs or transcripts.

Destination policy:

- repo md: operational detail, full worklog, current state changes, decisions, tests, deploy notes, source paths;
- Obsidian: durable human memory, owner preferences, cross-project summaries, long-lived decisions, links back to repo docs;
- Graphiti: compact machine-readable sourced facts only, with confidence/currentness; no raw logs or transcripts;
- chat/DM: concise rich Markdown for the owner with what changed, checks, deploy status, and next step.

## Workflow

1. Run `audit` first.
2. Run `pitch` or produce the same value summary: before/default-start, avoided percent/tokens, why it matters, top risks, missing files, and next safe command.
3. Run `recommend` when the next maintenance move is unclear.
4. Run `pack --task "..."` before implementation and read only the returned files plus touched source files.
5. Run `repo-map --task "..."` before broad source reading; expand from that map through exact `rg -n` searches only.
6. Run `tool-guard --task "..."` before long logs, broad searches, or multi-agent work and keep outputs inside its recommended limits.
7. Run `budget --brief` when the user asks what token/context savings mean.
8. Run `bootstrap --apply`, `maintain --apply`, or `compact-handoff --apply` only when the user wants files changed.
9. Run `journal --apply` or `finish --apply` to record durable maintenance evidence.
10. If `scripts/task-done.sh` exists, use or suggest it after completed project work so repo worklog, Obsidian, and Graphiti stay aligned.

## Source Priority

Trust sources in this order:

`runtime/code > active repo docs > handoff/worklog > Hermes project cards > Graphiti current rows > Obsidian/canonical notes > compact mirrors > raw old chats`

## Safety

- Never delete context automatically.
- Do not run broad `rg --files`, broad `rg`, long container logs, or more than one subagent before `pack` and `repo-map`.
- Prefer exact searches and compact log tails around 80 lines; summarize raw outputs instead of copying them into chat/memory.
- Archive before removing from active docs.
- Keep active docs as indexes, not transcripts.
- Append journal entries for every applied context change.
- Prefer project-local task completion memory for completed feature/fix/deploy work when available.
- Do not let worklog summaries drop important completed work, failures, verification gaps, deploy status, or next steps.
- If Graphiti is enabled, append only durable facts and include source paths.
