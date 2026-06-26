import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
  fs.writeFileSync(path.join(project, 'src/other.ts'), 'export function unrelatedThing() { return false; }\n');

  const out = JSON.parse(run(['repo-map', project, '--task', 'stretch vertical', '--json']));

  assert.equal(out.sourceFilesScanned, 2);
  assert.equal(out.includedFiles[0].path, 'src/editor.ts');
  assert.ok(out.includedFiles[0].symbols.includes('stretchVertical'));
  assert.ok(out.estimatedTokens <= out.budgetTokens);
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

test('token-burn reads only safe sqlite aggregates', () => {
  const project = tmpProject('TokenBurn');
  fs.mkdirSync(project, { recursive: true });
  const db = path.join(project, 'codex.sqlite');
  execFileSync('sqlite3', [db, 'create table logs(id integer primary key, ts integer not null, ts_nanos integer not null, level text not null, target text not null, feedback_log_body text, module_path text, file text, line integer, thread_id text, process_uuid text, estimated_bytes integer not null default 0);']);
  execFileSync('sqlite3', [db, "insert into logs(ts,ts_nanos,level,target,feedback_log_body,module_path,file,estimated_bytes) values (2000000000,0,'INFO','tool','SECRET_BODY','tool.exec','src/app.ts',4000);"]);

  const out = JSON.parse(run(['token-burn', project, '--since', '1', '--db', db, '--json']));

  assert.equal(out.totals.estimatedTokens, 1000);
  assert.equal(out.topTargets[0].target, 'tool');
  assert.doesNotMatch(JSON.stringify(out), /SECRET_BODY/);
});

test('repo validate succeeds once self-dogfood docs and profiles exist', () => {
  const out = run(['validate', '.']).trim();

  assert.match(out, /context validation: ok/);
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
  assert.match(defaultOut, /default start:/);
  assert.match(taskOut, /mode: task-pack/);
  assert.match(taskOut, /task pack:/);
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
