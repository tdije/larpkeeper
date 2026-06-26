# Worklog

## 2026-06-15

- Added bundled profiles and project-local overrides.
- Added token economy, pressure monitor, and compact handoff flows.
- Added branded `Larpkeeper`/`larp` CLI voice.

### 2026-06-26T12:53:40.982Z - Larpkeeper: context compiler, repo-map v2, workflow and automation commands

- Project: Larpkeeper
- Task: manual
- Result: Добавлен следующий слой Larpkeeper по четырём референсам: Karpathy-style compile-memory собирает raw worklog/journal в docs/COMPILED_CONTEXT.md; Aider-style repo-map v2 показывает symbols/imports/tests/signals; LangGraph-style workflow-status показывает audit->pack->repo-map->guard->work->finish->verify->compile loop; OpenHands-style automation-plan описывает безопасные scheduled/pressure automation без auto-delete/prune. README и skill-инструкции обновлены.
Files:
- bin/context-gardener.mjs
- test/context-gardener.test.mjs
- README.md
- skills/context-gardener/SKILL.md
- docs/CONTEXT_JOURNAL.md
Tests:
- node --check bin/context-gardener.mjs; npm test; smoke compile-memory/workflow-status/automation-plan on temp project
- npm test
Links:
- git:main@0faeb25
