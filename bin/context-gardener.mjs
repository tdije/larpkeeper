#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PROFILE_DIR = path.join(ROOT, 'profiles');
const GITHUB_PACKAGE_JSON = 'https://api.github.com/repos/tdije/larpkeeper/contents/package.json';
const GITHUB_INSTALL_SPEC = 'github:tdije/larpkeeper';
const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.venv', 'tmp', '.next', 'coverage',
  '.cache', '.turbo', '.pytest_cache', '__pycache__', 'vendor',
]);
const DEFAULT_IGNORE_PATTERNS = [/^\.venv-/, /^tmp-/, /^cache-/];
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.php', '.rb', '.cs', '.c', '.cc', '.cpp', '.h', '.hpp',
  '.svelte', '.vue', '.astro', '.sql', '.sh', '.css', '.scss',
]);
const TOOL_GUARD_DEFAULTS = {
  maxOutputTokens: 12000,
  broadSearchMaxOutputTokens: 8000,
  logTailLines: 80,
  maxSubagentsBeforePack: 1,
};
const SOURCE_SKIP_PREFIXES = [
  '.agents/skills/',
  '.claude/skills/',
  '.codex/plugins/',
  '.codex/skills/',
];
const STANDARD = [
  ['docs/CONTEXT_INDEX.md', 'CONTEXT_INDEX.md'],
  ['docs/CURRENT_STATE.md', 'CURRENT_STATE.md'],
  ['docs/WORKLOG.md', 'WORKLOG.md'],
  ['docs/DECISIONS.md', 'DECISIONS.md'],
  ['docs/CONTEXT_JOURNAL.md', 'CONTEXT_JOURNAL.md'],
  ['docs/archive/context-heavy/README.md', 'ARCHIVE_POLICY.md'],
];
const DUPLICATE_TERMS = [
  'solid', 'collage', 'slicer', 'native', 'raster', 'settings', 'scrl',
  'impeccable', '44px', 'drag', 'haptic', 'telegram', 'graphiti',
  'hermes', 'obsidian', 'migration', 'parity', 'fallback',
];
const GENERIC_PROFILE = {
  id: 'generic',
  defaultRead: ['AGENTS.md', 'CLAUDE.md', 'docs/CONTEXT_INDEX.md', 'docs/CURRENT_STATE.md', 'handoff.md'],
  scoped: [],
  denyByDefault: [],
  archiveHints: [],
  standardFiles: {},
};

const STANDARD_ROLES = {
  contextIndex: { path: 'docs/CONTEXT_INDEX.md', template: 'CONTEXT_INDEX.md' },
  currentState: { path: 'docs/CURRENT_STATE.md', template: 'CURRENT_STATE.md' },
  worklog: { path: 'docs/WORKLOG.md', template: 'WORKLOG.md' },
  decisions: { path: 'docs/DECISIONS.md', template: 'DECISIONS.md' },
  journal: { path: 'docs/CONTEXT_JOURNAL.md', template: 'CONTEXT_JOURNAL.md' },
  archivePolicy: { path: 'docs/archive/context-heavy/README.md', template: 'ARCHIVE_POLICY.md' },
};

function commandName() {
  const invoked = path.basename(process.argv[1] || 'larp');
  return invoked === 'context-gardener.mjs' ? 'larp' : invoked;
}

const USE_COLOR = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const color = (code, text) => USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = (text) => color(1, text);
const dim = (text) => color(2, text);
const cyan = (text) => color(36, text);
const green = (text) => color(32, text);
const yellow = (text) => color(33, text);
const red = (text) => color(31, text);

function statusColor(level) {
  if (level === 'ok') return green(level);
  if (level === 'watch') return yellow(level);
  return red(level);
}

function section(title) {
  console.log(`\n${bold(title)}`);
}

function bullet(text) {
  console.log(`  - ${text}`);
}

function firstExisting(project, files) {
  return files.find((file) => fs.existsSync(path.join(project, file)));
}

function auditLevel(r) {
  if (r.risks.includes('hot-context-over-budget') || r.risks.includes('large-active-docs') || r.broadContextLines > 3000) return 'compact-now';
  if (r.risks.length || r.missing.length || r.hotContextLines > 500) return 'watch';
  return 'ok';
}

function estimateAuditSavings(r, project) {
  const profile = profileFor(project);
  const readPack = existing(project, profile.defaultRead).slice(0, 6);
  const afterLines = readPack.reduce((sum, file) => sum + (file.startsWith('~/') ? 40 : lineCount(path.join(project, file))), 0);
  const beforeLines = r.broadContextLines || r.hotContextLines || 0;
  const savedLines = readPack.length ? Math.max(0, beforeLines - afterLines) : 0;
  const savedPct = beforeLines && readPack.length ? Math.round((savedLines / beforeLines) * 100) : 0;
  return {
    profile: profile.id,
    beforeLines,
    afterLines,
    savedLines,
    savedPct,
    beforeTokens: approxTokensFromLines(beforeLines),
    afterTokens: approxTokensFromLines(afterLines),
    savedTokens: approxTokensFromLines(savedLines),
    readPack,
    confidence: readPack.length ? 'medium' : 'low',
    confidenceReason: readPack.length
      ? 'default profile only; run pack/budget with --task or --query for task-specific context'
      : 'no default read pack exists yet',
  };
}

function nextFromAudit(r, project) {
  if (r.missing.length) return { command: `${commandName()} bootstrap ${quotePath(project)} --apply`, reason: 'create missing context skeleton files' };
  const handoff = firstExisting(project, ['handoff.md', 'docs/HANDOFF.md']);
  if (handoff && lineCount(path.join(project, handoff)) > 260) return { command: `${commandName()} maintain ${quotePath(project)} --apply`, reason: 'compact oversized handoff and journal the maintenance' };
  if (r.risks.includes('large-active-docs') || r.risks.includes('hot-context-over-budget')) return { command: `${commandName()} prune ${quotePath(project)}`, reason: 'show archive/split candidates before editing files' };
  if (r.risks.includes('many-agent-entry-surfaces') || r.risks.includes('missing-active-memory')) return { command: `${commandName()} doctor ${quotePath(project)}`, reason: 'inspect context health checks' };
  return { command: `${commandName()} pack ${quotePath(project)} --task "..."`, reason: 'get the smallest read list for the actual task' };
}

function quotePath(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function usage() {
  const bin = commandName();
  console.log(`Larpkeeper

Keep project context sharp: what's real, what's noise, what should the agent read now.

Usage:
  ${bin} audit <project> [--json]        what's real?
  ${bin} pitch <project>                 explain audit value for humans
  ${bin} gather <project> [--query "..."] [--role "..."] [--budget 6000] [--json]   read this
  ${bin} repo-map <project> [--task "..."] [--budget 4000] [--json]   compact code map
  ${bin} tool-guard <project> [--task "..."] [--json]   safe search/log/tool limits
  ${bin} caveman <project> [--query "..."] [--apply]   tiny brain mode
  ${bin} init <project> [--apply]        set the bones
  ${bin} setup <project> [--target agents|claude] [--owner-name NAME] [--apply] [--shell-hook]   one-command install
  ${bin} version                       show installed version
  ${bin} check-update                  check GitHub for a newer version
  ${bin} upgrade                       update Larpkeeper from GitHub
  ${bin} bootstrap <project> [--apply]   create the project context skeleton
  ${bin} install-adapter <project> --target agents|claude [--owner-name NAME] [--apply]   drop the adapter
  ${bin} pack <project> [--task "..."] [--json]        read now
  ${bin} prune <project> [--json]        cut noise
  ${bin} maintain <project> [--apply]    safe maintenance pass
  ${bin} fix-safe <project> [--apply]    safe maintenance alias
  ${bin} recommend <project> [--json]    next best move
  ${bin} next <project> [--json]         next best move alias
  ${bin} watch <project> [--json]        quick context warning
  ${bin} profile-sync <project> [--apply] sync bundled profiles and docs
  ${bin} update <project> --summary "..." --type decision|runtime|progress|research [--json]   write the durable bit
  ${bin} journal <project> --type TYPE --note NOTE [--apply] [--graphiti]   leave a trail
  ${bin} score <project> [--json]        rank the noise
  ${bin} doctor <project> [--json]       check the health
  ${bin} budget <project> [--query "..."] [--target-lines 500] [--json]   count the burn
  ${bin} conflicts <project> [--json]    catch the contradictions
  ${bin} blindspots <project> [--type frontend|backend|deploy|pricing|memory|release] [--json]   what did we miss?
  ${bin} finish <project> --done "..." --next "..." [--evidence "..."] [--apply] [--graphiti]   close the loop
  ${bin} policy
  ${bin} classify-file <project> --file PATH [--json]  sort a file
  ${bin} compact-handoff <project> [--file handoff.md] [--max-lines 220] [--apply]   shrink the handoff
  ${bin} pressure <project> [--tokens N] [--max-tokens N] [--messages N] [--tool-lines N] [--json]   stay cool
  ${bin} statusline <project> [--tokens N] [--max-tokens N] [--messages N] [--tool-lines N]   prompt-sized status
  ${bin} hud <project> [--style compact|ascii]   pretty console status
  ${bin} install-shell-hook [--mode right|above] [--style compact|ascii] [--apply]    show Larpkeeper in zsh prompt
  ${bin} banner <project>                red console banner
  ${bin} codex <project> [--no-alt-screen] [-- PROMPT]   launch Codex with Larpkeeper banner
  ${bin} savings <project> [--query "..."] [--brief] [--json]   show the payoff
  ${bin} compact-chat <project> [--note "..."] [--apply]   pack the chat
  ${bin} diff-cards <project> [--json]   compare memory cards
  ${bin} validate <project>           quick sanity check

Aliases:
  larpkeeper, larp, lorekeeper, lore, context-gardener
`);
}

function parse(argv) {
  const cmd = argv[0];
  const projectArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '.';
  const flagStart = projectArg === '.' ? 1 : 2;
  const flags = {};
  for (let i = flagStart; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    }
  }
  if (flags.help || cmd === '--help' || cmd === '-h') return { cmd: 'help', project: path.resolve(projectArg || '.'), flags };
  return { cmd, project: path.resolve(projectArg || '.'), flags };
}

