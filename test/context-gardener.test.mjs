import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const cli = path.join(root, 'bin/context-gardener.mjs');

function tmpProject(name = 'Project') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-gardener-'));
  return path.join(dir, name);
}

function write(file, lines = 1) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n'));
}

function run(args, cwd = root) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LARPK_NO_UPDATE_CHECK: '1' },
  });
}

function runResult(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LARPK_NO_UPDATE_CHECK: '1' },
  });
}

test('gather uses bundled Metis profile and keeps Rich Studio handoff out by default', () => {
  const project = tmpProject('Metis');
  write(path.join(project, 'README.md'), 5);
  write(path.join(project, 'PRODUCT.md'), 10);
  write(path.join(project, 'DESIGN.md'), 12);
  write(path.join(project, 'docs/RICH_STUDIO_SOLID_MIGRATION.md'), 20);
  write(path.join(project, 'docs/RICH_STUDIO_PARITY.md'), 20);
  write(path.join(project, 'docs/METIS_HANDOFF.md'), 500);

  const out = JSON.parse(run(['gather', project, '--query', 'Rich Studio webapp', '--json']));

  assert.equal(out.profile, 'metis');
  assert.deepEqual(out.defaultRead, ['README.md', 'PRODUCT.md']);
  assert.ok(out.scopedRead.includes('DESIGN.md'));
  assert.ok(out.archiveCandidates.includes('docs/METIS_HANDOFF.md'));
});

test('audit skips nested git projects unless explicitly included', () => {
  const project = tmpProject('Parent');
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'nested/.git/HEAD'), 1);
  write(path.join(project, 'nested/docs/NOISE.md'), 1000);

  const out = JSON.parse(run(['audit', project, '--json']));

  assert.equal(out.markdownCount, 1);
  assert.equal(out.large.some((f) => f.path === 'nested/docs/NOISE.md'), false);
});

test('init dry-run does not create files', () => {
  const project = tmpProject('Empty');
  fs.mkdirSync(project, { recursive: true });

  const out = run(['init', project]);

  assert.match(out, /would create:/);
  assert.equal(fs.existsSync(path.join(project, 'docs/CONTEXT_INDEX.md')), false);
  assert.match(out, /larpkeeper\.config\.json/);
});

test('pressure brief is one compact line', () => {
  const project = tmpProject('Pressure');
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);

  const out = run(['pressure', project, '--tokens', '82000', '--max-tokens', '100000', '--messages', '150', '--brief']).trim();

  assert.match(out, /^compact-now score=\d+ stop broad work and compact before continuing$/);
});

test('project config profile can override bundled profiles', () => {
  const project = tmpProject('Unknown');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'larpkeeper.config.json'), JSON.stringify({
    profile: {
      id: 'custom',
      matchRegex: 'Unknown$',
      defaultRead: ['docs/CONTEXT_INDEX.md'],
      scoped: [{ match: 'api', read: ['docs/API.md'] }]
    }
  }, null, 2));
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 4);
  write(path.join(project, 'docs/API.md'), 7);

  const out = JSON.parse(run(['gather', project, '--query', 'api', '--json']));

  assert.equal(out.profile, 'custom');
  assert.deepEqual(out.defaultRead, ['docs/CONTEXT_INDEX.md']);
  assert.deepEqual(out.scopedRead, ['docs/API.md']);
});

test('legacy context-gardener config still works', () => {
  const project = tmpProject('LegacyConfig');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'context-gardener.config.json'), JSON.stringify({
    profile: {
      id: 'legacy',
      matchRegex: 'LegacyConfig$',
      defaultRead: ['docs/LEGACY.md'],
      scoped: [],
      denyByDefault: [],
      archiveHints: []
    }
  }, null, 2));
  write(path.join(project, 'docs/LEGACY.md'), 2);

  const out = JSON.parse(run(['pack', project, '--json']));

  assert.equal(out.profile, 'legacy');
  assert.deepEqual(out.readFirst, ['docs/LEGACY.md']);
});

test('pack is profile-aware and uses task-scoped sources', () => {
  const project = tmpProject('DripTech Studio AI');
  write(path.join(project, 'AGENTS.md'), 4);
  write(path.join(project, 'docs/AGENT_OPERATING_COMPACT.md'), 4);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 4);
  write(path.join(project, 'handoff.md'), 4);
  write(path.join(project, 'docs/KNOWLEDGE_MAP.md'), 4);
  write(path.join(project, 'docs/OPS_DASHBOARD.md'), 4);
  write(path.join(project, 'docs/DESIGN.md'), 4);

  const out = JSON.parse(run(['pack', project, '--task', 'proxy pricing', '--json']));

  assert.equal(out.profile, 'driptech-ai-studio');
  assert.ok(out.readFirst.includes('docs/OPS_DASHBOARD.md'));
  assert.equal(out.readFirst.includes('docs/DESIGN.md'), false);
});

