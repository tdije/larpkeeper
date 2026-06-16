# Install

`Larpkeeper` is designed to be used three ways.

## 1. Local CLI

Run from the repo:

```bash
larp audit .
```

Or link it:

```bash
npm link
larp audit .
```

## 2. Project Bootstrap

One-command project setup:

```bash
larp setup /path/to/project --apply
```

This creates standard context files, writes `docs/AGENT_CONTEXT.md`, and inserts a managed Larpkeeper block into `AGENTS.md`.
Use `--target claude` to install the same flow for `CLAUDE.md`.

For an OMC-like console signal in zsh:

```bash
larp setup /path/to/project --apply --shell-hook
```

This adds a managed block to `~/.zshrc` and shows `larp statusline "$PWD"` in the right prompt.
It does not give Larpkeeper access to the host chat's true token percentage unless the host/hook passes those numbers into `larp pressure`.

## 3. Agent Adapters

Use adapter text from:

- `adapters/agents/AGENTS_CONTEXT_BLOCK.md`
- `adapters/claude/CLAUDE_CONTEXT_BLOCK.md`
- `adapters/codex/SKILL.md`

Codex can also install the bundled `larpkeeper` skill from `skills/context-gardener`.