function readConfig(project) {
  const primary = path.join(project, 'larpkeeper.config.json');
  const legacy = path.join(project, 'context-gardener.config.json');
  const file = fs.existsSync(primary) ? primary : legacy;
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function packageInfo() {
  return readJson(path.join(ROOT, 'package.json'));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'larpkeeper', Accept: 'application/vnd.github.raw' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchText(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function latestPackageInfo() {
  return JSON.parse(await fetchText(GITHUB_PACKAGE_JSON));
}

function updateStateFile() {
  const dir = path.join(os.homedir(), '.larpkeeper');
  return path.join(dir, 'update-check.json');
}

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(updateStateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeUpdateState(state) {
  const file = updateStateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function compareVersions(a, b) {
  const pa = String(a || '0.0.0').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b || '0.0.0').split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

async function maybeNotifyUpdate(cmd, flags = {}) {
  if (flags.json || flags['no-update-check'] || flags.noUpdateCheck) return;
  if (process.env.LARPK_NO_UPDATE_CHECK === '1' || process.env.CI) return;
  if (['upgrade', 'check-update', 'version', 'help'].includes(cmd)) return;
  const current = packageInfo().version;
  const state = readUpdateState();
  const now = Date.now();
  if (state.lastCheckedAt && now - state.lastCheckedAt < UPDATE_CHECK_TTL_MS) return;
  writeUpdateState({ ...state, lastCheckedAt: now });
  try {
    const latest = await latestPackageInfo();
    const latestVersion = latest.version;
    const hasUpdate = compareVersions(latestVersion, current) > 0;
    writeUpdateState({ lastCheckedAt: now, latestVersion, currentVersion: current, hasUpdate });
    if (hasUpdate) {
      console.error(`\nLarpkeeper update available: ${current} -> ${latestVersion}`);
      console.error(`Run: ${commandName()} upgrade\n`);
    }
  } catch {
    writeUpdateState({ ...state, lastCheckedAt: now, lastErrorAt: now });
  }
}

function profileIssues(profile) {
  const issues = [];
  if (!profile || typeof profile !== 'object') return ['not-an-object'];
  if (typeof profile.id !== 'string' || !profile.id.trim()) issues.push('missing-id');
  if (!Array.isArray(profile.defaultRead)) issues.push('missing-defaultRead');
  if (!Array.isArray(profile.scoped)) issues.push('missing-scoped');
  if (!Array.isArray(profile.denyByDefault)) issues.push('missing-denyByDefault');
  if (!Array.isArray(profile.archiveHints)) issues.push('missing-archiveHints');
  return issues;
}

function loadBundledProfiles() {
  if (!fs.existsSync(PROFILE_DIR)) return [];
  return fs.readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'schema.json')
    .sort()
    .map((name) => ({ name, profile: normalizeProfile(readJson(path.join(PROFILE_DIR, name))) }));
}

function renderProfilesMarkdown() {
  const rows = loadBundledProfiles();
  const lines = [
    '# Project Profiles',
    '',
    'Profiles are bootstrap hints, not permanent truth. They select the first files to read before task-specific inspection.',
    '',
    'Bundled profiles live in `profiles/*.json`.',
    '',
    'Project-local override lives in `larpkeeper.config.json`:',
    '',
    '```json',
    '{',
    '  "profile": {',
    '    "id": "my-project",',
    '    "matchRegex": "my-project$",',
    '    "defaultRead": ["AGENTS.md", "docs/CONTEXT_INDEX.md"],',
    '    "scoped": [',
    '      { "match": "frontend|ui", "read": ["docs/DESIGN.md", "apps/web/src/App.tsx"] }',
    '    ],',
    '    "archiveHints": ["docs/archive/context-heavy/OLD_HANDOFF.md"],',
    '    "denyByDefault": [".env", "secrets.md"]',
    '  }',
    '}',
    '```',
    '',
    'Keep profiles small. They should route context; they should not become a second `PRODUCT.md`.',
    '',
  ];
  for (const { profile } of rows) {
    lines.push(`## ${profile.id}`);
    lines.push('');
    lines.push('Default:');
    for (const file of profile.defaultRead) lines.push(`- \`${file}\``);
    if (profile.scoped.length) {
      lines.push('');
      lines.push('Scoped:');
      for (const [match, read] of profile.scoped) {
        lines.push(`- \`${match}\` -> ${read.map((f) => `\`${f}\``).join(', ')}`);
      }
    }
    if (profile.denyByDefault.length) {
      lines.push('');
      lines.push('Skip by default:');
      for (const file of profile.denyByDefault) lines.push(`- \`${file}\``);
    }
    if (profile.archiveHints.length) {
      lines.push('');
      lines.push('Archive hints:');
      for (const file of profile.archiveHints) lines.push(`- \`${file}\``);
    }
    if (profile.standardFiles && Object.keys(profile.standardFiles).length) {
      lines.push('');
      lines.push('Standard files:');
      for (const [role, file] of Object.entries(profile.standardFiles)) {
        lines.push(`- ${role}: ${file === null ? 'disabled' : `\`${file}\``}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function profileSync(project, flags = {}) {
  const file = path.join(project, 'docs/PROJECT_PROFILES.md');
  const generated = renderProfilesMarkdown();
  const exists = fs.existsSync(file);
  const current = exists ? fs.readFileSync(file, 'utf8') : '';
  const drift = !exists || current !== generated;
  const result = {
    project,
    file: 'docs/PROJECT_PROFILES.md',
    drift,
    bundledProfiles: loadBundledProfiles().map((row) => row.profile.id),
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# profile sync\n`);
    console.log(`file: ${result.file}`);
    console.log(`drift: ${drift}`);
    console.log(`bundled: ${result.bundledProfiles.join(', ') || 'none'}`);
    if (drift) console.log(`next: run \`${commandName()} profile-sync . --apply\``);
  }
  if (flags.apply && drift) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated);
    console.log(`synced: ${rel(project, file)}`);
  } else if (flags.apply) {
    console.log(`synced: ${rel(project, file)} (already up to date)`);
  }
}

function maintenanceStatus(project) {
  const r = audit(project, { quiet: true });
  const missingStandard = missingStandardFiles(project);
  const handoffFile = path.join(project, 'handoff.md');
  const handoffLines = fs.existsSync(handoffFile) ? lineCount(handoffFile) : 0;
  const profileRows = loadBundledProfiles();
  const profileProblems = profileRows.flatMap(({ name, profile }) => profileIssues(profile).map((issue) => `${name}:${issue}`));
  const profileDoc = path.join(project, 'docs/PROJECT_PROFILES.md');
  const profileDrift = !fs.existsSync(profileDoc) || fs.readFileSync(profileDoc, 'utf8') !== renderProfilesMarkdown();
  const isToolRepo = path.resolve(project) === ROOT;
  return {
    project,
    audit: r,
    missingStandard,
    handoffLines,
    needsHandoffCompact: fs.existsSync(handoffFile) && handoffLines > 260,
    profileProblems,
    profileDrift,
    needsBootstrap: missingStandard.length > 0,
    needsProfileSync: isToolRepo && profileDrift,
  };
}

function recommendNext(project, flags = {}) {
  const status = maintenanceStatus(project);
  let next = 'pack';
  let reason = 'start with a task-specific context pack';
  if (status.profileProblems.length) {
    next = 'profile-sync';
    reason = 'profile schema or bundled profile drift needs a sync';
  } else if (status.needsBootstrap) {
    next = 'bootstrap';
    reason = 'standard context files are missing';
  } else if (status.needsProfileSync) {
    next = 'profile-sync';
    reason = 'project profile docs are out of sync';
  } else if (status.needsHandoffCompact) {
    next = 'maintain';
    reason = 'handoff is too long and should be compacted';
  } else if (status.audit.risks.includes('hot-context-over-budget') || status.audit.risks.includes('large-active-docs')) {
    next = 'prune';
    reason = 'context is too heavy';
  } else if (status.audit.risks.includes('many-agent-entry-surfaces') || status.audit.risks.includes('missing-active-memory')) {
    next = 'doctor';
    reason = 'instructions or memory surfaces need cleanup';
  }
  const result = {
    project,
    next,
    reason,
    level: status.audit.hotContextLines > 800 ? 'compact-soon' : 'ok',
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.next}: ${result.reason}`);
  return result;
}

function watch(project, flags = {}) {
  const status = maintenanceStatus(project);
  const heavy = status.audit.hotContextLines > 800 || status.audit.broadContextLines > 6000 || status.audit.risks.includes('large-active-docs');
  const level = heavy ? 'compact-now' : status.needsBootstrap ? 'watch' : 'ok';
  const next = heavy ? 'maintain' : status.needsBootstrap ? 'bootstrap' : 'pack';
  const result = {
    project,
    level,
    next,
    score: heavy ? 82 : status.needsBootstrap ? 48 : 12,
    reason: heavy ? 'context is heavy and should be compacted' : status.needsBootstrap ? 'context skeleton is missing' : 'context looks healthy',
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.level} score=${result.score} ${result.reason} -> ${result.next}`);
}

function bootstrap(project, flags = {}) {
  const result = {
    project,
    action: 'bootstrap',
    files: [],
  };
  const planned = [];
  for (const [target, template] of standardTargets(project)) {
    const out = path.join(project, target);
    if (fs.existsSync(out)) continue;
    planned.push(target);
    if (flags.apply) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'templates', template), out);
    }
  }
  if (flags.json) {
    console.log(JSON.stringify({ ...result, planned }, null, 2));
  } else {
    console.log(`# bootstrap\n`);
    console.log(`planned: ${planned.length ? planned.join(', ') : 'nothing'}`);
  }
}

function maintain(project, flags = {}) {
  const status = maintenanceStatus(project);
  const planned = [];
  if (status.needsBootstrap) planned.push('bootstrap');
  if (status.needsHandoffCompact) planned.push('compact-handoff');
  if (status.needsProfileSync) planned.push('profile-sync');
  if (flags.apply) {
    if (status.needsBootstrap) init(project, { apply: true });
    if (status.needsHandoffCompact) compactHandoff(project, { apply: true });
    if (status.needsProfileSync) profileSync(project, { apply: true });
    journal(project, {
      type: 'maintenance',
      note: `Maintained context: ${planned.join(', ') || 'nothing needed'}`,
      apply: true,
      graphiti: flags.graphiti,
    });
  }
  if (flags.json) {
    console.log(JSON.stringify({ project, planned, status: status.audit.risks, needsBootstrap: status.needsBootstrap, needsHandoffCompact: status.needsHandoffCompact }, null, 2));
  } else {
    console.log(`# maintain\n`);
    console.log(`planned: ${planned.length ? planned.join(', ') : 'nothing'}`);
    if (status.needsBootstrap) console.log(`- bootstrap missing standard docs`);
    if (status.needsHandoffCompact) console.log(`- compact handoff`);
  }
}

function fixSafe(project, flags = {}) {
  maintain(project, flags);
}

function setup(project, flags = {}) {
  const target = flags.target || 'agents';
  const planned = [
    'bootstrap standard context files',
    `install ${target} adapter`,
    `insert managed Larpkeeper block into ${target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}`,
  ];
  if (flags['owner-name'] || flags.ownerName) planned.push(`record owner address form: ${flags['owner-name'] || flags.ownerName}`);
  else planned.push('owner address form not set; pass --owner-name so agents address the human consistently');
  if (flags['shell-hook'] || flags.shellHook) planned.push('install zsh prompt hook');

  if (flags.apply) {
    bootstrap(project, { apply: true });
    installAdapter(project, { apply: true, target, 'owner-name': flags['owner-name'] || flags.ownerName });
    if (flags['shell-hook'] || flags.shellHook) installShellHook(project, { apply: true });
    journal(project, {
      type: 'setup',
      note: `Installed Larpkeeper: ${planned.join(', ')}`,
      apply: true,
    });
  }

  if (flags.json) {
    console.log(JSON.stringify({ project, action: 'setup', apply: Boolean(flags.apply), target, planned }, null, 2));
    return;
  }
  console.log(`# Larpkeeper setup\n`);
  console.log(`project: ${project}`);
  console.log(`target: ${target}`);
  console.log(`mode: ${flags.apply ? 'applied' : 'dry-run'}`);
  for (const item of planned) console.log(`- ${item}`);
  if (!flags.apply) {
    console.log(`\nowner name: pass --owner-name to make agents address the human consistently in prompts, updates, reports, and final answers.`);
    console.log(`why: if an agent loses context or starts producing confused output, the missing or wrong address form is immediately visible.`);
    console.log(`next: ${commandName()} setup ${quotePath(project)} --target ${target} --owner-name "..." --apply`);
  }
}

function versionCommand(flags = {}) {
  const info = packageInfo();
  const result = { name: info.name, version: info.version, root: ROOT };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${info.name} ${info.version}`);
}

async function checkUpdate(flags = {}) {
  const current = packageInfo();
  const latest = await latestPackageInfo();
  const hasUpdate = compareVersions(latest.version, current.version) > 0;
  const result = {
    current: current.version,
    latest: latest.version,
    updateAvailable: hasUpdate,
    install: `${commandName()} upgrade`,
  };
  writeUpdateState({
    lastCheckedAt: Date.now(),
    currentVersion: current.version,
    latestVersion: latest.version,
    hasUpdate,
  });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (hasUpdate) {
    console.log(`Update available: ${current.version} -> ${latest.version}`);
    console.log(`Run: ${commandName()} upgrade`);
  } else {
    console.log(`Larpkeeper is up to date (${current.version}).`);
  }
}

function upgrade(flags = {}) {
  const npm = spawnSync('npm', ['install', '-g', GITHUB_INSTALL_SPEC], { stdio: flags.json ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (npm.status !== 0) {
    if (flags.json) console.log(JSON.stringify({ ok: false, status: npm.status, stderr: npm.stderr }, null, 2));
    process.exitCode = npm.status || 1;
    return;
  }
  writeUpdateState({ lastCheckedAt: Date.now(), upgradedAt: Date.now(), hasUpdate: false });
  if (flags.json) console.log(JSON.stringify({ ok: true, installed: GITHUB_INSTALL_SPEC }, null, 2));
  else console.log('Larpkeeper updated.');
}

function pressureResult(project, flags = {}) {
  const tokens = Number(flags.tokens || 0);
  const maxTokens = Number(flags['max-tokens'] || flags.maxTokens || 0);
  const messages = Number(flags.messages || 0);
  const toolLines = Number(flags['tool-lines'] || flags.toolLines || 0);
  const doctorWarnings = audit(project, { quiet: true }).risks.length;
  let ratio = maxTokens ? tokens / maxTokens : 0;
  let score = 0;
  if (ratio) score += ratio * 70;
  if (messages > 80) score += 15;
  if (messages > 140) score += 15;
  if (toolLines > 1500) score += 15;
  if (toolLines > 5000) score += 20;
  if (doctorWarnings > 2) score += 10;
  let level = 'ok';
  if (score >= 35) level = 'watch';
  if (score >= 55) level = 'compact-soon';
  if (score >= 75) level = 'compact-now';
  return {
    project,
    level,
    score: Math.round(score),
    signals: { tokens, maxTokens, ratio: ratio ? Number(ratio.toFixed(3)) : null, messages, toolLines, doctorWarnings },
    recommendation: {
      ok: 'continue',
      watch: 'warn the user that context is getting heavy',
      'compact-soon': 'finish current step, then write compact handoff',
      'compact-now': 'stop broad work and compact before continuing',
    }[level],
    compactPrompt: path.join(ROOT, 'templates/COMPACT_PROMPT.md'),
  };
}

function statusline(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const p = pressureResult(project, flags);
  const level = p.level !== 'ok' ? p.level : auditLevel(r);
  const next = nextFromAudit(r, project).command.split(/\s+/).slice(0, 2).join(' ');
  const active = r.hotContextLines;
  const wide = r.broadContextLines;
  const text = flags.zsh
    ? `%F{red}Larpkeeper%f %F{yellow}${level}%f | %F{cyan}${path.basename(project)}%f | docs ${active}l | scan ${wide}l | next ${next}`
    : `Larpkeeper ${level} | ${path.basename(project)} | docs ${active}l | scan ${wide}l | next ${next}`;
  if (flags.json) console.log(JSON.stringify({ project, level, activeContextLines: active, wideContextLines: wide, next }, null, 2));
  else console.log(text);
}

function hud(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const level = auditLevel(r);
  const next = nextFromAudit(r, project);
  const budget = estimateAuditSavings(r, project);
  const title = USE_COLOR ? `${red('Larpkeeper')} ${yellow(level)}` : `Larpkeeper ${level}`;
  const projectName = USE_COLOR ? cyan(path.basename(project)) : path.basename(project);
  if (flags.style === 'ascii') {
    console.log(``);
    console.log(`  _                         _`);
    console.log(` | |    __ _ _ __ _ __  ___| | _____  ___ _ __   ___ _ __`);
    console.log(` | |   / _\` | '__| '_ \\/ __| |/ / _ \\/ _ \\ '_ \\ / _ \\ '__|`);
    console.log(` | |__| (_| | |  | |_) \\__ \\   <  __/  __/ |_) |  __/ |`);
    console.log(` |_____\\__,_|_|  | .__/|___/_|\\_\\___|\\___| .__/ \\___|_|`);
    console.log(`                 |_|                     |_|`);
  }
  console.log(`${title}  ${projectName}`);
  console.log(`active docs  ${r.hotContextLines} lines  ${dim('likely startup/context files')}`);
  console.log(`wide scan    ${r.broadContextLines} lines  ${dim('what a broad markdown read might drag in')}`);
  console.log(`default read ${budget.afterLines} lines  ${dim(`${budget.savedPct}% avoided at startup`)}`);
  console.log(`next         ${next.command}`);
}