test('driptech profile respects alternate standard files', () => {
  const project = tmpProject('DripTech Studio AI');
  write(path.join(project, 'AGENTS.md'), 4);
  write(path.join(project, 'docs/AGENT_OPERATING_COMPACT.md'), 4);
  write(path.join(project, 'docs/KNOWLEDGE_MAP.md'), 4);
  write(path.join(project, 'docs/DAILY_WORKLOG.md'), 4);

  const out = JSON.parse(run(['audit', project, '--json']));

  assert.equal(out.missing.includes('docs/CONTEXT_INDEX.md'), false);
  assert.equal(out.missing.includes('docs/WORKLOG.md'), false);
});

test('empty generic project does not report fake 100 percent savings', () => {
  const project = tmpProject('EmptyGeneric');
  fs.mkdirSync(project, { recursive: true });

  const out = JSON.parse(run(['budget', project, '--json']));

  assert.equal(out.noReadPack, true);
  assert.equal(out.status, 'no-read-pack');
  assert.equal(out.savedPct, 0);
});

test('audit budget and prune share default-start semantics without scoped docs', () => {
  const project = tmpProject('Metis');
  write(path.join(project, 'README.md'), 5);
  write(path.join(project, 'PRODUCT.md'), 10);
  write(path.join(project, 'DESIGN.md'), 120);

  const audit = JSON.parse(run(['audit', project, '--json']));
  const budget = JSON.parse(run(['budget', project, '--json']));
  const prune = JSON.parse(run(['prune', project, '--json']));
  const gather = JSON.parse(run(['gather', project, '--json']));

  assert.equal(audit.defaultStart.afterLines, budget.afterLines);
  assert.equal(prune.budget.afterLines, budget.afterLines);
  assert.deepEqual(audit.defaultStart.readPack, budget.readPack);
  assert.deepEqual(gather.scopedRead, []);
  assert.equal(budget.readPack.includes('DESIGN.md'), false);
  assert.equal(prune.budget.readPack.includes('DESIGN.md'), false);
});

test('brief outputs are defined and compact', () => {
  const project = tmpProject('Brief');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);

  const gatherOut = run(['gather', project, '--brief']).trim();
  const updateOut = run(['update', project, '--type', 'decision', '--summary', 'Use compact docs', '--brief']).trim();

  assert.doesNotMatch(gatherOut, /undefined/);
  assert.doesNotMatch(updateOut, /undefined/);
  assert.match(updateOut, /^decision:/);
});

test('doctor warns when archive policy file is absent', () => {
  const project = tmpProject('Doctor');
  write(path.join(project, 'AGENTS.md'), 3);
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CONTEXT_JOURNAL.md'), 3);

  const out = JSON.parse(run(['doctor', project, '--json']));
  const archiveCheck = out.checks.find((check) => check.name === 'archive-not-delete');

  assert.equal(archiveCheck.status, 'warn');
});

test('policy reference files are not classified as active memory', () => {
  const project = tmpProject('Classify');
  write(path.join(project, 'references/handoff-policy.md'), 2);

  const out = run(['classify-file', project, '--file', 'references/handoff-policy.md']).trim();

  assert.match(out, /deep-reference|other/);
  assert.doesNotMatch(out, /active-memory/);
});

test('pack output includes reasons in normal mode', () => {
  const project = tmpProject('Metis');
  write(path.join(project, 'README.md'), 4);
  write(path.join(project, 'PRODUCT.md'), 4);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/media-editor.ts'), 'export function stretchVideo() { return true; }\n');

  const out = run(['pack', project, '--task', 'readme']);

  assert.match(out, /why:/);
  assert.match(out, /repo map:/);
  assert.match(out, /tool guard:/);
  assert.match(out, /avoid by default:/);
});

test('repo-map returns compact task-focused source symbols', () => {
  const project = tmpProject('RepoMap');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/editor.ts'), [
    'export function stretchVertical() { return "ok"; }',
    'export class MediaPlanner {}',
  ].join('\n'));
  fs.writeFileSync(path.join(project, 'src/editor.test.ts'), 'import { stretchVertical } from "./editor";\n');
  fs.writeFileSync(path.join(project, 'src/other.ts'), 'export function unrelatedThing() { return false; }\n');

  const out = JSON.parse(run(['repo-map', project, '--task', 'stretch vertical', '--json']));

  assert.equal(out.sourceFilesScanned, 3);
  assert.equal(out.includedFiles[0].path, 'src/editor.ts');
  assert.ok(out.includedFiles[0].symbols.includes('stretchVertical'));
  assert.ok(out.includedFiles[0].relatedTests.includes('src/editor.test.ts'));
  assert.equal(out.includedFiles[0].signals.small, true);
  assert.ok(out.estimatedTokens <= out.budgetTokens);
});

