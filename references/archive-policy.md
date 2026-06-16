# Archive Policy

Archive means "cold storage", not deletion.

Move or mark files as archive when they are:

- longer than active budget and not needed for default startup;
- historical explanation rather than current instruction;
- research that only matters before dependency/foundation decisions;
- superseded by current contracts;
- duplicated across several active files.

When archiving:

1. Preserve the original file.
2. Add a pointer from `docs/CONTEXT_INDEX.md`.
3. Keep one-sentence summary in active docs.
4. Add a `CONTEXT_JOURNAL.md` entry.
5. Optionally append durable fact to Graphiti.

Do not archive:

- active source of truth;
- rollback/fallback docs;
- deploy runbooks used in production;
- user-facing product/design contracts unless replaced first.