function pitch(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const b = estimateAuditSavings(r, project);
  const next = nextFromAudit(r, project);
  const topRisks = r.risks.slice(0, 4);
  const missing = r.missing.slice(0, 6);
  const large = r.large.filter((f) => !f.path.includes('/archive/')).slice(0, 5);
  const out = {
    project,
    level: auditLevel(r),
    markdownFiles: r.markdownCount,
    broadScanLines: b.beforeLines,
    defaultStartLines: b.afterLines,
    avoidedLines: b.savedLines,
    avoidedTokens: b.savedTokens,
    avoidedPercent: b.savedPct,
    risks: topRisks,
    missing,
    large,
    next,
  };
  if (flags.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log(`Larpkeeper говорит: ${path.basename(project)} можно стартовать с ${b.afterLines} строк вместо ${b.beforeLines}.`);
  console.log(`Это не удаление контекста, а экономия чтения: ${b.savedPct}% markdown не нужно тащить в первый заход (~${b.savedTokens} токенов).`);
  console.log('');
  console.log('Зачем это нужно:');
  console.log('- агент быстрее стартует и меньше читает старую историю;');
  console.log('- меньше шанс, что старый audit/runbook/CLAUDE.md перебьет текущую реальность;');
  console.log('- проще понять, какие файлы являются source of truth;');
  console.log('- будущие сессии получают карту, current state и журнал вместо raw transcript.');
  if (topRisks.length) {
    console.log('');
    console.log('Главные риски:');
    for (const risk of topRisks) console.log(`- ${risk}`);
  }
  if (missing.length) {
    console.log('');
    console.log('Что стоит добавить:');
    for (const file of missing) console.log(`- ${file}: ${contextFilePurpose(file)}`);
  }
  if (large.length) {
    console.log('');
    console.log('Что раздувает контекст:');
    for (const file of large) console.log(`- ${file.path} (${file.lines} строк)`);
  }
  console.log('');
  console.log(`Безопасный следующий шаг: ${next.command}`);
  console.log(`${next.reason}. Эта команда не удаляет контекст; write-команды требуют --apply.`);
}

function contextFilePurpose(file) {
  if (file.includes('CONTEXT_INDEX')) return 'карта, какие docs читать и когда';
  if (file.includes('CURRENT_STATE')) return 'текущая реальность проекта без старой истории';
  if (file.includes('WORKLOG')) return 'короткая continuity-память между сессиями';
  if (file.includes('DECISIONS')) return 'принятые решения и почему они действуют';
  if (file.includes('CONTEXT_JOURNAL')) return 'журнал maintenance/context изменений';
  if (file.includes('archive')) return 'правило холодного хранения старого контекста';
  return 'стандартный слой контекстной гигиены';
}

function normalizeScoped(scoped = []) {
  return scoped.map((entry) => {
    if (Array.isArray(entry)) return entry;
    return [entry.match || entry.pattern || '', entry.read || entry.files || []];
  });
}

function normalizeProfile(profile) {
  return {
    ...GENERIC_PROFILE,
    ...profile,
    scoped: normalizeScoped(profile.scoped || []),
    defaultRead: profile.defaultRead || [],
    denyByDefault: profile.denyByDefault || [],
    archiveHints: profile.archiveHints || [],
    standardFiles: profile.standardFiles || {},
  };
}

function loadProfiles(project, cfg = {}) {
  const profiles = loadBundledProfiles().map((row) => row.profile);
  if (cfg.profile) profiles.unshift(normalizeProfile({ id: 'project-config', ...cfg.profile }));
  return profiles;
}

function profileMatches(profile, project) {
  const base = path.basename(project).toLowerCase();
  if ((profile.matchBasenames || []).map((x) => x.toLowerCase()).includes(base)) return true;
  if (profile.matchRegex && new RegExp(profile.matchRegex, 'i').test(project)) return true;
  return false;
}

function walk(dir, cfg, out = [], root = dir) {
  if (!fs.existsSync(dir)) return out;
  const ignore = new Set([...(cfg.ignore || []), ...DEFAULT_IGNORE]);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(ent.name)) continue;
    if (DEFAULT_IGNORE_PATTERNS.some((pattern) => pattern.test(ent.name))) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const nestedGit = full !== root && fs.existsSync(path.join(full, '.git'));
      if (nestedGit && !cfg.includeNestedProjects) continue;
      walk(full, cfg, out, root);
    }
    else out.push(full);
  }
  return out;
}

function rel(project, file) {
  return path.relative(project, file).replaceAll(path.sep, '/');
}

function lineCount(file) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    return s ? s.split(/\r?\n/).length : 0;
  } catch {
    return 0;
  }
}

function approxTokensFromLines(lines) {
  return Math.ceil(lines * 18);
}

function money(tokens, usdPerMillion = 1.25) {
  return Number(((tokens / 1_000_000) * usdPerMillion).toFixed(4));
}

function mdFiles(project, cfg) {
  return walk(project, cfg).filter((f) => f.endsWith('.md')).map((f) => ({
    path: rel(project, f),
    abs: f,
    lines: lineCount(f),
    mtimeMs: fs.statSync(f).mtimeMs,
    ageDays: Math.max(0, Math.round((Date.now() - fs.statSync(f).mtimeMs) / 86400000)),
  }));
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function sourceFiles(project, cfg) {
  return walk(project, cfg)
    .filter(isSourceFile)
    .map((f) => {
      const stat = fs.statSync(f);
      return {
        path: rel(project, f),
        abs: f,
        lines: lineCount(f),
        mtimeMs: stat.mtimeMs,
        ageDays: Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 86400000)),
      };
    })
    .filter((f) => !SOURCE_SKIP_PREFIXES.some((prefix) => f.path.startsWith(prefix)));
}

function queryTerms(value = '') {
  return String(value)
    .toLowerCase()
    .split(/[^a-zа-яё0-9_./-]+/iu)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

function extractSymbols(file, text) {
  const ext = path.extname(file).toLowerCase();
  const patterns = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue', '.astro'].includes(ext)) {
    patterns.push(
      /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
      /\bclass\s+([A-Za-z_$][\w$]*)/g,
      /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g
    );
  } else if (ext === '.py') {
    patterns.push(/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm, /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/gm);
  } else if (ext === '.go') {
    patterns.push(/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g, /\btype\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/g);
  } else if (ext === '.rs') {
    patterns.push(/\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g, /\b(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)\b/g);
  } else {
    patterns.push(/\b(?:class|function)\s+([A-Za-z_]\w*)\b/g);
  }
  const symbols = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && symbols.length < 24) {
      if (!symbols.includes(match[1])) symbols.push(match[1]);
    }
  }
  return symbols;
}