test('repo-map deduplicates related test paths', () => {
  const project = tmpProject('RepoMapDedup');
  fs.mkdirSync(path.join(project, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(project, 'lib/tool.js'), 'export function usefulTool() { return true; }\n');
  fs.writeFileSync(path.join(project, 'lib/tool.test.js'), 'import { usefulTool } from "./tool.js";\n');

  const out = JSON.parse(run(['repo-map', project, '--task', 'useful tool', '--json', '--no-cache']));
  const source = out.includedFiles.find((file) => file.path === 'lib/tool.js');

  assert.ok(source);
  assert.deepEqual(source.relatedTests, ['lib/tool.test.js']);
});

test('tool-guard gives compact limits for broad work', () => {
  const project = tmpProject('ToolGuard');
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);

  const out = JSON.parse(run(['tool-guard', project, '--task', 'debug docker logs', '--json']));

  assert.equal(out.logTailLines, 80);
  assert.equal(out.maxOutputTokens <= 12000, true);
  assert.ok(out.beforeBroadWork.some((cmd) => cmd.includes('repo-map')));
});

test('codex-preflight combines pack repo map and guard', () => {
  const project = tmpProject('Preflight');
  write(path.join(project, 'AGENTS.md'), 3);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/router.ts'), 'export function routeTokenBudget() { return true; }\n');

  const out = JSON.parse(run(['codex-preflight', project, '--task', 'token budget route', '--json']));

  assert.ok(out.readFirst.includes('AGENTS.md'));
  assert.ok(out.repoMapTopFiles.some((f) => f.path === 'src/router.ts'));
  assert.equal(out.guard.logTailLines, 80);
});

test('semantic-search finds source by symbols without broad output', () => {
  const project = tmpProject('Semantic');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src/rich-post.ts'), 'export function publishRichPost() { return "ok"; }\n');

  const out = JSON.parse(run(['semantic-search', project, '--query', 'publish rich post', '--json']));

  assert.equal(out.mode, 'semantic-lite');
  assert.equal(out.results[0].path, 'src/rich-post.ts');
});

test('compress-output redacts secrets and summarizes noisy logs', () => {
  const project = tmpProject('Compress');
  fs.mkdirSync(project, { recursive: true });
  const log = path.join(project, 'log.txt');
  fs.writeFileSync(log, [
    'ok',
    'src/app.ts:10: failed to run',
    'Authorization: sk-secretvalue1234567890',
    'Error: boom',
  ].join('\n'));

  const out = JSON.parse(run(['compress-output', project, '--file', 'log.txt', '--json']));

  assert.equal(out.inputLines, 4);
  assert.ok(out.errorLines.some((line) => line.includes('Error')));
  assert.doesNotMatch(JSON.stringify(out), /sk-secretvalue/);
});

test('run wrapper stores raw output and returns compressed summary', () => {
  const project = tmpProject('RunWrap');
  fs.mkdirSync(project, { recursive: true });

  const out = JSON.parse(run(['run', project, '--json', '--', process.execPath, '-e', 'console.log("src/app.ts:10: ok"); console.error("Error: wrapped boom")']));

  assert.equal(out.status, 0);
  assert.ok(out.stdoutFile.endsWith('.stdout.log'));
  assert.ok(out.stderrFile.endsWith('.stderr.log'));
  assert.ok(fs.existsSync(path.join(project, out.stdoutFile)));
  assert.ok(out.summary.errorLines.some((line) => line.includes('wrapped boom')));
  assert.ok(out.summary.topFiles.some((row) => row.file === 'src/app.ts'));
});

test('runs-prune is a read-only dry-run and applies only old run artifacts', () => {
  const project = tmpProject('RunRetention');
  const runs = path.join(project, '.larpkeeper/runs');
  fs.mkdirSync(runs, { recursive: true });
  const old = path.join(runs, 'run-old.stdout.log');
  const oldMeta = path.join(runs, 'run-old.json');
  const recent = path.join(runs, 'run-recent.stdout.log');
  const mixedOld = path.join(runs, 'run-mixed.stdout.log');
  const mixedFresh = path.join(runs, 'run-mixed.json');
  const unrelated = path.join(runs, 'notes.txt');
  for (const file of [old, oldMeta, recent, mixedOld, mixedFresh, unrelated]) fs.writeFileSync(file, 'artifact');
  const oldTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, oldTime, oldTime);
  fs.utimesSync(oldMeta, oldTime, oldTime);
  fs.utimesSync(mixedOld, oldTime, oldTime);
  const dry = JSON.parse(run(['runs-prune', project, '--keep-days', '1', '--keep-last', '1', '--json']));
  assert.equal(dry.mode, 'dry-run');
  assert.equal(dry.candidateCount, 2);
  assert.equal(dry.removed.length, 0);
  assert.equal(fs.existsSync(old), true);
  assert.equal(fs.existsSync(unrelated), true);
  const applied = JSON.parse(run(['runs-prune', project, '--keep-days', '1', '--keep-last', '1', '--apply', '--json']));
  assert.equal(applied.mode, 'apply');
  assert.equal(applied.removed.length, 2);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(oldMeta), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(fs.existsSync(mixedOld), true);
  assert.equal(fs.existsSync(mixedFresh), true);
  assert.equal(fs.existsSync(unrelated), true);
});

