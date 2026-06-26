# Universal Context Protocol

`Larpkeeper` is agent-runtime neutral. It is not a Codex-only skill.

Preferred commands: `larp` or `larpkeeper`.
Legacy compatibility alias: `context-gardener`.

## Goal

Keep project context useful by balancing:

- not enough context: agents miss source-of-truth files, current state, decisions, or memory;
- too much context: agents read old transcripts, duplicated rules, obsolete audits, or conflicting instructions.

## Standard Layers

1. `CONTEXT_INDEX.md`: routing map and source priority.
2. `CURRENT_STATE.md`: current product/runtime truth.
3. `WORKLOG.md`: compact recent session continuity.
4. `DECISIONS.md`: adopted decisions.
5. `CONTEXT_JOURNAL.md`: maintenance log.
6. `archive/context-heavy/`: cold storage.
7. external memory: Hermes/Graphiti/Obsidian, lower priority than active repo docs.
8. task completion memory: project-local completion hook when installed, writing repo worklog plus Obsidian/Graphiti durable facts.
9. owner address form: setup should record how to address the human, so every prompt/update/report/final answer stays visibly tied to the right owner.

## Agent Adapters

Adapters are thin instructions for different runtimes:

- `adapters/codex/SKILL.md`
- `adapters/claude/CLAUDE_CONTEXT_BLOCK.md`
- `adapters/agents/AGENTS_CONTEXT_BLOCK.md`

Adapters must not contain project truth. They only route agents to the CLI and active docs.

## Operations

- `audit`: diagnose missing/bloated/stale/duplicated context.
- `doctor`: check the 10 context-health goals.
- `budget`: show default-start or task-pack context cost.
- `savings`: show token savings/ROI in short form.
- `caveman`: produce an ultra-compact startup layer.
- `score`: rank files by role, authority, risk, read cost, and recommendation.
- `gather`: build a task-specific context pack.
- `repo-map`: build a compact source-code map for the task before opening many files.
- `codex-preflight`: one-shot Codex session starter with pack, repo-map, tool guard, and budget.
- `semantic-search`: semantic-lite local code search by query, symbols, imports, and path.
- `tool-guard`: emit safe limits for searches, logs, tool output, and subagent fan-out.
- `compress-output`: summarize/redact noisy command output before it enters chat memory.
- `run`: execute a command while storing raw stdout/stderr and printing a compressed summary.
- `token-burn`: show safe aggregate context/token burn from allowlisted local sources.
- `init`: create missing standard files.
- `setup`: one-command bootstrap + adapter install, optionally shell prompt hook.
- `bootstrap`: create the project context skeleton.
- `pack`: emit minimal read list for a task.
- `prune`: propose archive/split/update actions.
- `maintain`: safe upkeep for missing docs, long handoffs, and journal notes.
- `fix-safe`: safe maintenance alias.
- `recommend` / `next`: suggest the next best command.
- `watch`: quick warning when context is getting heavy.
- `profile-sync`: sync bundled profiles and docs.
- `compact-handoff`: rotate large handoff files into archive and keep a continuation handoff.
- `pressure`: estimate chat/context pressure and tell the agent when to warn the user.
- `statusline`: print a prompt-sized console signal.
- `install-shell-hook`: add the zsh prompt integration.
- `compact-chat`: create a compact handoff draft before context compaction.
- `conflicts`: show stale-looking files, repeated instructions, and Hermes card drift.
- `journal`: append durable maintenance events.
- `finish`: close a session with done/next/evidence and memory candidates.
- project-local `scripts/task-done.sh`: close meaningful feature/fix/deploy work with one structured completion record when installed.
- `setup --owner-name "..."`: store the owner address form in the adapter so context loss or confused behavior is visible when the address disappears or changes.

Graphiti/Hermes writes are not a standalone command yet. They are gated behind explicit `--apply --graphiti` on supported write operations.

## Safety

No destructive default. `--apply` is required for writes that alter a target project.

## Write Policy

Most operations are ephemeral reports. They print to chat/terminal and do not create project files.

Allowed writes:

- standard bootstrap files from `init --apply`;
- adapter pointer from `install-adapter --apply`;
- archive + compact handoff from `compact-handoff --apply`;
- explicit session notes from `journal --apply` or `finish --apply`;
- compact draft from `compact-chat --apply`.
- project task completion records from `scripts/task-done.sh` or `npm run task:done` when that hook is installed.

## Completion Destination Policy

- Repo md: operational detail, full worklog, current state changes, decisions, tests, deploy notes, source paths.
- Obsidian: durable human memory, owner preferences, cross-project summaries, long-lived decisions, links back to repo docs.
- Graphiti: compact machine-readable sourced facts only, with confidence/currentness; no raw logs or transcripts.
- Chat/DM: concise rich Markdown for the owner with what changed, checks, deploy status, and next step.
- For a Russian-speaking owner, write worklogs and user-facing reports in Russian unless asked otherwise.
- Do not omit important completed work, failures, verification gaps, deploy status, decisions/blockers, or next steps.

Everything else should be dry-run/report-only until the human requests application.

## Token Economy

The tool should save more tokens than it consumes. Hook integrations should use `--brief` or `--json`, not verbose markdown output. See `docs/TOKEN_ECONOMY.md`.

Before broad source reading, broad `rg --files`, long logs, or multi-agent work, agents should run:

```bash
larp pack . --task "..."
larp repo-map . --task "..."
larp tool-guard . --task "..."
```

Then they should read only the returned docs/source files, expand through exact searches, and keep command output near the guard limits.

For Codex sessions, prefer:

```bash
larp codex-preflight . --task "..."
```

For noisy command output, pipe or save output through:

```bash
larp compress-output . --file log.txt
```

To run noisy commands through the compressor:

```bash
larp run . -- npm test
```

For burn analysis:

```bash
larp token-burn . --since today
```

## Ten Health Goals

1. Agents should not read everything by default.
2. Important research should be archived, not lost.
3. Every major file should have one role.
4. `handoff.md` should stay a compact continuation file.
5. Skills/adapters should route, not duplicate product truth.
6. Graphiti should receive only durable sourced facts.
7. Contradictions should be visible before implementation.
8. Migrations should separate research, runtime contract, and parity.
9. New sessions should start from a small context pack.
10. Projects should improve after each session through journal/update.
11. Meaningful completed work should leave a simple structured completion: what was done, what became better, evidence/tests, deploy status, and next step.
12. Agents should address the owner by the configured name in every user-facing prompt/update/report/final answer.
13. Agents should use `repo-map` and `tool-guard` before wide code/log exploration.
14. Agents should compress noisy tool output before putting it into chat, worklog, Obsidian, or Graphiti.
15. Token accounting should use safe aggregates and deny raw secrets/auth/prompt bodies by default.