function scoreSourceForTask(file, symbols, terms) {
  const hay = `${file.path} ${symbols.join(' ')}`.toLowerCase();
  let score = 0;
  for (const term of terms) if (hay.includes(term)) score += 50;
  if (/^(src|app|apps|packages|server|bot|lib)\//.test(file.path)) score += 12;
  if (/(test|spec)\.[^.]+$/.test(file.path) || file.path.includes('/test/')) score += terms.includes('test') ? 18 : -8;
  if (file.path.includes('/scripts/')) score += 4;
  if (file.lines > 0 && file.lines <= 240) score += 8;
  if (file.lines > 600) score -= 12;
  if (file.ageDays <= 14) score += 4;
  return score;
}

function estimateTextTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function buildRepoMap(project, flags = {}) {
  const cfg = readConfig(project);
  const task = flags.task || flags.query || '';
  const terms = queryTerms(task);
  const budgetTokens = Math.max(800, Number(flags.budget || flags['repo-map-budget'] || flags.repoMapBudget || 4000));
  const rows = sourceFiles(project, cfg).map((file) => {
    let text = '';
    try { text = fs.readFileSync(file.abs, 'utf8'); } catch {}
    const symbols = extractSymbols(file.path, text);
    const hay = `${file.path} ${symbols.join(' ')}`.toLowerCase();
    const termMatches = terms.filter((term) => hay.includes(term)).length;
    return {
      path: file.path,
      lines: file.lines,
      symbols: symbols.slice(0, 10),
      score: scoreSourceForTask(file, symbols, terms),
      termMatches,
    };
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const included = [];
  let estimatedTokens = 250;
  for (const row of rows) {
    const symbolText = row.symbols.length ? row.symbols.join(', ') : 'no exported symbols found';
    const line = `- ${row.path} (${row.lines}l) symbols: ${symbolText}`;
    const cost = estimateTextTokens(line) + 8;
    if (included.length >= 80 || (included.length >= 8 && estimatedTokens + cost > budgetTokens)) break;
    included.push({
      path: row.path,
      lines: row.lines,
      symbols: row.symbols,
      reason: row.termMatches > 0 ? 'task/path/symbol match' : 'high-signal source file',
    });
    estimatedTokens += cost;
  }

  return {
    project,
    task: task || null,
    budgetTokens,
    estimatedTokens,
    sourceFilesScanned: rows.length,
    includedFiles: included,
    omittedFiles: Math.max(0, rows.length - included.length),
    command: `${commandName()} repo-map ${quotePath(project)} --task ${JSON.stringify(task || '...')}`,
    readStrategy: 'Read repo-map first, then only listed files plus direct dependencies discovered by exact search.',
  };
}

function formatRepoMap(map) {
  const lines = [
    '# repo map',
    '',
    `project: ${path.basename(map.project)}`,
    `task: ${map.task || '-'}`,
    `budget: ~${map.budgetTokens} tokens`,
    `estimated: ~${map.estimatedTokens} tokens`,
    `source files scanned: ${map.sourceFilesScanned}`,
    `omitted: ${map.omittedFiles}`,
    '',
    'read strategy:',
    `- ${map.readStrategy}`,
    '- use exact `rg -n "term"` from this map before opening more files',
    '- do not dump full file lists or long logs into chat',
    '',
    'top source files:',
  ];
  if (!map.includedFiles.length) lines.push('- no source files found');
  for (const f of map.includedFiles) {
    const symbols = f.symbols.length ? f.symbols.join(', ') : 'no exported symbols found';
    lines.push(`- ${f.path} (${f.lines}l) symbols: ${symbols}`);
  }
  return lines.join('\n');
}

function repoMap(project, flags = {}) {
  const result = buildRepoMap(project, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatRepoMap(result));
  return result;
}

function buildToolGuard(project, flags = {}) {
  const task = flags.task || flags.query || null;
  const pressure = pressureResult(project, {
    tokens: flags.tokens || 0,
    'max-tokens': flags['max-tokens'] || flags.maxTokens || 0,
    messages: flags.messages || 0,
    'tool-lines': flags['tool-lines'] || flags.toolLines || 0,
  });
  const highPressure = ['compact-soon', 'compact-now'].includes(pressure.level);
  const maxOutputTokens = highPressure ? 6000 : TOOL_GUARD_DEFAULTS.maxOutputTokens;
  const broadSearchMaxOutputTokens = highPressure ? 4000 : TOOL_GUARD_DEFAULTS.broadSearchMaxOutputTokens;
  return {
    project,
    task,
    pressureLevel: pressure.level,
    maxOutputTokens,
    broadSearchMaxOutputTokens,
    logTailLines: TOOL_GUARD_DEFAULTS.logTailLines,
    maxSubagentsBeforePack: TOOL_GUARD_DEFAULTS.maxSubagentsBeforePack,
    beforeBroadWork: [
      `${commandName()} pack ${quotePath(project)} --task ${JSON.stringify(task || '...')}`,
      `${commandName()} repo-map ${quotePath(project)} --task ${JSON.stringify(task || '...')}`,
    ],
    rules: [
      'Run pack + repo-map before broad source reading, multi-agent work, or long debug loops.',
      'Prefer exact `rg -n "symptom|symbol"` over full `rg --files` dumps.',
      `Tail logs to ${TOOL_GUARD_DEFAULTS.logTailLines} lines unless the task explicitly needs more.`,
      'Summarize command output; do not paste raw logs/transcripts into worklogs, Graphiti, Obsidian, or chat.',
      'If output is still large, rerun with narrower terms instead of increasing the output budget.',
    ],
  };
}

function formatToolGuard(guard) {
  return [
    '# tool guard',
    '',
    `project: ${path.basename(guard.project)}`,
    `task: ${guard.task || '-'}`,
    `pressure: ${guard.pressureLevel}`,
    `max_output_tokens: ${guard.maxOutputTokens}`,
    `broad_search_max_output_tokens: ${guard.broadSearchMaxOutputTokens}`,
    `log_tail_lines: ${guard.logTailLines}`,
    `max_subagents_before_pack: ${guard.maxSubagentsBeforePack}`,
    '',
    'before broad work:',
    ...guard.beforeBroadWork.map((cmd) => `- ${cmd}`),
    '',
    'rules:',
    ...guard.rules.map((rule) => `- ${rule}`),
  ].join('\n');
}

function toolGuard(project, flags = {}) {
  const result = buildToolGuard(project, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatToolGuard(result));
  return result;
}

function classify(file) {
  const p = file.path.toLowerCase();
  const base = path.basename(p, '.md');
  if (p.startsWith('templates/') || p.includes('/templates/')) return 'template';
  if (p.includes('/archive/') || p.includes('context-heavy')) return 'archive';
  if (p.includes('/node_modules/') || p.includes('/.venv/')) return 'vendor';
  if (p.startsWith('.agents/skills/') || p.includes('/.agents/skills/')) return 'agent-skill';
  if (p.startsWith('.claude/skills/') || p.includes('/.claude/skills/')) return 'agent-skill';
  if (p.startsWith('.github/skills/') || p.includes('/.github/skills/')) return 'agent-skill';
  if (p === 'agents.md' || p === 'claude.md' || p.endsWith('/agents.md') || p.endsWith('/claude.md')) return 'agent-entry';
  if (base === 'current_state' || base === 'current-state' || base === 'handoff' || base === 'worklog' || base === 'daily') return 'active-memory';
  if (base.includes('decision')) return 'decision';
  if (base.endsWith('-policy') || p.startsWith('references/') || p.includes('/references/') || p.includes('runbook') || p.includes('audit') || p.includes('research') || p.includes('plan')) return 'deep-reference';
  if (base === 'design' || base === 'product' || base === 'project' || p.startsWith('docs/')) return 'product-context';
  return 'other';
}

function sourceScore(file) {
  const role = classify(file);
  const p = file.path.toLowerCase();
  const ageDays = Number.isFinite(file.ageDays) ? file.ageDays : null;
  let authority = 40;
  if (['agent-entry', 'active-memory', 'decision', 'product-context'].includes(role)) authority += 25;
  if (p.includes('current_state') || p.includes('context_index') || p === 'agents.md') authority += 20;
  if (p.includes('product.md') || p.includes('design.md')) authority += 10;
  if (ageDays !== null && ageDays <= 14 && ['active-memory', 'decision'].includes(role)) authority += 10;
  if (role === 'archive' || role === 'deep-reference' || role === 'template') authority -= 15;
  if (role === 'agent-skill') authority -= 10;
  if (ageDays !== null && ageDays > 120 && !p.includes('/archive/')) authority -= 10;

  let risk = 0;
  if (file.lines > 400) risk += 25;
  if (/secret|credential|env|access|pricing|price|token/i.test(file.path)) risk += 25;
  if (/infra|infrastructure/i.test(file.path)) risk += 45;
  if (/plan|architecture|status/i.test(file.path) && file.lines > 100) risk += 10;
  if (/handoff/i.test(file.path) && file.lines > 260) risk += 20;
  if (ageDays !== null && ageDays > 90 && /plan|architecture|status|handoff|roadmap/i.test(file.path)) risk += 15;
  if (role === 'archive') risk += 20;

  let readCost = Math.ceil(file.lines / 50);
  let recommendation = 'scoped-read';
  if (authority >= 75 && risk < 30 && file.lines <= 260) recommendation = 'default-read';
  if (file.lines > 400 || role === 'deep-reference') recommendation = 'archive-or-scoped';
  if (risk >= 45) recommendation = 'deny-by-default';
  if (role === 'agent-skill') recommendation = 'adapter-only';
  if (role === 'template') recommendation = 'scoped-read';
  const confidence = Math.max(10, Math.min(95, authority - Math.floor(risk / 2)));

  return { path: file.path, role, lines: file.lines, ageDays, authority, risk, readCost, confidence, recommendation };
}

function scanTerms(files) {
  const terms = {};
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(f.abs, 'utf8').toLowerCase(); } catch { continue; }
    for (const term of DUPLICATE_TERMS) {
      const count = (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (!count) continue;
      terms[term] ||= [];
      terms[term].push({ path: f.path, count });
    }
  }
  return Object.fromEntries(Object.entries(terms)
    .map(([term, hits]) => [term, hits.sort((a, b) => b.count - a.count)])
    .filter(([, hits]) => hits.length >= 3 || hits.reduce((s, h) => s + h.count, 0) >= 15));
}

function hermes(projectName) {
  const dir = path.join(os.homedir(), '.hermes/projects');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .filter((f) => !projectName || path.basename(f, '.md').includes(projectName.toLowerCase()));
}

function profileFor(project) {
  const cfg = readConfig(project);
  return loadProfiles(project, cfg).find((p) => profileMatches(p, project)) || normalizeProfile(GENERIC_PROFILE);
}

function existing(project, files) {
  return files.filter((f) => f.startsWith('~/') || fs.existsSync(path.join(project, f)));
}

function standardFilesFor(project) {
  const p = profileFor(project);
  return Object.fromEntries(Object.entries(STANDARD_ROLES).map(([role, def]) => {
    const configured = p.standardFiles?.[role];
    return [role, configured === null ? null : configured || def.path];
  }));
}

function standardTargets(project) {
  const standards = standardFilesFor(project);
  return Object.entries(STANDARD_ROLES)
    .map(([role, def]) => [standards[role], def.template])
    .filter(([target]) => Boolean(target));
}

function missingStandardFiles(project) {
  return standardTargets(project)
    .map(([target]) => target)
    .filter((target) => !fs.existsSync(path.join(project, target)));
}

function standardPath(project, role) {
  return standardFilesFor(project)[role];
}

function graphitiStats() {
  const dir = path.join(os.homedir(), '.hermes/graphiti');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
  return {
    dir,
    files: files.map((f) => ({ path: f, bytes: fs.statSync(f).size })),
  };
}

function audit(project, flags = {}) {
  const cfg = readConfig(project);
  const files = mdFiles(project, cfg);
  const byClass = {};
  for (const f of files) {
    const c = classify(f);
    byClass[c] ||= [];
    byClass[c].push({ path: f.path, lines: f.lines });
  }

  const exists = (p) => fs.existsSync(path.join(project, p));
  const missing = missingStandardFiles(project);
  const considered = files.filter((f) => !['vendor'].includes(classify(f)));
  const large = considered.filter((f) => f.lines > (cfg.budgets?.largeDocLines || 400)).map((f) => ({ path: f.path, lines: f.lines }));
  const duplicateEntrySurfaces = files
    .filter((f) => ['agent-entry'].includes(classify(f)))
    .map((f) => ({ path: f.path, lines: f.lines }));
  const activeMemory = considered.filter((f) => ['active-memory', 'product-context'].includes(classify(f))).map((f) => ({ path: f.path, lines: f.lines }));
  const duplicateTerms = scanTerms(considered.filter((f) => !f.path.includes('/archive/') && classify(f) !== 'agent-skill'));
  const hotContextLines = activeMemory.reduce((sum, f) => sum + f.lines, 0) + duplicateEntrySurfaces.reduce((sum, f) => sum + f.lines, 0);
  const broadContextFiles = new Map();
  for (const f of activeMemory) broadContextFiles.set(f.path, f.lines);
  for (const f of duplicateEntrySurfaces) broadContextFiles.set(f.path, f.lines);
  for (const f of large.filter((x) => !x.path.includes('/archive/'))) broadContextFiles.set(f.path, f.lines);
  const broadContextLines = [...broadContextFiles.values()].reduce((sum, lines) => sum + lines, 0);
  const risks = [];
  if (standardPath(project, 'contextIndex') && missing.includes(standardPath(project, 'contextIndex'))) risks.push('missing-default-context-index');
  if (large.some((f) => classify(f) !== 'archive')) risks.push('large-active-docs');
  if (duplicateEntrySurfaces.length > 2) risks.push('many-agent-entry-surfaces');
  if (!activeMemory.length) risks.push('missing-active-memory');
  if (hotContextLines > 800) risks.push('hot-context-over-budget');

  const report = {
    project,
    markdownCount: files.length,
    missing,
    risks,
    large,
    duplicateEntrySurfaces,
    duplicateTerms,
    hotContextLines,
    broadContextLines,
    activeMemory,
    byClass,
    hermesCandidates: hermes(path.basename(project).toLowerCase()),
    graphiti: graphitiStats(),
    scores: considered.map(sourceScore).sort((a, b) => (b.authority - b.risk) - (a.authority - a.risk)).slice(0, 120),
  };
  if (!flags.quiet) {
    if (flags.json) console.log(JSON.stringify(report, null, 2));
    else printAudit(report);
  }
  return report;
}

function printAudit(r) {
  const level = auditLevel(r);
  const savings = estimateAuditSavings(r, r.project);
  const next = nextFromAudit(r, r.project);
  const projectName = path.basename(r.project);
  const verdict = auditVerdict(level, r);

  console.log(`${bold('Larpkeeper audit')} ${dim(`(${projectName})`)}`);
  console.log(`${dim('Context map:')} ${statusColor(level)}  ${dim('what is real, what is noise, what to read now')}`);
  console.log(`\n${verdict}`);
  console.log('');
  console.log(`project        ${r.project}`);
  console.log(`markdown       ${r.markdownCount} files`);
  console.log(`profile        ${savings.profile}`);
  console.log(`hot context    ${r.hotContextLines} lines`);
  console.log(`broad context  ${r.broadContextLines} lines`);
  console.log(`risks          ${r.risks.length ? r.risks.join(', ') : 'none'}`);

  section('Default Start Estimate');
  console.log(`before         ${savings.beforeLines} lines (~${savings.beforeTokens} tok)`);
  console.log(`default start  ${savings.afterLines} lines (~${savings.afterTokens} tok)`);
  console.log(`avoided/start  ${savings.savedLines} lines (~${savings.savedTokens} tok, ${savings.savedPct}%)`);
  console.log(`confidence     ${savings.confidence} - ${savings.confidenceReason}`);
  if (savings.readPack.length) {
    console.log(`read first     ${savings.readPack.join(', ')}`);
  } else {
    console.log(`read first     missing; bootstrap or add a project profile`);
  }
  console.log(`task pack      run ${commandName()} pack ${quotePath(r.project)} --task "..."`);

  section('What This Means');
  console.log(humanAuditSummary(r, savings));

  section('Why It Helps');
  bullet('agent starts from ranked sources instead of reading markdown chaos');
  bullet('old research and handoffs stay available but out of hot context');
  bullet('fewer stale instructions compete with current code and docs');
  bullet('journal/decisions/current state become the stable memory layer');

  section('Next Move');
  console.log(`  ${cyan(next.command)}`);
  console.log(`  ${dim(next.reason)}`);

  section('Safe Fixes');
  if (r.missing.length) bullet(`${commandName()} bootstrap ${quotePath(r.project)} --apply  ${dim('creates missing standard docs')}`);
  const handoff = firstExisting(r.project, ['handoff.md', 'docs/HANDOFF.md']);
  if (handoff && lineCount(path.join(r.project, handoff)) > 260) bullet(`${commandName()} compact-handoff ${quotePath(r.project)} --file ${handoff} --apply  ${dim('archives old material first')}`);
  if (r.large.some((f) => !f.path.includes('/archive/'))) bullet(`${commandName()} prune ${quotePath(r.project)}  ${dim('plan archive/split candidates')}`);
  if (!r.missing.length && !r.large.some((f) => !f.path.includes('/archive/')) && !(handoff && lineCount(path.join(r.project, handoff)) > 260)) bullet(`${commandName()} pack ${quotePath(r.project)} --task "..."  ${dim('no obvious safe cleanup needed')}`);

  if (r.missing.length) {
    section('Missing Standard Files');
    console.log('These are context-maintenance files Larpkeeper expected from this project profile but could not find.');
    for (const p of r.missing) {
      const role = standardRoleForPath(r.project, p);
      console.log(`- ${p}`);
      console.log(`  purpose: ${standardRolePurpose(role, p)}`);
      console.log(`  impact: ${standardRoleImpact(role)}`);
    }
  }
  if (r.duplicateEntrySurfaces.length) {
    section('Agent Entry Surfaces');
    for (const f of r.duplicateEntrySurfaces) console.log(`- ${f.path} (${f.lines} lines)`);
  }
  if (r.large.length) {
    section('Large Docs');
    for (const f of r.large.slice(0, 20)) console.log(`- ${f.path} (${f.lines} lines)`);
  }
  if (r.activeMemory.length) {
    section('Active Memory/Product Docs');
    for (const f of r.activeMemory.slice(0, 20)) console.log(`- ${f.path} (${f.lines} lines)`);
  }
  const deny = r.scores.filter((s) => s.recommendation === 'deny-by-default').slice(0, 8);
  if (deny.length) {
    section('Deny By Default Candidates');
    for (const f of deny) console.log(`- ${f.path} (${f.lines} lines, risk ${f.risk})`);
  }
  const noisyTerms = Object.entries(r.duplicateTerms).slice(0, 12);
  if (noisyTerms.length) {
    section('Repeated Terms Across Active Docs');
    for (const [term, hits] of noisyTerms) {
      const total = hits.reduce((s, h) => s + h.count, 0);
      console.log(`- ${term}: ${total} hits in ${hits.length} files`);
    }
  }
}

function auditVerdict(level, r) {
  if (level === 'ok') return 'Verdict: context looks usable. Use `pack --task "..."` before work and keep going.';
  if (r.risks.includes('hot-context-over-budget')) return 'Verdict: this repo has useful context, but too much of it is hot. Start from a task pack before reading broad docs.';
  if (r.missing.length) return 'Verdict: context structure is incomplete. Add the missing context files or configure profile aliases before relying on broad audit output.';
  return 'Verdict: context is usable, but there are cleanup signals worth checking before long work.';
}

function humanAuditSummary(r, savings) {
  const parts = [];
  parts.push(`Default startup can read about ${savings.afterLines} lines instead of ${savings.beforeLines}, saving roughly ${savings.savedPct}% of broad markdown context.`);
  if (r.missing.length) parts.push(`${r.missing.length} expected context file${r.missing.length === 1 ? ' is' : 's are'} missing; this usually means new sessions lack a clear routing, worklog, journal, or archive policy layer.`);
  if (r.duplicateEntrySurfaces.length > 2) parts.push(`${r.duplicateEntrySurfaces.length} agent entry files exist; agents may see overlapping instructions unless one entrypoint routes to the others.`);
  if (r.large.some((f) => !f.path.includes('/archive/'))) parts.push('Some large active docs should stay scoped to tasks or get compact companion summaries.');
  if (!r.risks.length) parts.push('No major context-health risks were detected.');
  return parts.join(' ');
}

function standardRoleForPath(project, file) {
  for (const [role, configured] of Object.entries(standardFilesFor(project))) {
    if (configured === file) return role;
  }
  return null;
}

function standardRolePurpose(role, file) {
  const purposes = {
    contextIndex: 'routing map: tells agents which docs to read for which task',
    currentState: 'current truth: what is real now without old session history',
    worklog: 'recent continuity: compact done/doing/next/evidence between sessions',
    decisions: 'decision record: durable choices and constraints',
    journal: 'maintenance log: records context changes and why they happened',
    archivePolicy: 'cold-storage policy: explains where old heavy context goes and when to read it',
  };
  return purposes[role] || contextFilePurpose(file);
}

function standardRoleImpact(role) {
  const impacts = {
    contextIndex: 'agents may read too broadly or miss the right source of truth',
    currentState: 'agents may trust stale docs over current runtime reality',
    worklog: 'session continuity may be lost or overstuffed into handoff files',
    decisions: 'old debates may be reopened because accepted decisions are hard to find',
    journal: 'context maintenance changes become hard to audit later',
    archivePolicy: 'old transcripts and heavy notes may drift back into hot context',
  };
  return impacts[role] || 'context hygiene is weaker until this file exists or the profile points elsewhere';
}

function score(project, flags = {}) {
  const cfg = readConfig(project);
  const rows = mdFiles(project, cfg)
    .filter((f) => classify(f) !== 'vendor')
    .map(sourceScore)
    .sort((a, b) => {
      const order = { 'default-read': 0, 'scoped-read': 1, 'archive-or-scoped': 2, 'adapter-only': 3, 'deny-by-default': 4 };
      return (order[a.recommendation] ?? 9) - (order[b.recommendation] ?? 9) || b.authority - a.authority;
    });
  if (flags.json) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`# source score\n`);
    for (const r of rows.slice(0, 80)) {
      console.log(`- ${r.recommendation.padEnd(17)} ${r.path} (${r.lines}l, role=${r.role}, authority=${r.authority}, risk=${r.risk})`);
    }
  }
}