test('prune plan exposes categories and honest projected target status', () => {
  const project = tmpProject('PruneMetadata');
  write(path.join(project, 'README.md'), 5);
  write(path.join(project, 'PRODUCT.md'), 5);
  write(path.join(project, 'docs/LARGE.md'), 500);
  write(path.join(project, 'docs/archive/OLD.md'), 700);
  write(path.join(project, '.agents/skills/example/SKILL.md'), 700);
  const out = JSON.parse(run(['prune', project, '--target-lines', '100', '--json']));
  assert.ok(['above-target', 'on-target'].includes(out.status));
  assert.equal(typeof out.projectedRemaining, 'number');
  assert.ok(out.actions.every((a) => ['default-read', 'hot-active', 'task-scoped'].includes(a.category)));
  assert.ok(out.actions.every((a) => typeof a.currentLines === 'number' && typeof a.projectedSavings === 'number' && typeof a.projectedRemaining === 'number'));
  assert.equal(out.excluded.some((a) => a.category === 'archive'), true);
  assert.equal(out.excluded.some((a) => a.category === 'agent-skill'), true);

  const scopedProject = tmpProject('Metis');
  write(path.join(scopedProject, 'README.md'), 5);
  write(path.join(scopedProject, 'PRODUCT.md'), 5);
  write(path.join(scopedProject, 'DESIGN.md'), 500);
  const scoped = JSON.parse(run(['prune', scopedProject, '--json']));
  const scopedAction = scoped.actions.find((action) => action.path === 'DESIGN.md');
  assert.equal(scopedAction?.category, 'task-scoped');
  assert.equal(scopedAction?.action, 'summarize-or-index-task-scoped-doc');

  const entryProject = tmpProject('PruneEntries');
  write(path.join(entryProject, 'AGENTS.md'), 501);
  write(path.join(entryProject, 'CLAUDE.md'), 501);
  const entries = JSON.parse(run(['prune', entryProject, '--target-lines', '100', '--json']));
  assert.equal(entries.actions.filter((action) => action.action === 'dedupe-agent-entry-surfaces').length, 1);
  assert.equal(entries.actions.some((action) => action.path === 'AGENTS.md' || action.path === 'CLAUDE.md'), false);
  assert.equal(entries.projectedRemaining, 501);

  const overlapProject = tmpProject('PruneOverlap');
  fs.mkdirSync(overlapProject, { recursive: true });
  fs.writeFileSync(path.join(overlapProject, 'larpkeeper.config.json'), JSON.stringify({
    profile: {
      id: 'overlap',
      matchRegex: 'PruneOverlap$',
      defaultRead: ['docs/LARGE.md'],
      scoped: [{ match: 'large', read: ['docs/LARGE.md'] }]
    }
  }, null, 2));
  write(path.join(overlapProject, 'docs/LARGE.md'), 500);
  const overlap = JSON.parse(run(['prune', overlapProject, '--json']));
  const overlapAction = overlap.actions.find((action) => action.path === 'docs/LARGE.md');
  assert.equal(overlapAction?.category, 'default-read');
  assert.equal(overlapAction?.action, 'summarize-or-index-authoritative-doc');
  assert.match(overlapAction?.reason || '', /default profile read/);
});

test('conflicts separates duplication hints from semantic consistency hints', () => {
  const project = tmpProject('ConflictStructure');
  for (let i = 0; i < 5; i++) write(path.join(project, `docs/note-${i}.md`), 2);
  for (let i = 0; i < 5; i++) fs.appendFileSync(path.join(project, `docs/note-${i}.md`), '\ngraphiti graphiti');
  write(path.join(project, 'CLAUDE.md'), 2);
  const legacy = JSON.parse(run(['conflicts', project, '--json']));
  assert.ok(Array.isArray(legacy));
  assert.ok(legacy.some((hint) => hint.type === 'repeated-instruction'));

  const out = JSON.parse(run(['conflicts', project, '--json', '--structured']));
  assert.ok(Array.isArray(out.duplicationHints));
  assert.ok(Array.isArray(out.consistencyHints));
  assert.ok(Array.isArray(out.semanticConflicts));
  assert.ok(Array.isArray(out.hints));
  assert.ok(out.duplicationHints.some((hint) => hint.term === 'graphiti'));
  assert.equal(out.semanticConflicts.some((hint) => hint.type === 'repeated-term'), false);
  assert.equal(out.semanticConflicts.length, 0);
  assert.ok(out.consistencyHints.some((hint) => hint.type === 'possibly-stale-entry' && hint.confidence));
});

test('token-burn reads only safe sqlite aggregates', () => {
  const project = tmpProject('TokenBurn');
  fs.mkdirSync(project, { recursive: true });
  const db = path.join(project, 'codex.sqlite');
  execFileSync('sqlite3', [db, 'create table logs(id integer primary key, ts integer not null, ts_nanos integer not null, level text not null, target text not null, feedback_log_body text, module_path text, file text, line integer, thread_id text, process_uuid text, estimated_bytes integer not null default 0);']);
  execFileSync('sqlite3', [db, "insert into logs(ts,ts_nanos,level,target,feedback_log_body,module_path,file,estimated_bytes) values (2000000000,0,'INFO','tool','SECRET_BODY','tool.exec','src/app.ts',4000);"]);

  const out = JSON.parse(run(['token-burn', project, '--since', '1', '--db', db, '--json']));

  assert.equal(out.totals.estimatedTokens, 1000);
  assert.equal(out.topTargets[0].target, 'tool');
  assert.equal(out.topProcesses[0].process, '(none)');
  assert.equal(out.topThreads[0].thread, '(none)');
  assert.equal(out.dailyBuckets[0].estimatedTokens, 1000);
  assert.ok(out.recommendations.some((item) => item.includes('Tool output')));
  assert.doesNotMatch(JSON.stringify(out), /SECRET_BODY/);
});

