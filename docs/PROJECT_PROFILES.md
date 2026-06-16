# Project Profiles

Profiles are bootstrap hints, not permanent truth. They select the first files to read before task-specific inspection.

Bundled profiles live in `profiles/*.json`.

Project-local override lives in `larpkeeper.config.json`:

```json
{
  "profile": {
    "id": "my-project",
    "matchRegex": "my-project$",
    "defaultRead": ["AGENTS.md", "docs/CONTEXT_INDEX.md"],
    "scoped": [
      { "match": "frontend|ui", "read": ["docs/DESIGN.md", "apps/web/src/App.tsx"] }
    ],
    "archiveHints": ["docs/archive/context-heavy/OLD_HANDOFF.md"],
    "denyByDefault": [".env", "secrets.md"]
  }
}
```

Keep profiles small. They should route context; they should not become a second `PRODUCT.md`.

## driptech-ai-studio

Default:
- `AGENTS.md`
- `docs/AGENT_OPERATING_COMPACT.md`
- `docs/CURRENT_STATE.md`
- `handoff.md`
- `docs/KNOWLEDGE_MAP.md`

Scoped:
- `webapp|ui|frontend` -> `apps/webapp/src/pages/Home.tsx`, `docs/DESIGN.md`
- `proxy|pricing|quota|buyer` -> `docs/OPS_DASHBOARD.md`, `docs/MEMORY_SOURCE_CONTRACT.md`, `~/.hermes/projects/driptech-ai-studio.md`
- `memory|graphiti|obsidian|hermes` -> `docs/MEMORY_SOURCE_CONTRACT.md`, `docs/COMPACT_MEMORY_RULES.md`, `docs/KNOWLEDGE_MAP.md`

Skip by default:
- `.env`
- `CLAUDE.md`

Archive hints:
- `docs/PLAN.md`
- `docs/ARCHITECTURE.md`
- `STATUS.md`

Standard files:
- contextIndex: `docs/KNOWLEDGE_MAP.md`
- currentState: `docs/CURRENT_STATE.md`
- worklog: `docs/DAILY_WORKLOG.md`
- decisions: `docs/DECISIONS.md`
- journal: disabled
- archivePolicy: `docs/archive/context-heavy/README.md`

## metis

Default:
- `README.md`
- `PRODUCT.md`

Scoped:
- `rich|studio|webapp|solid|collage|slicer` -> `DESIGN.md`, `docs/RICH_STUDIO_SOLID_MIGRATION.md`, `docs/RICH_STUDIO_PARITY.md`, `docs/RICH_STUDIO_COLLAGE_AND_PREVIEW_NOTES.md`
- `memory|graphiti|hermes|obsidian|context` -> `src/knowledge/MEMORY_SOURCE_CONTRACT.md`, `src/knowledge/context-broker.ts`, `src/knowledge/context-broker.test.ts`, `docs/METIS_HANDOFF.md`

Skip by default:
- `INFRASTRUCTURE.md`

Archive hints:
- `PROMPT.md`
- `docs/METIS_HANDOFF.md`
- `docs/METIS_ASSISTANT_AUDIT_2026_06_13.md`
- `docs/TELEGRAM_RICH_MESSAGE_MEDIA_RUNBOOK.md`

## radio-engine

Default:
- `docs/CURRENT_STATE.md`
- `docs/epics/EPICS_INDEX.md`

Scoped:
- `set arranger|arranger|solid|timeline|ui` -> `docs/set-arranger-design/README.md`, `docs/set-arranger-design/SKILL_ROUTING.md`, `docs/epics/EPIC-08-arranger-performance-native-feel.md`, `docs/epics/EPIC-09-transition-link-redesign.md`
- `deploy|prod|runtime` -> `docs/RUNBOOK.md`, `handoff.md`

Archive hints:
- `PROJECT.md`
- `handoff.md`
- `docs/DAILY_WORKLOG.md`