function init(project, flags = {}) {
  const planned = [];
  for (const [target, template] of standardTargets(project)) {
    const out = path.join(project, target);
    if (fs.existsSync(out)) continue;
    planned.push(target);
    if (flags.apply) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'templates', template), out);
    }
  }
  const cfgOut = path.join(project, 'larpkeeper.config.json');
  if (!fs.existsSync(cfgOut)) {
    planned.push('larpkeeper.config.json');
    if (flags.apply) fs.copyFileSync(path.join(ROOT, 'larpkeeper.config.example.json'), cfgOut);
  }
  console.log(`${flags.apply ? 'created' : 'would create'}:`);
  for (const p of planned) console.log(`- ${p}`);
  if (!planned.length) console.log('- nothing');
}

function installAdapter(project, flags = {}) {
  const target = flags.target || 'agents';
  const map = {
    agents: ['adapters/agents/AGENTS_CONTEXT_BLOCK.md', 'docs/AGENT_CONTEXT.md', 'AGENTS.md'],
    claude: ['adapters/claude/CLAUDE_CONTEXT_BLOCK.md', 'docs/AGENT_CONTEXT.md', 'CLAUDE.md'],
  };
  if (!map[target]) throw new Error('--target must be agents or claude');
  const [srcRel, dstRel, entryRel] = map[target];
  const dst = path.join(project, dstRel);
  const entry = path.join(project, entryRel);
  const block = managedAdapterBlock(target, dstRel, flags['owner-name'] || flags.ownerName);
  if (flags.apply) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, srcRel), dst);
    writeManagedBlock(entry, block);
  }
  console.log(`${flags.apply ? 'installed' : 'would install'} ${target} adapter: ${dstRel}`);
  console.log(`${flags.apply ? 'updated' : 'would update'} ${entryRel} with a managed Larpkeeper block.`);
  if (!(flags['owner-name'] || flags.ownerName)) {
    console.log(`owner name not set; pass --owner-name so agents address the human consistently and context loss is visible.`);
  }
}

function managedAdapterBlock(target, docRel, ownerName) {
  const entryName = target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
  const ownerLines = ownerName ? [
    `Owner address form: \`${ownerName}\`.`,
    `Address the owner as \`${ownerName}\` in every user-facing prompt, update, report, and final answer.`,
    'If context seems stale, contradictory, or lost, say that plainly; the address form must remain visible so the human can notice drift.',
    '',
  ] : [
    'Owner address form is not set. Ask the human how to address them before writing persistent project instructions or long reports.',
    '',
  ];
  return [
    '<!-- LARPK:START -->',
    '<!-- LARPK:VERSION:0.1 -->',
    '',
    '## Larpkeeper - Context Gate',
    '',
    `This project uses Larpkeeper for context hygiene. Full adapter: \`${docRel}\`.`,
    '',
    ...ownerLines,
    'Before broad markdown/source reading, long logs, or multi-agent work:',
    '',
    '```bash',
    'larp audit .',
    'larp recommend .',
    'larp pack . --task "..."',
    'larp repo-map . --task "..."',
    'larp tool-guard . --task "..."',
    '```',
    '',
    'After `audit`, tell the human: health, cleanup potential, missing files, and next safe command.',
    'Before `rg --files`, broad `rg`, Docker/container logs over 80 lines, or more than one subagent: run `pack` + `repo-map`, then read only the returned docs/source files and exact-search dependencies.',
    'Keep shell outputs compact: prefer exact searches, `--tail 80` for logs, and `max_output_tokens` near the `tool-guard` recommendation. Summarize outputs instead of pasting raw logs.',
    'After meaningful completed work, offer or write a compact worklog-style completion: what was done, what became better, evidence/tests, deploy status, decisions/blockers, and next step.',
    'Destination policy: repo md gets operational detail; Obsidian gets durable human memory/preferences/cross-project summaries; Graphiti gets compact sourced facts only; chat/DM gets concise rich Markdown for the owner.',
    'Use `--apply` only when the human wants context files changed.',
    'Do not read `docs/archive/context-heavy/` unless the task needs old history or contradiction resolution.',
    '',
    `Keep this block near the bottom of \`${entryName}\` so it is visible like an operating layer, not mixed into product truth.`,
    '',
    '<!-- LARPK:END -->',
    '',
  ].join('\n');
}

function writeManagedBlock(file, block) {
  const start = '<!-- LARPK:START -->';
  const end = '<!-- LARPK:END -->';
  writeManagedText(file, block, start, end);
}

function writeManagedText(file, block, start, end) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, block)
    : current.trim() ? `${current.replace(/\s*$/, '')}\n\n${block}` : block;
  fs.writeFileSync(file, next);
}

function shellHookBlock(flags = {}) {
  const mode = flags.mode || 'right';
  const style = flags.style || 'compact';
  const command = style === 'ascii' ? 'hud "$PWD" --style ascii' : 'statusline "$PWD" --zsh';
  const render = mode === 'above'
    ? [
        '  RPROMPT=""',
        '  print -P "$larp_status_line"',
      ]
    : [
        '  RPROMPT="${larp_status_line}"',
      ];
  return [
    '# LARPK:SHELL:START',
    '# Larpkeeper prompt status. Managed by `larp install-shell-hook --apply`.',
    '_larpkeeper_prompt_status() {',
    '  command -v larp >/dev/null 2>&1 || return',
    '  local larp_status_line',
    `  larp_status_line="$(command larp ${command} 2>/dev/null)" || return`,
    '  [[ -n "$larp_status_line" ]] || return',
    ...render,
    '}',
    'autoload -Uz add-zsh-hook',
    'add-zsh-hook precmd _larpkeeper_prompt_status',
    '# LARPK:SHELL:END',
    '',
  ].join('\n');
}