test('token-burn attributes safe thread totals to projects when session index has cwd', () => {
  const project = tmpProject('TokenProject');
  fs.mkdirSync(project, { recursive: true });
  const db = path.join(project, 'codex.sqlite');
  const sessionIndex = path.join(project, 'session_index.jsonl');
  const otherProject = path.join(path.dirname(project), 'OtherProject');
  execFileSync('sqlite3', [db, 'create table logs(id integer primary key, ts integer not null, ts_nanos integer not null, level text not null, target text not null, feedback_log_body text, module_path text, file text, line integer, thread_id text, process_uuid text, estimated_bytes integer not null default 0);']);
  execFileSync('sqlite3', [db, "insert into logs(ts,ts_nanos,level,target,feedback_log_body,module_path,file,thread_id,process_uuid,estimated_bytes) values (2000000000,0,'INFO','codex_client::transport','SECRET_BODY','transport','src/app.ts','thread-metis','proc-a',8000);"]);
  execFileSync('sqlite3', [db, "insert into logs(ts,ts_nanos,level,target,feedback_log_body,module_path,file,thread_id,process_uuid,estimated_bytes) values (2000000000,0,'INFO','tool','SECRET_BODY','tool.exec','src/other.ts','thread-other','proc-b',4000);"]);
  fs.writeFileSync(sessionIndex, [
    JSON.stringify({ id: 'thread-metis', cwd: project, updated_at: '2026-06-26T10:00:00.000Z' }),
    JSON.stringify({ id: 'thread-other', cwd: otherProject, updated_at: '2026-06-26T10:00:00.000Z' }),
  ].join('\n'));

  const out = JSON.parse(run(['token-burn', project, '--since', '1', '--db', db, '--session-index', sessionIndex, '--json']));

  assert.equal(out.projectAttribution.mode, 'session-index-cwd');
  assert.ok(out.topProjects.some((row) => row.cwd === project && row.estimatedTokens === 2000));
  assert.equal(out.projectLogEstimate.estimatedTokens, 2000);
  assert.doesNotMatch(JSON.stringify(out), /SECRET_BODY/);
});

test('token-burn human output can use Russian payoff language', () => {
  const project = tmpProject('TokenRu');
  fs.mkdirSync(project, { recursive: true });
  const db = path.join(project, 'codex.sqlite');
  execFileSync('sqlite3', [db, 'create table logs(id integer primary key, ts integer not null, ts_nanos integer not null, level text not null, target text not null, feedback_log_body text, module_path text, file text, line integer, thread_id text, process_uuid text, estimated_bytes integer not null default 0);']);
  execFileSync('sqlite3', [db, "insert into logs(ts,ts_nanos,level,target,feedback_log_body,module_path,file,estimated_bytes) values (2000000000,0,'INFO','tool','SECRET_BODY','tool.exec','src/app.ts',4000);"]);

  const out = run(['token-burn', project, '--since', '1', '--db', db, '--lang', 'ru']);

  assert.match(out, /сэкономлено\/можно не тянуть/);
  assert.match(out, /Выигрыш/);
  assert.match(out, /быстрый выигрыш|project context не показывает/);
  assert.doesNotMatch(out, /SECRET_BODY/);
});

test('spend-guard gives cost actions without raw log content', () => {
  const project = tmpProject('SpendGuard');
  fs.mkdirSync(project, { recursive: true });
  const db = path.join(project, 'codex.sqlite');
  execFileSync('sqlite3', [db, 'create table logs(id integer primary key, ts integer not null, ts_nanos integer not null, level text not null, target text not null, feedback_log_body text, module_path text, file text, line integer, thread_id text, process_uuid text, estimated_bytes integer not null default 0);']);
  execFileSync('sqlite3', [db, "insert into logs(ts,ts_nanos,level,target,feedback_log_body,module_path,file,estimated_bytes) values (2000000000,0,'INFO','codex_client::transport','SECRET_BODY','transport','src/app.ts',8000000);"]);

  const json = JSON.parse(run(['spend-guard', project, '--since', '1', '--db', db, '--json']));
  assert.equal(json.pressure, 'high');
  assert.equal(json.maxParallelAgents, 1);
  assert.equal(json.expensiveLanesAllowed, 'explicit-approval-only');
  assert.ok(json.blockedByDefault.some((item) => item.includes('gpt-5.5')));
  assert.doesNotMatch(JSON.stringify(json), /SECRET_BODY/);

  const human = run(['spend-guard', project, '--since', '1', '--db', db, '--lang', 'ru']);
  assert.match(human, /Локальная оценка burn/);
  assert.match(human, /параллельных агентов максимум: 1/);
  assert.match(human, /Запрещено по умолчанию/);
  assert.doesNotMatch(human, /SECRET_BODY/);
});

