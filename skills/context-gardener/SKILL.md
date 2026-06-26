---
name: larpkeeper
description: Use when a project has too little, too much, stale, duplicated, or conflicting context across markdown files, AGENTS/CLAUDE instructions, local skills, migration notes, handoffs, worklogs, Hermes, Graphiti, or Obsidian. Provides a vendor-neutral CLI workflow to audit, initialize, pack, prune, and journal project context.
---

# Larpkeeper

Lean adapter for the vendor-neutral `Larpkeeper` CLI. Do not read broad project context first; run a cheap report and then read only ranked sources.

## Commands

```bash
larp audit /path/to/project
larp codex-preflight /path/to/project --task "..."
larp pack /path/to/project --task "..."
larp repo-map /path/to/project --task "..."
larp tool-guard /path/to/project --task "..."
larp semantic-search /path/to/project --query "..."
larp compress-output /path/to/project --file log.txt
larp run /path/to/project -- npm test
larp token-burn /path/to/project --since today
larp spend-guard /path/to/project --since today
larp recommend /path/to/project
larp maintain /path/to/project --apply
larp budget /path/to/project --brief
larp watch /path/to/project
larp compile-memory /path/to/project --apply
larp workflow-status /path/to/project
larp automation-plan /path/to/project
```

If the binary is not installed, run `node "$LARPK_HOME/bin/context-gardener.mjs" ...` with `LARPK_HOME` pointing at this repo.

Use `--apply` only when the user wants files created or changed.

Language policy:

- In Russian chats, pass `--lang ru` to human-facing Larpkeeper commands when practical (`audit`, `recommend`, `budget`, `token-burn`, `doctor`, `watch`) and summarize results in Russian.
- In English chats, pass `--lang en` or omit it when the surrounding task is English.
- Human reports should include payoff numbers when available: what was saved, what improved, percent/line/token reduction, and the next highest-leverage cleanup.

Cost pressure policy:

- If the user mentions tokens, spend, cost, burn, a high model bill, or expensive parallel agents, switch to cost-guard mode before doing more exploration.
- Run `larp token-burn <project> --since today --lang ru` for Russian chats, then `larp tool-guard <project> --task "..."`; report local estimates separately from real provider billing.
- Do not spawn more than one subagent, run broad search, read long logs, or use xhigh/opus-class model lanes until the burn source is scoped and the user approves the higher-cost path.
- Prefer `codex-preflight`, `pack`, `repo-map`, exact searches, and `larp run` summaries. Avoid raw terminal dumps.
- Explain savings in human terms: what used to be loaded, what is loaded now, what was skipped/compressed, and why that reduces future spend.

During setup, prefer passing `--owner-name "..."`. Explain that the name is stored in the managed adapter so agents address the human consistently in every prompt/update/report/final answer; if context drifts or the agent starts acting confused, the missing or wrong address is visible immediately.

If a project has Metis task completion memory installed, prefer closing meaningful work with the project-local command:

```bash
npm run task:done -- --title "What changed" --result "What became better" --files "..." --tests "..."
```

This keeps repo worklog, Obsidian, and Graphiti aligned. Write entries in simple structured language for the project owner. For a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise. Do not omit important facts: include what was done, what became better, evidence/tests, deploy status, decisions/blockers, and next step. Do not paste raw terminal logs or chat transcripts.

Destination policy:

- repo md: operational detail, full worklog, current state changes, decisions, tests, deploy notes, source paths;
- Obsidian: durable human memory, owner preferences, cross-project summaries, long-lived decisions, links back to repo docs;
- Graphiti: compact machine-readable sourced facts only, with confidence/currentness; no raw logs or transcripts;
- chat/DM: concise rich Markdown for the owner with what changed, checks, deploy status, and next step.

## Agent Workflow

When Larpkeeper is relevant, use it as the context gate before broad reading:

1. Run `larp audit <project>` and show the user the useful parts: health, cleanup potential, missing files, and next command.
2. Run `larp codex-preflight <project> --task "..."` at the start of coding work when the task is known.
3. Run `larp recommend <project>` when the next step is unclear.
4. Run `larp pack <project> --task "..."` before implementation, then read only that pack plus touched files.
5. Run `larp repo-map <project> --task "..."` before broad source reading. Use the returned source files as the first code map, then expand only through exact searches.
6. Run `larp semantic-search <project> --query "..."` before doing repeated broad `rg` attempts.
7. Run `larp tool-guard <project> --task "..."` before long logs, broad searches, or multi-agent work; obey its output limits unless the user explicitly asks for a deeper dump.
8. Run `larp compress-output <project> --file log.txt` before pasting large command output into chat/memory.
9. Prefer `larp run <project> -- <command>` for commands that may produce long output; it stores raw logs and prints a compressed summary.
10. Run `larp token-burn <project> --since today` when the user asks where tokens/context were spent.
10a. Run `larp spend-guard <project> --since today` when spend is high; apply cost-guard mode: stop fan-out, avoid expensive models unless explicitly approved, and use scoped packs before reading more.
11. Run `larp budget <project> --query "..." --brief` when the user asks what is being saved.
12. Run `larp workflow-status <project>` when the user asks whether the durable audit -> pack -> work -> finish -> compile loop is in place.
13. Run `larp automation-plan <project>` before installing scheduled/pressure maintenance; keep it guarded and never auto-delete/prune.
14. Run `larp compile-memory <project> --apply` when the user wants raw worklogs/journals compiled into a short current-truth layer. Use `--apply` only when writes were requested.
15. Run `larp maintain <project> --apply`, `larp bootstrap <project> --apply`, or `larp compact-handoff <project> --apply` only when the user explicitly wants context files changed.
16. Run `larp finish <project> --done "..." --next "..." --evidence "..." --apply` at the end of meaningful context-maintenance work.
17. If `scripts/task-done.sh` exists, suggest or run it after completed project work so the repo worklog, Obsidian, and Graphiti receive the same durable completion entry.

Default chat behavior after audit:

- lead with a value summary, not a dry file list;
- include the actual numbers: markdown files, broad scan lines, default-start lines, avoided lines/tokens, saved percent;
- translate numbers into impact: faster startup, less stale-doc drift, lower token burn, fewer contradictory instructions;
- state whether the estimate is `default-start` or `task-pack`;
- name the top 2-4 risks and why they matter;
- propose the next safe command and what it will change;
- explain missing context files as capabilities, for example: `CONTEXT_INDEX.md` = routing map, `CURRENT_STATE.md` = current truth, `CONTEXT_JOURNAL.md` = durable maintenance log;
- ask before any `--apply` write unless the user already requested it.

Good audit response shape:

```text
Larpkeeper говорит: проект можно стартовать примерно с 517 строк вместо 29 582. Это не удаление контекста, а экономия чтения: около 98% широкого markdown не нужно тащить в первый заход.

Почему это важно:
- агент быстрее стартует и меньше ошибается из-за старых docs;
- дешевле по токенам: ~532k -> ~9k на default start;
- меньше конфликтов между AGENTS/CLAUDE/docs;
- следующие сессии будут понимать, где current truth.

Главные проблемы:
- missing CONTEXT_INDEX/WORKLOG/JOURNAL: нет нормальной карты и журнала;
- large active docs: старые runbook/market/audit могут случайно стать "истиной";
- many agent entry surfaces: инструкции могут спорить друг с другом.

Безопасный следующий шаг:
`larp bootstrap <project> --apply` создаст недостающие стандартные docs. Ничего не удаляет.
```

## Load References Only When Needed

- source roles: `references/source-roles.md`
- archive/split docs: `references/archive-policy.md`
- router cleanup: `references/router-template.md`
- Graphiti/Hermes sync: `references/graphiti-bridge.md`
- situational md taxonomy: `references/file-taxonomy.md`
- handoff compaction: `references/handoff-policy.md`
- chat pressure hooks: `docs/CHAT_PRESSURE_MONITOR.md`

## Rules

- Do not solve bloat by reading everything.
- Do not run broad `rg --files`, broad `rg`, long container logs, or more than one subagent until `pack` and `repo-map` have scoped the task.
- Keep command output near `tool-guard` limits: exact searches first, logs at about 80 lines, and compact summaries instead of raw dumps.
- Do not scan `~/.codex`, auth backups, `.env`, or secrets with broad search. Token accounting must use allowlisted aggregates only.
- Compress noisy output before writing chat, repo worklog, Obsidian, or Graphiti.
- Active docs should answer what to do now.
- Skills/adapters should route to sources, not duplicate product truth.
- Archive research; do not delete it.
- Keep Graphiti durable and sourced; do not dump raw transcripts into it.
- Record every applied context change in the journal.
- For completed feature/fix/deploy work, prefer the project task-memory hook when available; it writes repo worklog plus Obsidian/Graphiti memory in one step.
- Do not let worklog summaries drop important completed work, failures, verification gaps, deploy status, or next steps.
- Keep new feature outputs ephemeral unless `--apply` is explicitly used.