function installShellHook(project, flags = {}) {
  const file = path.join(os.homedir(), '.zshrc');
  const block = shellHookBlock(flags);
  if (flags.apply) writeManagedText(file, block, '# LARPK:SHELL:START', '# LARPK:SHELL:END');
  if (flags.json) {
    console.log(JSON.stringify({ file, apply: Boolean(flags.apply), block }, null, 2));
    return;
  }
  console.log(`# Larpkeeper shell hook\n`);
  console.log(`${flags.apply ? 'updated' : 'would update'}: ${file}`);
  console.log(`display: zsh ${flags.mode === 'above' ? 'above-prompt line' : 'RPROMPT'}`);
  console.log(`style: ${flags.style || 'compact'}`);
  console.log(`preview: ${commandName()} statusline ${quotePath(project)}`);
  if (!flags.apply) console.log(`\nnext: ${commandName()} install-shell-hook --apply`);
}

function banner(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const level = auditLevel(r);
  const redText = USE_COLOR || flags.color ? `\x1b[31;1mLarpkeeper\x1b[0m` : 'Larpkeeper';
  const yellowLevel = USE_COLOR || flags.color ? `\x1b[33m${level}\x1b[0m` : level;
  console.log(`${redText} ${yellowLevel}  ${path.basename(project)}  hot=${r.hotContextLines}l broad=${r.broadContextLines}l`);
  console.log(`next: ${nextFromAudit(r, project).command}`);
}

function launchCodex(project, flags = {}) {
  banner(project, { color: true });
  console.log(dim('Note: Codex TUI does not expose a public statusline slot here; this banner is printed before launch.'));
  const args = [];
  if (flags['no-alt-screen'] || flags.noAltScreen) args.push('--no-alt-screen');
  args.push('-C', project);
  const sep = process.argv.indexOf('--');
  if (sep !== -1) args.push(...process.argv.slice(sep + 1));
  const result = spawnSync('codex', args, { stdio: 'inherit' });
  process.exitCode = result.status ?? 0;
}

function pack(project, flags = {}) {
  const g = buildGather(project, { ...flags, query: flags.query || flags.task });
  const read = g.recommendedContextPack;
  const repo = buildRepoMap(project, { ...flags, budget: flags['repo-map-budget'] || flags.repoMapBudget || 2500 });
  const guard = buildToolGuard(project, flags);
  const pack = {
    project,
    task: flags.task || null,
    profile: g.profile,
    readFirst: read,
    repoMap: {
      command: repo.command,
      budgetTokens: repo.budgetTokens,
      estimatedTokens: repo.estimatedTokens,
      topFiles: repo.includedFiles.slice(0, 12),
      omittedFiles: repo.omittedFiles,
    },
    toolGuard: {
      maxOutputTokens: guard.maxOutputTokens,
      broadSearchMaxOutputTokens: guard.broadSearchMaxOutputTokens,
      logTailLines: guard.logTailLines,
      beforeBroadWork: guard.beforeBroadWork,
      rules: guard.rules,
    },
    avoidByDefault: [
      ...g.denyByDefault,
      ...g.archiveCandidates.slice(0, 12),
      'docs/archive/context-heavy/**',
      'large runbooks unless changing that subsystem',
      'old audits unless resolving contradictions',
    ],
    risks: g.risks,
    hotContextLines: g.hotContextLines,
    broadContextLines: g.broadContextLines,
    whyIncluded: g.whyIncluded,
  };
  if (flags.json) console.log(JSON.stringify(pack, null, 2));
  else {
    console.log(`# context pack\n`);
    console.log(`profile: ${pack.profile}`);
    for (const p of pack.readFirst) console.log(`- ${p}`);
    const reasons = pack.whyIncluded.filter((item) => pack.readFirst.includes(item.path));
    if (reasons.length) {
      console.log(`\nwhy:`);
      for (const item of reasons) console.log(`- ${item.path}: ${item.reason}`);
    }
    if (pack.repoMap.topFiles.length) {
      console.log(`\nrepo map:`);
      console.log(`- ${pack.repoMap.command}`);
      for (const item of pack.repoMap.topFiles.slice(0, 8)) {
        const symbols = item.symbols.length ? ` symbols: ${item.symbols.join(', ')}` : '';
        console.log(`- ${item.path} (${item.lines}l)${symbols}`);
      }
    }
    console.log(`\ntool guard:`);
    console.log(`- max_output_tokens: ${pack.toolGuard.maxOutputTokens}`);
    console.log(`- broad search max_output_tokens: ${pack.toolGuard.broadSearchMaxOutputTokens}`);
    console.log(`- log tail: ${pack.toolGuard.logTailLines} lines`);
    const avoid = pack.avoidByDefault.filter(Boolean).slice(0, 8);
    if (avoid.length) {
      console.log(`\navoid by default:`);
      for (const item of avoid) console.log(`- ${item}`);
    }
    console.log(`\nhot context estimate: ${pack.hotContextLines} lines`);
    if (pack.risks.length) console.log(`risks: ${pack.risks.join(', ')}`);
  }
}

function buildGather(project, flags = {}, auditResult = null) {
  const query = String(flags.query || flags.task || '').toLowerCase();
  const budget = Number(flags.budget || 6000);
  const p = profileFor(project);
  const r = auditResult || audit(project, { quiet: true });
  const defaultRead = existing(project, p.defaultRead);
  const scopedRead = [];
  const whyIncluded = [];
  for (const file of defaultRead) whyIncluded.push({ path: file, reason: `${p.id} default read` });
  for (const [pattern, files] of p.scoped || []) {
    if (!query || new RegExp(pattern, 'i').test(query)) {
      for (const file of existing(project, files)) {
        if (!defaultRead.includes(file) && !scopedRead.includes(file)) {
          scopedRead.push(file);
          whyIncluded.push({ path: file, reason: `query matched /${pattern}/` });
        }
      }
    }
  }
  const selected = new Set([...defaultRead, ...scopedRead]);
  const archiveCandidates = [...new Set([
    ...p.archiveHints.filter((f) => fs.existsSync(path.join(project, f))),
    ...r.large.filter((f) => !f.path.includes('/archive/')).map((f) => f.path),
  ])].filter((f) => !selected.has(f));
  const staleWarnings = [];
  for (const f of p.archiveHints) if (fs.existsSync(path.join(project, f))) staleWarnings.push(`${f} should not be default-read`);
  const result = {
    project,
    profile: p.id,
    query: flags.query || null,
    role: flags.role || null,
    budget,
    risks: r.risks,
    hotContextLines: r.hotContextLines,
    broadContextLines: r.broadContextLines,
    defaultRead,
    scopedRead,
    denyByDefault: p.denyByDefault,
    archiveCandidates,
    staleWarnings,
    duplicates: flags.verbose ? r.duplicateTerms : undefined,
    duplicateSummary: Object.fromEntries(Object.entries(r.duplicateTerms || {}).map(([term, hits]) => [term, {
      files: hits.length,
      hits: hits.reduce((sum, hit) => sum + hit.count, 0),
    }])),
    recommendedContextPack: [...defaultRead, ...scopedRead].slice(0, Math.max(1, Math.floor(budget / 800))),
    whyIncluded,
    whySkipped: archiveCandidates.map((path) => ({ path, reason: 'archive/heavy/stale candidate' })),
  };
  if (!result.recommendedContextPack.length) {
    result.noReadPack = true;
    result.whySkipped.unshift({ path: '(none)', reason: 'no profile/default files exist; initialize context or add project profile' });
  }
  return result;
}

function gather(project, flags = {}) {
  const result = buildGather(project, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (flags.brief) console.log(`${result.profile}: ${result.recommendedContextPack.join(', ') || 'no-read-pack'}`);
  else {
    console.log(`# context gather\n`);
    console.log(`profile: ${result.profile}`);
    console.log(`query: ${result.query || '-'}`);
    console.log(`\ndefaultRead:`);
    for (const f of result.defaultRead) console.log(`- ${f}`);
    if (result.scopedRead.length) {
      console.log(`\nscopedRead:`);
      for (const f of result.scopedRead) console.log(`- ${f}`);
    }
    if (result.archiveCandidates.length) {
      console.log(`\narchiveCandidates / skip by default:`);
      for (const f of result.archiveCandidates.slice(0, 20)) console.log(`- ${f}`);
    }
  }
}

function budget(project, flags = {}) {
  const result = computeBudget(project, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else printBudget(result);
  return result;
}

function caveman(project, flags = {}) {
  const g = profileFor(project);
  const r = audit(project, { quiet: true });
  const lines = [
    '# Caveman Context',
    '',
    `- project: ${path.basename(project)}`,
    `- profile: ${g.id}`,
    `- read: ${existing(project, g.defaultRead).slice(0, 4).join(', ') || 'missing index'}`,
    `- hot lines: ${r.hotContextLines}`,
    `- risks: ${r.risks.join(', ') || 'none'}`,
    `- skip: ${(g.archiveHints || []).slice(0, 4).join(', ') || 'archives/long docs'}`,
    `- next: run gather with task query`,
    '',
  ];
  const out = path.join(project, 'docs/CAVEMAN_CONTEXT.md');
  if (flags.apply) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join('\n'));
  }
  console.log(lines.join('\n'));
  if (!flags.apply) console.log('dry-run: use --apply to write docs/CAVEMAN_CONTEXT.md');
}

function computeBudget(project, flags = {}) {
  const targetLines = Number(flags['target-lines'] || flags.targetLines || 500);
  const r = audit(project, { quiet: true });
  const g = buildGather(project, flags, r);
  const unique = [...new Set(g.recommendedContextPack)];
  const after = unique.reduce((sum, f) => {
    if (f.startsWith('~/')) return sum + 40;
    return sum + lineCount(path.join(project, f));
  }, 0);
  const before = r.broadContextLines || r.hotContextLines || 0;
  const noReadPack = unique.length === 0;
  const saved = noReadPack ? 0 : Math.max(0, before - after);
  const savedPct = before && !noReadPack ? Math.round((saved / before) * 100) : 0;
  const hasTaskSignal = Boolean(flags.query || flags.task);
  return {
    project,
    query: flags.query || null,
    task: flags.task || null,
    brief: Boolean(flags.brief),
    profile: g.profile,
    estimateKind: hasTaskSignal ? 'task-pack' : 'default-start',
    confidence: noReadPack ? 'low' : hasTaskSignal ? 'medium' : 'medium',
    confidenceReason: noReadPack
      ? 'no read pack exists yet'
      : hasTaskSignal
        ? 'matched profile defaults plus scoped docs from query/task; still verify touched source files'
        : 'default profile only; add --query or --task for task-specific context',
    noReadPack,
    beforeLines: before,
    afterLines: after,
    beforeTokens: approxTokensFromLines(before),
    afterTokens: approxTokensFromLines(after),
    targetLines,
    savedLines: saved,
    savedTokens: approxTokensFromLines(saved),
    savedPct,
    approxUsdSavedPerRead: money(approxTokensFromLines(saved)),
    status: noReadPack ? 'no-read-pack' : after <= targetLines ? 'within-target' : 'over-target',
    readPack: unique,
    reduceCandidates: r.large.filter((f) => !unique.includes(f.path)).slice(0, 20),
  };
}

function printBudget(result) {
  if (result.brief) {
    console.log(`mode: ${result.estimateKind}`);
    console.log(`before: ${result.beforeLines} lines (~${result.beforeTokens} tok)`);
    console.log(`${result.estimateKind === 'task-pack' ? 'task pack' : 'default start'}: ${result.afterLines} lines (~${result.afterTokens} tok)`);
    console.log(`avoided: ${result.savedLines} lines (~${result.savedTokens} tok, ${result.savedPct}%)`);
    console.log(`confidence: ${result.confidence} - ${result.confidenceReason}`);
    console.log(`status: ${result.status}`);
    return;
  }
  console.log(`# context budget\n`);
  console.log(`mode: ${result.estimateKind}`);
  console.log(`before: ${result.beforeLines} lines`);
  console.log(`${result.estimateKind === 'task-pack' ? 'task pack' : 'default start'}: ${result.afterLines} lines`);
  console.log(`avoided: ${result.savedLines} lines (${result.savedPct}%)`);
  console.log(`tokens: ~${result.beforeTokens} -> ~${result.afterTokens}, saved ~${result.savedTokens}`);
  console.log(`approx saved/read: $${result.approxUsdSavedPerRead}`);
  console.log(`confidence: ${result.confidence} - ${result.confidenceReason}`);
  console.log(`target: ${result.targetLines} lines`);
  console.log(`status: ${result.status}`);
  console.log(`\nread pack:`);
  for (const f of result.readPack) console.log(`- ${f}`);
  if (result.reduceCandidates.length) {
    console.log(`\nkeep out of default context:`);
    for (const f of result.reduceCandidates.slice(0, 10)) console.log(`- ${f.path} (${f.lines} lines)`);
  }
}