test('compact-chat writes a real smart handoff from project memory', () => {
  const project = tmpProject('Metis');
  write(path.join(project, 'README.md'), 3);
  write(path.join(project, 'PRODUCT.md'), 3);
  fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(project, 'docs/CONTEXT_INDEX.md'), '# Context Index\n\n- One line: assistant OS\n');
  fs.writeFileSync(path.join(project, 'docs/CURRENT_STATE.md'), '# Current State\n\n- BrainRuntime is active\n- Memory route is active\n');
  fs.writeFileSync(path.join(project, 'docs/WORKLOG.md'), '### 2026-06-26 - Work\n\nResult: smart compact shipped\nEvidence:\n- npm test\n');
  fs.writeFileSync(path.join(project, 'docs/CONTEXT_JOURNAL.md'), '### 2026-06-26 - finish\n\nDone: compacted context\nNext: inspect prune plan\n');

  const out = run(['compact-chat', project, '--note', 'pressure threshold exceeded', '--apply']);
  const handoff = fs.readFileSync(path.join(project, 'docs/COMPACT_HANDOFF.md'), 'utf8');

  assert.match(out, /wrote docs\/COMPACT_HANDOFF.md/);
  assert.match(handoff, /# Compact Handoff/);
  assert.match(handoff, /pressure threshold exceeded/);
  assert.match(handoff, /BrainRuntime is active/);
  assert.match(handoff, /smart compact shipped/);
  assert.match(handoff, /Context Budget/);
  assert.doesNotMatch(handoff, /Compact Handoff Draft/);
});

test('compile-memory writes compiled context cards from worklog and journal', () => {
  const project = tmpProject('CompileMemory');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  fs.writeFileSync(path.join(project, 'docs/CURRENT_STATE.md'), '# Current State\n\n- Runtime truth is compact\n');
  fs.writeFileSync(path.join(project, 'docs/WORKLOG.md'), '### 2026-06-26 - Work\n\nResult: Added compiler layer\nFiles:\n- bin/context-gardener.mjs\nEvidence:\n- npm test\n');
  fs.writeFileSync(path.join(project, 'docs/CONTEXT_JOURNAL.md'), '### 2026-06-26 - finish\n\nDone: compiled memory\nNext: run workflow status\n');

  const out = JSON.parse(run(['compile-memory', project, '--apply', '--json']));
  const compiled = fs.readFileSync(path.join(project, 'docs/COMPILED_CONTEXT.md'), 'utf8');

  assert.equal(out.wrote, true);
  assert.match(compiled, /# Compiled Context/);
  assert.match(compiled, /Runtime truth is compact/);
  assert.match(compiled, /Added compiler layer/);
  assert.match(compiled, /bin\/context-gardener\.mjs/);
});

test('workflow-status and automation-plan expose guarded durable workflow', () => {
  const project = tmpProject('Workflow');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);

  const status = JSON.parse(run(['workflow-status', project, '--json']));
  const plan = JSON.parse(run(['automation-plan', project, '--json']));

  assert.ok(status.workflow.includes('compile-memory'));
  assert.equal(status.state.pack, 'ready');
  assert.equal(plan.mode, 'guarded-plan');
  assert.ok(plan.automations.some((item) => item.name === 'memory-compile'));
  assert.ok(plan.principles.some((item) => item.includes('Never auto-delete')));
});

test('workflow-status reports missing fresh and stale compiled context', () => {
  const project = tmpProject('WorkflowFreshness');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'docs/WORKLOG.md'), 3);
  write(path.join(project, 'docs/CONTEXT_JOURNAL.md'), 3);

  const missing = JSON.parse(run(['workflow-status', project, '--json']));
  assert.equal(missing.state.compile, 'missing');
  assert.match(missing.next[0], /compile-memory .* --apply/);

  run(['compile-memory', project, '--apply', '--json']);
  const fresh = JSON.parse(run(['workflow-status', project, '--json']));
  assert.equal(fresh.state.compile, 'fresh');
  assert.ok(fresh.compileFreshness.compiledAt);
  assert.match(fresh.next[0], /pack .* --task/);

  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(project, 'docs/CURRENT_STATE.md'), future, future);
  const stale = JSON.parse(run(['workflow-status', project, '--json']));
  assert.equal(stale.state.compile, 'stale');
  assert.equal(stale.compileFreshness.newestSource, 'docs/CURRENT_STATE.md');
  assert.match(stale.compileFreshness.reason, /newer than/);
  assert.match(stale.next[0], /compile-memory .* --apply/);
});

