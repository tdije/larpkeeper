# Context Journal

This file records durable context maintenance events only.

- 2026-06-15: Added self-dogfood docs, bundled profiles, and compact context routing.

### 2026-06-26T10:59:35.453Z - finish

Done: Periodic Larpkeeper detected high token/context burn for Larpkeeper: estimated today 28452410 tokens, avoidable project context 8262 tokens, hot context 538 lines

Next: Use codex-preflight/repo-map/tool-guard before broad reading; manually inspect prune candidates before applying archive moves

Evidence:
- larp token-burn --since today --json; threshold 1000000; raw prompts/log bodies were not read

### 2026-06-26T12:30:17.736Z - finish

Done: Larpkeeper заметил высокий расход контекста в Larpkeeper: за сегодня около 35321131 токенов общего потока Codex; из стартового контекста можно не грузить около 8424 токенов; горячий markdown-контекст 547 строк

Next: Начинать новые задачи с codex-preflight/repo-map/tool-guard; prune-кандидаты смотреть вручную перед архивированием

Evidence:
- larp token-burn --since today --json; threshold 1000000; raw prompts/log bodies were not read

### 2026-06-26T12:53:40.982Z - task-completion

Recorded completed manual manual for Larpkeeper.

Result: Добавлен следующий слой Larpkeeper по четырём референсам: Karpathy-style compile-memory собирает raw worklog/journal в docs/COMPILED_CONTEXT.md; Aider-style repo-map v2 показывает symbols/imports/tests/signals; LangGraph-style workflow-status показывает audit->pack->repo-map->guard->work->finish->verify->compile loop; OpenHands-style automation-plan описывает безопасные scheduled/pressure automation без auto-delete/prune. README и skill-инструкции обновлены.

Evidence:
- node --check bin/context-gardener.mjs; npm test; smoke compile-memory/workflow-status/automation-plan on temp project
- npm test