function savings(project, flags = {}) {
  const result = computeBudget(project, { ...flags, brief: true });
  const dailyReads = Number(flags['daily-reads'] || flags.dailyReads || 10);
  const monthlyTokens = result.savedTokens * dailyReads * 30;
  const out = {
    project,
    query: flags.query || null,
    savedPerReadTokens: result.savedTokens,
    savedPct: result.savedPct,
    dailyReads,
    monthlySavedTokens: monthlyTokens,
    approxMonthlyUsdSaved: money(monthlyTokens),
    status: result.status,
  };
  if (flags.json) console.log(JSON.stringify(out, null, 2));
  else {
    if (flags.brief) {
      console.log(`saved/read: ~${out.savedPerReadTokens} tokens (${out.savedPct}%)`);
      console.log(`saved/month @${dailyReads}/day: ~${out.monthlySavedTokens} tokens (~$${out.approxMonthlyUsdSaved})`);
      return;
    }
    console.log(`# token savings\n`);
    console.log(`saved per read: ~${out.savedPerReadTokens} tokens (${out.savedPct}%)`);
    console.log(`assumed reads/day: ${dailyReads}`);
    console.log(`monthly saved: ~${out.monthlySavedTokens} tokens`);
    console.log(`approx monthly saved: $${out.approxMonthlyUsdSaved}`);
    console.log(`status: ${out.status}`);
  }
}

function prune(project, flags = {}) {
  const r = audit(project, { json: true, quiet: true });
  const b = computeBudget(project, flags);
  const profile = profileFor(project);
  const authoritative = new Set([
    ...existing(project, profile.defaultRead),
    ...profile.scoped.flatMap(([, files]) => existing(project, files)),
  ]);
  const actions = [];
  for (const f of r.large) {
    const role = classify({ path: f.path });
    if (role === 'agent-skill') actions.push({ action: 'adapter-only-not-default-read', path: f.path, reason: `${f.lines} lines inside skill bundle` });
    else if (authoritative.has(f.path)) actions.push({ action: 'summarize-or-index-authoritative-doc', path: f.path, reason: `${f.lines} lines but selected by profile` });
    else if (!f.path.includes('/archive/')) actions.push({ action: 'archive-or-split', path: f.path, reason: `${f.lines} lines` });
  }
  if (r.duplicateEntrySurfaces.length > 1) {
    actions.push({ action: 'dedupe-agent-entry-surfaces', paths: r.duplicateEntrySurfaces.map((f) => f.path), reason: 'multiple agent startup files can conflict' });
  }
  const plan = { project, mode: 'plan-only', budget: b, actions };
  if (flags.json) console.log(JSON.stringify(plan, null, 2));
  else {
    console.log(`# prune plan\n`);
    console.log(`budget before: ${b.beforeLines} lines`);
    console.log(`budget after: ${b.afterLines} lines`);
    console.log(`budget saved: ${b.savedLines} lines (${b.savedPct}%)`);
    console.log(`budget status: ${b.status}`);
    console.log(``);
    for (const a of actions) console.log(`- ${a.action}: ${a.path || a.paths.join(', ')} (${a.reason})`);
    if (!actions.length) console.log('- nothing obvious');
  }
}

function update(project, flags = {}) {
  const currentState = standardPath(project, 'currentState') || 'docs/CURRENT_STATE.md';
  const worklog = standardPath(project, 'worklog') || 'docs/WORKLOG.md';
  const journalFile = standardPath(project, 'journal') || 'docs/CONTEXT_JOURNAL.md';
  const contextIndex = standardPath(project, 'contextIndex') || 'docs/CONTEXT_INDEX.md';
  if (!flags.summary || !flags.type) throw new Error('update requires --summary and --type');
  const routes = {
    decision: ['docs/DECISIONS.md', '~/.hermes/graphiti/canonical_decisions.jsonl'],
    runtime: [currentState, journalFile],
    progress: [worklog, journalFile],
    research: ['docs/archive/context-heavy/', `${contextIndex} pointer`],
  };
  const result = {
    project,
    type: flags.type,
    summary: flags.summary,
    dryRun: !flags.apply,
    suggestedTargets: routes[flags.type] || ['docs/CONTEXT_JOURNAL.md'],
    blockers: [],
  };
  if (/secret|token|password|ключ|пароль/i.test(flags.summary)) result.blockers.push('possible-secret: do not sync to Graphiti without review');
  if (/price|pricing|quota|margin|цена|маржа/i.test(flags.summary)) result.blockers.push('pricing/proxy escalation required before buyer-facing update');
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (flags.brief) console.log(`${result.type}: ${result.suggestedTargets.join(', ')}${result.blockers.length ? ` blockers=${result.blockers.length}` : ''}`);
  else {
    console.log(`# update candidate\n`);
    console.log(`type: ${result.type}`);
    console.log(`summary: ${result.summary}`);
    console.log(`targets: ${result.suggestedTargets.join(', ')}`);
    if (result.blockers.length) console.log(`blockers: ${result.blockers.join(', ')}`);
  }
}

function classifyFile(project, flags = {}) {
  if (!flags.file) throw new Error('classify-file requires --file');
  const abs = path.resolve(project, flags.file);
  const item = { path: rel(project, abs), abs, lines: lineCount(abs) };
  const result = { path: item.path, lines: item.lines, role: classify(item) };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.path}: ${result.role} (${result.lines} lines)`);
}

function diffCards(project, flags = {}) {
  const repoDir = path.join(project, 'hermes/projects');
  const homeDir = path.join(os.homedir(), '.hermes/projects');
  const names = new Set();
  for (const dir of [repoDir, homeDir]) {
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) names.add(f);
  }
  const rows = [];
  for (const name of names) {
    const repo = path.join(repoDir, name);
    const home = path.join(homeDir, name);
    rows.push({
      card: name,
      repoExists: fs.existsSync(repo),
      homeExists: fs.existsSync(home),
      repoBytes: fs.existsSync(repo) ? fs.statSync(repo).size : 0,
      homeBytes: fs.existsSync(home) ? fs.statSync(home).size : 0,
      drift: fs.existsSync(repo) && fs.existsSync(home) && fs.readFileSync(repo, 'utf8') !== fs.readFileSync(home, 'utf8'),
    });
  }
  if (flags.json) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`# hermes card diff\n`);
    for (const r of rows) console.log(`- ${r.card}: repo=${r.repoExists ? r.repoBytes : '-'} home=${r.homeExists ? r.homeBytes : '-'} drift=${r.drift}`);
  }
}

function conflicts(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const hints = [];
  for (const p of ['CLAUDE.md', 'PLAN.md', 'ARCHITECTURE.md', 'STATUS.md']) {
    const f = path.join(project, p);
    if (fs.existsSync(f)) hints.push({ type: 'possibly-stale-entry', path: p, reason: 'generic active-looking file often drifts; compare with current docs/code' });
  }
  for (const [term, hits] of Object.entries(r.duplicateTerms || {})) {
    if (hits.length >= 5) hints.push({ type: 'repeated-instruction', term, files: hits.slice(0, 6).map((h) => h.path), reason: 'same concept repeated across many files' });
  }
  const cardRows = [];
  const repoDir = path.join(project, 'hermes/projects');
  const homeDir = path.join(os.homedir(), '.hermes/projects');
  if (fs.existsSync(repoDir) && fs.existsSync(homeDir)) {
    for (const name of fs.readdirSync(repoDir).filter((f) => f.endsWith('.md'))) {
      const repo = path.join(repoDir, name);
      const home = path.join(homeDir, name);
      if (fs.existsSync(home) && fs.readFileSync(repo, 'utf8') !== fs.readFileSync(home, 'utf8')) {
        cardRows.push(name);
      }
    }
  }
  if (cardRows.length) hints.push({ type: 'hermes-card-drift', files: cardRows, reason: 'repo hermes card differs from ~/.hermes card' });
  if (flags.json) console.log(JSON.stringify(hints, null, 2));
  else {
    console.log(`# conflict hints\n`);
    for (const h of hints.slice(0, 40)) {
      console.log(`- ${h.type}: ${h.path || h.term || (h.files || []).join(', ')} — ${h.reason}`);
    }
    if (!hints.length) console.log('- no obvious conflict hints');
  }
}

const BLINDSPOTS = {
  frontend: [
    'Did you run/build the frontend?',
    'Did you inspect phone-size layout?',
    'Did you check text clipping and touch target size?',
    'Did you verify real browser behavior, not only code?',
    'Did you avoid hiding product truth inside a skill?',
  ],
  backend: [
    'Did you run targeted backend tests?',
    'Did you verify runtime route behavior?',
    'Did you check env/secrets boundaries?',
    'Did you update docs for changed contracts?',
    'Did you avoid trusting stale architecture docs over code?',
  ],
  deploy: [
    'Is there a rollback path?',
    'Did build/tests pass before deploy?',
    'Did health check pass after deploy?',
    'Did public smoke pass, not only local?',
    'Did you record evidence and hashes?',
  ],
  pricing: [
    'Did you separate actual cost, competitor price, and official retail?',
    'Did you check local memory before public pricing pages?',
    'Is owner confirmation required?',
    'Did you avoid writing buyer-facing prices from guesses?',
  ],
  memory: [
    'Did you update only durable facts?',
    'Did you avoid raw transcript dumps?',
    'Did you check repo docs before Graphiti/Hermes?',
    'Did you add source paths?',
    'Did you mark stale old assumptions?',
  ],
  release: [
    'What exactly is promised?',
    'What is explicitly not promised?',
    'Are smoke scenarios listed?',
    'Is rollback/fallback clear?',
    'Will logs be watched after release?',
  ],
  telegram: [
    'Did Telegram return the expected object type, not only ok=true?',
    'For sticker: result.sticker exists?',
    'For media: fallback path tested?',
    'Was it sent to the right chat/channel?',
  ],
};

function blindspots(project, flags = {}) {
  const type = flags.type || 'frontend';
  const checks = BLINDSPOTS[type] || [...new Set(Object.values(BLINDSPOTS).flat())].slice(0, 20);
  const r = audit(project, { quiet: true });
  const warnings = [];
  if (r.missing.includes('docs/CONTEXT_JOURNAL.md')) warnings.push('No CONTEXT_JOURNAL.md: session learnings may be lost.');
  if (r.risks.includes('large-active-docs')) warnings.push('Large active docs: agent may over-read stale context.');
  if (r.risks.includes('many-agent-entry-surfaces')) warnings.push('Many AGENTS/CLAUDE surfaces: instructions may conflict.');
  const result = { project, type, checks, warnings };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# blindspots: ${type}\n`);
    for (const c of checks) console.log(`- [ ] ${c}`);
    if (warnings.length) {
      console.log(`\nproject warnings:`);
      for (const w of warnings) console.log(`- ${w}`);
    }
  }
}

