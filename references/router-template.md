# Router Template

Good agent adapter:

```md
Read first:
1. docs/CONTEXT_INDEX.md
2. docs/CURRENT_STATE.md
3. task-specific files

Read only when needed:
- PRODUCT.md for product intent
- DESIGN.md for UI
- MIGRATION.md for migration/runtime
- PARITY.md for legacy parity
- RUNBOOK.md for ops
- archive/* for historical lookup

Do not broad-scan by default.
Run Larpkeeper `larp audit` / `larp pack` when confused.
```

Bad agent adapter:

- duplicates product/design/migration rules;
- contains long history;
- embeds research;
- has more than one source of truth;
- tells agents to read everything.