test('compile-memory and freshness follow profile-specific standard files', () => {
  const project = tmpProject('DripTech Studio AI');
  write(path.join(project, 'AGENTS.md'), 3);
  write(path.join(project, 'docs/AGENT_OPERATING_COMPACT.md'), 3);
  fs.writeFileSync(path.join(project, 'docs/KNOWLEDGE_MAP.md'), '# Knowledge Map\n\n- Profile index\n');
  fs.writeFileSync(path.join(project, 'docs/CURRENT_STATE.md'), '# Current State\n\n- Profile current truth\n');
  fs.writeFileSync(path.join(project, 'docs/DAILY_WORKLOG.md'), '### 2026-07-14 - Profile work\n\nResult: Read alternate daily worklog\n');

  const compiledResult = JSON.parse(run(['compile-memory', project, '--apply', '--json']));
  const compiled = fs.readFileSync(path.join(project, 'docs/COMPILED_CONTEXT.md'), 'utf8');

  assert.equal(compiledResult.recentFacts.length, 1);
  assert.match(compiled, /Read alternate daily worklog/);

  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(project, 'docs/DAILY_WORKLOG.md'), future, future);
  const stale = JSON.parse(run(['workflow-status', project, '--json']));

  assert.equal(stale.state.compile, 'stale');
  assert.equal(stale.state.worklog, 'ready');
  assert.equal(stale.state.journal, 'not-configured');
  assert.equal(stale.compileFreshness.newestSource, 'docs/DAILY_WORKLOG.md');
  assert.equal(stale.compileFreshness.sources.some((source) => source.path === 'docs/CONTEXT_JOURNAL.md'), false);
});

test('repo validate succeeds once self-dogfood docs and profiles exist', () => {
  const out = run(['validate', '.']).trim();

  assert.match(out, /context validation: ok/);
});

test('validate warning reports limits contributors and recommended command', () => {
  const project = tmpProject('ValidateWarning');
  write(path.join(project, 'docs/CURRENT_STATE.md'), 900);

  const result = runResult(['validate', project]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /context validation: warning/);
  assert.match(result.stdout, /hot context: actual 900 lines; target <= 800 lines/);
  assert.match(result.stdout, /default start: actual \d+ lines; target <= 500 lines/);
  assert.match(result.stdout, /top contributors: docs\/CURRENT_STATE\.md \(900 lines\)/);
  assert.match(result.stdout, /recommended command: .*(bootstrap|prune)/);
});

test('validate warns when aggregate hot context exceeds target without large files', () => {
  const project = tmpProject('ValidateAggregateHot');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 300);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 300);
  write(path.join(project, 'docs/WORKLOG.md'), 300);
  write(path.join(project, 'docs/DECISIONS.md'), 3);
  write(path.join(project, 'docs/CONTEXT_JOURNAL.md'), 300);
  write(path.join(project, 'docs/archive/context-heavy/README.md'), 3);

  const audit = JSON.parse(run(['audit', project, '--json']));
  const result = runResult(['validate', project]);

  assert.deepEqual(audit.risks, ['hot-context-over-budget']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /hot context: actual 1200 lines; target <= 800 lines/);
});

test('bundled profiles match the declared schema shape', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'profiles/schema.json'), 'utf8'));
  const required = new Set(schema.required);
  const files = fs.readdirSync(path.join(root, 'profiles')).filter((f) => f.endsWith('.json') && f !== 'schema.json');

  for (const file of files) {
    const profile = JSON.parse(fs.readFileSync(path.join(root, 'profiles', file), 'utf8'));
    for (const key of required) {
      assert.ok(Object.prototype.hasOwnProperty.call(profile, key), `${file} missing ${key}`);
    }
    assert.equal(Array.isArray(profile.defaultRead), true, `${file} defaultRead must be array`);
    assert.equal(Array.isArray(profile.scoped), true, `${file} scoped must be array`);
    assert.equal(Array.isArray(profile.denyByDefault), true, `${file} denyByDefault must be array`);
    assert.equal(Array.isArray(profile.archiveHints), true, `${file} archiveHints must be array`);
  }
});

test('bootstrap reports planned skeleton files', () => {
  const project = tmpProject('Bootstrap');
  fs.mkdirSync(project, { recursive: true });

  const out = run(['bootstrap', project]).trim();

  assert.match(out, /bootstrap/);
  assert.match(out, /planned:/);
});

test('audit output shows budget and next move', () => {
  const project = tmpProject('PrettyAudit');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);

  const out = run(['audit', project]);

  assert.match(out, /Larpkeeper audit/);
  assert.match(out, /Default Start Estimate/);
  assert.match(out, /Payoff/);
  assert.match(out, /Next Move/);
});

test('audit explains missing files in human terms', () => {
  const project = tmpProject('HumanAudit');
  fs.mkdirSync(project, { recursive: true });

  const out = run(['audit', project]);

  assert.match(out, /Verdict:/);
  assert.match(out, /Missing Standard Files/);
  assert.match(out, /purpose:/);
  assert.match(out, /impact:/);
});