function finish(project, flags = {}) {
  if (!flags.done || !flags.next) throw new Error('finish requires --done and --next');
  const evidence = flags.evidence ? String(flags.evidence).split('|').map((s) => s.trim()).filter(Boolean) : [];
  const entry = {
    type: 'session_finish',
    project: path.basename(project),
    captured_at: new Date().toISOString(),
    done: flags.done,
    next: flags.next,
    evidence,
    graphitiCandidates: [
      { type: 'project_memory', fact: flags.done, source_path: 'docs/CONTEXT_JOURNAL.md' },
    ],
    requiredFollowup: evidence.length ? [] : ['Evidence is empty; add tests/build/smoke/deploy proof before claiming completion.'],
  };
  if (flags.json) {
    console.log(JSON.stringify(entry, null, 2));
  } else {
    console.log(`# finish ledger\n`);
    console.log(`done: ${entry.done}`);
    console.log(`next: ${entry.next}`);
    console.log(`evidence:`);
    if (evidence.length) for (const e of evidence) console.log(`- ${e}`);
    else console.log(`- missing`);
    if (entry.requiredFollowup.length) {
      console.log(`\nfollowup:`);
      for (const f of entry.requiredFollowup) console.log(`- ${f}`);
    }
    console.log(`\nGraphiti candidates:`);
    for (const c of entry.graphitiCandidates) console.log(`- ${c.type}: ${c.fact}`);
    const taskDone = path.join(project, 'scripts', 'task-done.sh');
    console.log(`\nCompletion memory:`);
    console.log(`- worklog shape: what was done; what became better; evidence/tests; deploy/status; next step`);
    if (fs.existsSync(taskDone)) {
      console.log(`- available: npm run task:done -- --title "..." --result "..." --tests "..."`);
    } else {
      console.log(`- optional: install a project task-memory hook to sync repo worklog, Obsidian, and Graphiti`);
    }
  }
  if (flags.apply) {
    const note = [
      `Done: ${flags.done}`,
      `Next: ${flags.next}`,
      evidence.length ? `Evidence:\n${evidence.map((e) => `- ${e}`).join('\n')}` : 'Evidence: missing',
    ].join('\n\n');
    journal(project, { type: 'finish', note, apply: true, graphiti: flags.graphiti });
  }
}

function policy() {
  console.log(`# write policy\n`);
  console.log(`report-only by default: audit, gather, budget, prune, score, doctor, conflicts, blindspots, pressure, update, recommend, watch, profile-sync`);
  console.log(`writes only with --apply: bootstrap, init, maintain, fix-safe, install-adapter, journal, compact-handoff, compact-chat, finish, profile-sync`);
  console.log(`Graphiti writes only with both --apply and --graphiti where supported.`);
  console.log(`No command deletes context. Archive first, journal second.`);
}

function journal(project, flags = {}) {
  if (!flags.type || !flags.note) throw new Error('journal requires --type and --note');
  const entry = `\n### ${new Date().toISOString()} - ${flags.type}\n\n${flags.note}\n`;
  const journalRel = standardPath(project, 'journal') || 'docs/CONTEXT_JOURNAL.md';
  const file = path.join(project, journalRel);
  if (flags.apply) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.copyFileSync(path.join(ROOT, 'templates/CONTEXT_JOURNAL.md'), file);
    fs.appendFileSync(file, entry);
    if (flags.graphiti) appendGraphiti(project, flags);
  }
  console.log(`${flags.apply ? 'appended' : 'would append'}: ${rel(project, file)}`);
  console.log(entry.trim());
}

function compactHandoff(project, flags = {}) {
  const handoffRel = flags.file || 'handoff.md';
  const maxLines = Number(flags['max-lines'] || flags.maxLines || 220);
  const handoff = path.join(project, handoffRel);
  if (!fs.existsSync(handoff)) throw new Error(`${handoffRel} not found`);
  const text = fs.readFileSync(handoff, 'utf8');
  const lines = text.split(/\r?\n/);
  const needs = lines.length > maxLines;
  const date = new Date().toISOString().slice(0, 10);
  const archiveRel = `docs/archive/context-heavy/handoff-${date}.md`;
  const archive = path.join(project, archiveRel);
  const sectionOrder = ['done', 'current', 'next', 'blockers', 'evidence', 'checks', 'result'];
  const sections = [];
  let current = null;
  for (const line of lines) {
    const match = /^#{1,3}\s+(.*)$/.exec(line.trim());
    if (match) {
      current = { heading: match[1].trim(), lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  const prioritized = sections
    .sort((a, b) => {
      const score = (heading) => {
        const h = heading.toLowerCase();
        const idx = sectionOrder.findIndex((s) => h.includes(s));
        return idx === -1 ? 99 : idx;
      };
      return score(a.heading) - score(b.heading);
    })
    .flatMap((section) => section.lines.concat(''))
    .filter(Boolean);
  const kept = prioritized.length ? prioritized.slice(0, maxLines - 14) : lines.slice(0, Math.min(lines.length, maxLines - 14));
  const compact = [
    '# Handoff',
    '',
    `Last compacted: ${new Date().toISOString()}`,
    '',
    '## Current Continuation',
    '',
    ...kept,
    '',
    '## Archive',
    '',
    needs ? `Older material archived at \`${archiveRel}\`.` : 'No archive needed.',
    '',
  ].join('\n');
  const result = { file: handoffRel, lines: lines.length, maxLines, needsCompaction: needs, archive: needs ? archiveRel : null };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# handoff compaction\n`);
    console.log(`file: ${handoffRel}`);
    console.log(`lines: ${lines.length}`);
    console.log(`max: ${maxLines}`);
    console.log(`needsCompaction: ${needs}`);
    if (needs) console.log(`archive: ${archiveRel}`);
  }
  if (flags.apply && needs) {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.writeFileSync(archive, text);
    fs.writeFileSync(handoff, compact);
    const journalFile = path.join(project, 'docs/CONTEXT_JOURNAL.md');
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    if (!fs.existsSync(journalFile)) fs.copyFileSync(path.join(ROOT, 'templates/CONTEXT_JOURNAL.md'), journalFile);
    fs.appendFileSync(journalFile, `\n### ${new Date().toISOString()} - compact-handoff\n\nArchived \`${handoffRel}\` to \`${archiveRel}\` and kept a compact continuation handoff.\n`);
  }
}

function pressure(project, flags = {}) {
  const result = pressureResult(project, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (flags.brief) console.log(`${result.level} score=${result.score} ${result.recommendation}`);
  else {
    console.log(`# context pressure\n`);
    console.log(`level: ${result.level}`);
    console.log(`score: ${result.score}`);
    console.log(`recommendation: ${result.recommendation}`);
    console.log(`compact prompt: ${result.compactPrompt}`);
    if (level !== 'ok') {
      console.log(`\nchat warning: Контекст уже тяжелеет. После текущего шага стоит сделать compact handoff, чтобы не потерять важное и не тащить старый шум.`);
    }
  }
}

function compactChat(project, flags = {}) {
  const outRel = 'docs/COMPACT_HANDOFF.md';
  const out = path.join(project, outRel);
  const note = flags.note || 'Fill this with the current conversation summary before compaction.';
  const body = fs.readFileSync(path.join(ROOT, 'templates/COMPACT_PROMPT.md'), 'utf8')
    .replace('# Compact Prompt', '# Compact Handoff Draft')
    + `\n\n## Current Notes\n\n${note}\n`;
  if (flags.apply) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body);
  }
  console.log(`${flags.apply ? 'wrote' : 'would write'} ${outRel}`);
  console.log('Use this as the compact summary before continuing in a fresh/compacted context.');
}

function appendGraphiti(project, flags) {
  const dir = path.join(os.homedir(), '.hermes/graphiti');
  if (!fs.existsSync(dir)) return;
  const row = {
    type: 'context_maintenance',
    project: path.basename(project),
    maintenance_type: flags.type,
    note: flags.note,
    source_type: 'larpkeeper',
    source_path: path.join(project, 'docs/CONTEXT_JOURNAL.md'),
    captured_at: new Date().toISOString(),
    confidence: 'medium',
    is_current: true,
  };
  fs.appendFileSync(path.join(dir, 'context_notes.jsonl'), `${JSON.stringify(row)}\n`);
}

function validate(project) {
  const r = audit(project, { json: true, quiet: true });
  const profileRows = loadBundledProfiles();
  const profileProblems = profileRows.flatMap(({ name, profile }) => profileIssues(profile).map((issue) => `${name}:${issue}`));
  if (r.missing.length || r.risks.includes('large-active-docs') || profileProblems.length) {
    console.log('context validation: warning');
    if (r.missing.length) console.log(`missing: ${r.missing.join(', ')}`);
    if (r.risks.length) console.log(`risks: ${r.risks.join(', ')}`);
    if (profileProblems.length) console.log(`profile issues: ${profileProblems.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('context validation: ok');
  }
}

function doctor(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const contextIndex = standardPath(project, 'contextIndex');
  const journalRel = standardPath(project, 'journal');
  const archivePolicy = standardPath(project, 'archivePolicy');
  const checks = [
    ['no-read-everything', r.hotContextLines <= 800, `hot context ${r.hotContextLines} lines`],
    ['archive-not-delete', !archivePolicy || fs.existsSync(path.join(project, archivePolicy)), 'archive policy should exist before pruning'],
    ['clear-source-roles', (contextIndex && fs.existsSync(path.join(project, contextIndex))) || fs.existsSync(path.join(project, 'AGENTS.md')), 'needs routing/index source'],
    ['handoff-compact', !fs.existsSync(path.join(project, 'handoff.md')) || lineCount(path.join(project, 'handoff.md')) <= 260, 'handoff should stay compact'],
    ['skills-router-only', r.duplicateEntrySurfaces.length <= 8, `${r.duplicateEntrySurfaces.length} agent entry surfaces`],
    ['graphiti-safe', true, 'Graphiti writes require explicit --graphiti/--apply'],
    ['contradiction-surface', r.duplicateTerms && Object.keys(r.duplicateTerms).length < 16, `${Object.keys(r.duplicateTerms || {}).length} repeated-term clusters`],
    ['migration-contained', !(r.duplicateTerms.migration && r.duplicateTerms.migration.length > 8), 'migration terms should live in migration docs'],
    ['fast-session-start', !contextIndex || r.missing.includes(contextIndex) === false, `${contextIndex || 'context index'} enables fast startup`],
    ['journal-present', !journalRel || fs.existsSync(path.join(project, journalRel)), 'journal records context changes'],
  ].map(([name, ok, detail]) => ({ name, status: ok ? 'pass' : 'warn', detail }));
  const result = { project, checks };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# context doctor\n`);
    for (const c of checks) console.log(`- ${c.status.padEnd(4)} ${c.name}: ${c.detail}`);
  }
}

async function main() {
  const { cmd, project, flags } = parse(process.argv.slice(2));
  await maybeNotifyUpdate(cmd || 'help', flags);
  if (!cmd || cmd === 'help' || flags.help) usage();
  else if (cmd === 'audit') audit(project, flags);
  else if (cmd === 'pitch') pitch(project, flags);
  else if (cmd === 'gather') gather(project, flags);
  else if (cmd === 'repo-map' || cmd === 'map') repoMap(project, flags);
  else if (cmd === 'tool-guard' || cmd === 'guard') toolGuard(project, flags);
  else if (cmd === 'caveman') caveman(project, flags);
  else if (cmd === 'init') init(project, flags);
  else if (cmd === 'setup') setup(project, flags);
  else if (cmd === 'version' || cmd === '--version' || cmd === '-v') versionCommand(flags);
  else if (cmd === 'check-update') await checkUpdate(flags);
  else if (cmd === 'upgrade' || cmd === 'self-update') upgrade(flags);
  else if (cmd === 'bootstrap') bootstrap(project, flags);
  else if (cmd === 'install-adapter') installAdapter(project, flags);
  else if (cmd === 'pack') pack(project, flags);
  else if (cmd === 'prune') prune(project, flags);
  else if (cmd === 'maintain') maintain(project, flags);
  else if (cmd === 'fix-safe') fixSafe(project, flags);
  else if (cmd === 'recommend' || cmd === 'next') recommendNext(project, flags);
  else if (cmd === 'watch') watch(project, flags);
  else if (cmd === 'profile-sync') profileSync(project, flags);
  else if (cmd === 'update') update(project, flags);
  else if (cmd === 'journal') journal(project, flags);
  else if (cmd === 'score') score(project, flags);
  else if (cmd === 'doctor') doctor(project, flags);
  else if (cmd === 'budget') budget(project, flags);
  else if (cmd === 'savings') savings(project, flags);
  else if (cmd === 'conflicts') conflicts(project, flags);
  else if (cmd === 'blindspots') blindspots(project, flags);
  else if (cmd === 'finish') finish(project, flags);
  else if (cmd === 'policy') policy();
  else if (cmd === 'classify-file') classifyFile(project, flags);
  else if (cmd === 'compact-handoff') compactHandoff(project, flags);
  else if (cmd === 'pressure') pressure(project, flags);
  else if (cmd === 'statusline') statusline(project, flags);
  else if (cmd === 'hud') hud(project, flags);
  else if (cmd === 'install-shell-hook') installShellHook(project, flags);
  else if (cmd === 'banner') banner(project, flags);
  else if (cmd === 'codex') launchCodex(project, flags);
  else if (cmd === 'compact-chat') compactChat(project, flags);
  else if (cmd === 'diff-cards') diffCards(project, flags);
  else if (cmd === 'validate') validate(project);
  else throw new Error(`unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(`larpkeeper: ${err.message}`);
  process.exit(2);
});