test('budget labels default start versus task pack', () => {
  const project = tmpProject('Metis');
  write(path.join(project, 'README.md'), 5);
  write(path.join(project, 'PRODUCT.md'), 10);
  write(path.join(project, 'DESIGN.md'), 12);

  const defaultOut = run(['budget', project, '--brief']);
  const taskOut = run(['budget', project, '--query', 'design rich studio', '--brief']);

  assert.match(defaultOut, /mode: default-start/);
  assert.match(defaultOut, /will read first now:/);
  assert.match(taskOut, /mode: task-pack/);
  assert.match(taskOut, /will read first now:/);
});

test('budget explains impact in human-readable mode', () => {
  const project = tmpProject('BudgetExplain');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'docs/LARGE.md'), 500);

  const out = run(['budget', project]);

  assert.match(out, /Larpkeeper context budget/);
  assert.match(out, /progress:/);
  assert.match(out, /What Improved/);
  assert.match(out, /Why It Matters/);
  assert.match(out, /Not Loaded On First Pass/);
});

test('budget can explain savings in Russian when requested', () => {
  const project = tmpProject('BudgetRu');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'docs/LARGE.md'), 500);

  const out = run(['budget', project, '--lang', 'ru']);

  assert.match(out, /сэкономлено/);
  assert.match(out, /Что улучшили/);
  assert.match(out, /Почему это важно/);
});

test('install-adapter writes managed block into AGENTS.md', () => {
  const project = tmpProject('AdapterInstall');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Existing\n');

  run(['install-adapter', project, '--target', 'agents', '--apply']);
  const agents = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');

  assert.match(agents, /LARPK:START/);
  assert.match(agents, /larp audit \./);
  assert.match(agents, /larp repo-map \./);
  assert.match(agents, /tool-guard/);
  assert.equal(fs.existsSync(path.join(project, 'docs/AGENT_CONTEXT.md')), true);
});

test('setup dry-run describes one-command install', () => {
  const project = tmpProject('SetupDry');
  fs.mkdirSync(project, { recursive: true });

  const out = run(['setup', project, '--target', 'agents']);

  assert.match(out, /Larpkeeper setup/);
  assert.match(out, /bootstrap standard context files/);
  assert.match(out, /install agents adapter/);
});

test('version prints package version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  const out = run(['version']).trim();

  assert.equal(out, `${pkg.name} ${pkg.version}`);
});

test('statusline is prompt-sized', () => {
  const project = tmpProject('Statusline');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);

  const out = run(['statusline', project]).trim();

  assert.match(out, /^Larpkeeper /);
  assert.match(out, /docs \d+l/);
});

test('shell hook avoids zsh readonly status variable', () => {
  const out = run(['install-shell-hook', '--json']);
  const parsed = JSON.parse(out);

  assert.doesNotMatch(parsed.block, /local status/);
  assert.match(parsed.block, /larp_status_line/);
});

test('hud explains context labels', () => {
  const project = tmpProject('Hud');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);

  const out = run(['hud', project]);

  assert.match(out, /active docs/);
  assert.match(out, /wide scan/);
  assert.match(out, /default read/);
});

test('pitch gives value summary', () => {
  const project = tmpProject('Pitch');
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'docs/LARGE.md'), 500);

  const out = run(['pitch', project]);

  assert.match(out, /Larpkeeper говорит/);
  assert.match(out, /Зачем это нужно/);
  assert.match(out, /Безопасный следующий шаг/);
});

test('banner prints Larpkeeper brand', () => {
  const project = tmpProject('Banner');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);

  const out = run(['banner', project]);

  assert.match(out, /Larpkeeper/);
  assert.match(out, /next:/);
});

test('recommend and watch point to maintenance actions when context is heavy', () => {
  const project = tmpProject('Heavy');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'handoff.md'), 400);

  const recommendOut = run(['recommend', project]).trim();
  const watchOut = run(['watch', project]).trim();

  assert.match(recommendOut, /(maintain|prune|doctor|bootstrap|pack)/);
  assert.match(watchOut, /(watch|compact-now|maintain)/);
});

test('recommend and watch explain why and impact', () => {
  const project = tmpProject('ExplainHeavy');
  write(path.join(project, 'docs/CONTEXT_INDEX.md'), 3);
  write(path.join(project, 'docs/CURRENT_STATE.md'), 3);
  write(path.join(project, 'docs/LARGE.md'), 500);

  const recommendOut = run(['recommend', project]);
  const watchOut = run(['watch', project]);

  assert.match(recommendOut, /Larpkeeper recommendation/);
  assert.match(recommendOut, /Why/);
  assert.match(recommendOut, /Payoff/);
  assert.match(recommendOut, /next unlock/);
  assert.match(recommendOut, /Run Next/);
  assert.match(watchOut, /Larpkeeper watch/);
  assert.match(watchOut, /impact:/);
  assert.match(watchOut, /payoff:/);
});

test('doctor reports warning impact and fix', () => {
  const project = tmpProject('DoctorExplain');
  fs.mkdirSync(project, { recursive: true });

  const out = run(['doctor', project]);

  assert.match(out, /Larpkeeper doctor/);
  assert.match(out, /health:/);
  assert.match(out, /impact:/);
  assert.match(out, /fix:/);
});
