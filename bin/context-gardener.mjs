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
const DENY_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)(auth|secret|secrets|credential|credentials|password|token|key)(s)?(\.|-|_|\/|$)/i,
  /(^|\/)auth\.json(\.bak.*)?$/i,
  /(^|\/).*\.pem$/i,
];
const CODEX_LOG_DB = path.join(os.homedir(), '.codex/logs_2.sqlite');
const CODEX_SESSION_INDEX = path.join(os.homedir(), '.codex/session_index.jsonl');
const REPO_MAP_CACHE_VERSION = 2;
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

function explainLines(lines) {
  return lines.filter(Boolean).map((line) => `  - ${line}`);
}

function textLang(flags = {}) {
  const explicit = String(flags.lang || flags.language || process.env.LARPK_LANG || '').toLowerCase();
  if (explicit.startsWith('ru')) return 'ru';
  if (explicit.startsWith('en')) return 'en';
  const taskText = String(flags.task || flags.query || flags.note || '');
  if (/[А-Яа-яЁё]/.test(taskText)) return 'ru';
  if (/^ru/i.test(String(process.env.LANG || process.env.LC_ALL || process.env.LC_CTYPE || ''))) return 'ru';
  return 'en';
}

function tr(lang, en, ru) {
  return lang === 'ru' ? ru : en;
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
  const budget = r.defaultStart || computeBudget(project, { brief: true }, r);
  return {
    profile: budget.profile,
    beforeLines: budget.beforeLines,
    afterLines: budget.afterLines,
    savedLines: budget.savedLines,
    savedPct: budget.savedPct,
    beforeTokens: budget.beforeTokens,
    afterTokens: budget.afterTokens,
    savedTokens: budget.savedTokens,
    readPack: budget.readPack,
    confidence: budget.confidence,
    confidenceReason: budget.confidenceReason,
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
  ${bin} codex-preflight <project> [--task "..."] [--json]   start a cheap Codex session
  ${bin} repo-map <project> [--task "..."] [--budget 4000] [--json]   compact code map
  ${bin} semantic-search <project> --query "..." [--json]   semantic-lite code search
  ${bin} tool-guard <project> [--task "..."] [--json]   safe search/log/tool limits
  ${bin} compress-output <project> [--file PATH] [--json]   summarize noisy tool output
  ${bin} run <project> -- <command...>   run command and compress output
  ${bin} token-burn <project> [--since today] [--json]   find token/context burn
  ${bin} spend-guard <project> [--since today] [--json]   cost-pressure action plan
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
  ${bin} runs-prune <project> [--keep-days N] [--keep-last N] [--apply] [--json]   retain run artifacts
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
  ${bin} conflicts <project> [--json] [--structured]    separate conflicts, consistency, and duplication hints
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
  ${bin} compile-memory <project> [--apply] [--json]   compile worklog/journal into current cards
  ${bin} workflow-status <project> [--json]   durable audit->pack->work->finish->compile state
  ${bin} automation-plan <project> [--json]   safe scheduled/pressure automation plan
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
  const lang = textLang(flags);
  let next = 'pack';
  let reason = 'start with a task-specific context pack';
  let impact = 'keeps the next agent focused on the few files that matter for the task';
  let command = `${commandName()} pack ${quotePath(project)} --task "..."`;
  if (status.profileProblems.length) {
    next = 'profile-sync';
    reason = 'profile schema or bundled profile drift needs a sync';
    impact = 'profile drift makes Larpkeeper route agents through stale or invalid context rules';
    command = `${commandName()} profile-sync ${quotePath(project)} --apply`;
  } else if (status.needsBootstrap) {
    next = 'bootstrap';
    reason = 'standard context files are missing';
    impact = 'new sessions lack a clear map/current-state/worklog layer and may read too broadly';
    command = `${commandName()} bootstrap ${quotePath(project)} --apply`;
  } else if (status.needsProfileSync) {
    next = 'profile-sync';
    reason = 'project profile docs are out of sync';
    impact = 'humans and agents may disagree about which profile rules are current';
    command = `${commandName()} profile-sync ${quotePath(project)} --apply`;
  } else if (status.needsHandoffCompact) {
    next = 'maintain';
    reason = 'handoff is too long and should be compacted';
    impact = 'long handoffs behave like raw transcripts: expensive to read and easy to misinterpret';
    command = `${commandName()} maintain ${quotePath(project)} --apply`;
  } else if (status.audit.risks.includes('hot-context-over-budget') || status.audit.risks.includes('large-active-docs')) {
    next = 'prune';
    reason = 'context is too heavy';
    impact = 'large active docs keep getting pulled into sessions even when only a small current summary is needed';
    command = `${commandName()} prune ${quotePath(project)}`;
  } else if (status.audit.risks.includes('many-agent-entry-surfaces') || status.audit.risks.includes('missing-active-memory')) {
    next = 'doctor';
    reason = 'instructions or memory surfaces need cleanup';
    impact = 'agents may see competing instructions or miss the durable memory files';
    command = `${commandName()} doctor ${quotePath(project)}`;
  }
  const result = {
    project,
    next,
    reason,
    impact,
    command,
    payoff: {
      hotContextLines: status.audit.hotContextLines,
      broadContextLines: status.audit.broadContextLines,
      avoidableLines: Math.max(0, status.audit.broadContextLines - 500),
      largeDocs: status.audit.large.filter((f) => !f.path.includes('/archive/')).length,
    },
    level: status.audit.hotContextLines > 800 ? 'compact-soon' : 'ok',
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${bold('Larpkeeper recommendation')} ${dim(`(${path.basename(project)})`)}`);
    console.log(`${statusColor(result.level)}  ${result.next}`);
    section(tr(lang, 'Why', 'Почему'));
    for (const line of explainLines(lang === 'ru' ? [
      result.reason === 'context is too heavy' ? 'контекст слишком тяжелый' : result.reason,
      result.impact === 'large active docs keep getting pulled into sessions even when only a small current summary is needed'
        ? 'большие активные docs снова попадают в сессии, хотя часто нужен только короткий current summary'
        : result.impact,
    ] : [result.reason, result.impact])) console.log(line);
    section(tr(lang, 'Payoff', 'Выигрыш'));
    for (const line of explainLines([
      lang === 'ru'
        ? `сейчас hot context: ${fmtNumber(result.payoff.hotContextLines)} строк; широкий scan: ${fmtNumber(result.payoff.broadContextLines)} строк`
        : `hot context now: ${fmtNumber(result.payoff.hotContextLines)} lines; broad scan: ${fmtNumber(result.payoff.broadContextLines)} lines`,
      result.payoff.avoidableLines > 0
        ? lang === 'ru'
          ? `следующий выигрыш: убрать примерно ${fmtNumber(result.payoff.avoidableLines)} строк из first-pass context`
          : `next unlock: keep about ${fmtNumber(result.payoff.avoidableLines)} lines out of first-pass context`
        : tr(lang, 'first-pass context is already close to target', 'first-pass context уже близко к цели'),
      result.payoff.largeDocs
        ? lang === 'ru'
          ? `${result.payoff.largeDocs} больших активных doc дают самый быстрый cleanup-выигрыш`
          : `${result.payoff.largeDocs} large active doc${result.payoff.largeDocs === 1 ? '' : 's'} are likely the highest-leverage cleanup`
        : tr(lang, 'no large active docs are dominating the next step', 'нет больших активных docs, которые доминируют следующий шаг'),
    ])) console.log(line);
    section(tr(lang, 'Run Next', 'Дальше'));
    console.log(`  ${cyan(result.command)}`);
    console.log(`  ${dim(result.next === 'prune' ? 'plan-only; inspect before moving/archive actions' : result.command.includes('--apply') ? 'writes only the requested context-maintenance files' : 'read-only')}`);
  }
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
    impact: heavy
      ? 'expect slower starts and more stale-doc drift unless you compact or use task packs'
      : status.needsBootstrap
        ? 'missing skeleton docs make the next session guess where project truth lives'
        : 'the project can stay on scoped pack/repo-map flow',
    payoff: {
      hotContextLines: status.audit.hotContextLines,
      broadContextLines: status.audit.broadContextLines,
      avoidableLines: Math.max(0, status.audit.broadContextLines - 500),
    },
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${bold('Larpkeeper watch')} ${statusColor(result.level)} score=${result.score}`);
    console.log(`reason: ${result.reason}`);
    console.log(`impact: ${result.impact}`);
    console.log(`payoff: hot=${fmtNumber(result.payoff.hotContextLines)} lines, broad=${fmtNumber(result.payoff.broadContextLines)} lines, next unlock=${fmtNumber(result.payoff.avoidableLines)} lines`);
    console.log(`next: ${commandName()} ${result.next} ${quotePath(project)}${result.next === 'pack' ? ' --task "..."' : ''}`);
  }
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

function fmtNumber(value) {
  return new Intl.NumberFormat('en-US').format(Math.round(Number(value || 0)));
}

function progressBar(percent, width = 14) {
  const safe = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round((safe / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${safe}%`;
}

function linesOverTarget(lines, target) {
  return Math.max(0, Number(lines || 0) - Number(target || 0));
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

function isDeniedPath(file) {
  const p = String(file || '').replaceAll(path.sep, '/');
  return DENY_PATH_PATTERNS.some((pattern) => pattern.test(p));
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
    .filter((f) => !SOURCE_SKIP_PREFIXES.some((prefix) => f.path.startsWith(prefix)))
    .filter((f) => !isDeniedPath(f.path));
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

function extractImports(file, text) {
  const ext = path.extname(file).toLowerCase();
  const imports = [];
  const patterns = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.vue', '.astro'].includes(ext)
    ? [
        /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
        /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
      ]
    : ext === '.py'
      ? [/^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/gm]
      : [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) && imports.length < 16) {
      const value = match[1] || match[2];
      if (value && !imports.includes(value)) imports.push(value);
    }
  }
  return imports;
}

function relatedTestFiles(project, sourcePath) {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  const candidates = [
    `${base}.test${ext}`,
    `${base}.spec${ext}`,
    sourcePath.replace(/\/src\//, '/test/').replace(ext, `.test${ext}`),
    sourcePath.replace(/\/src\//, '/tests/').replace(ext, `.test${ext}`),
  ];
  return [...new Set(candidates)].filter((f) => fs.existsSync(path.join(project, f))).slice(0, 4);
}

function sourceModuleKey(sourcePath) {
  const withoutExt = sourcePath.replace(/\.[^.]+$/, '');
  return withoutExt.split('/').slice(-2).join('/').toLowerCase();
}

function importFanIn(files) {
  const byKey = new Map();
  const sourceKeys = new Map(files.map((file) => [sourceModuleKey(file.path), file.path]));
  for (const file of files) {
    let text = '';
    try { text = fs.readFileSync(file.abs, 'utf8'); } catch {}
    for (const spec of extractImports(file.path, text)) {
      if (!spec.startsWith('.')) continue;
      const baseDir = path.dirname(file.path);
      const normalized = path.normalize(path.join(baseDir, spec)).replaceAll(path.sep, '/').toLowerCase();
      const key = normalized.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
      const target = sourceKeys.get(key);
      if (!target) continue;
      byKey.set(target, (byKey.get(target) || 0) + 1);
    }
  }
  return byKey;
}

function scoreSourceForTask(file, symbols, terms, signals = {}) {
  const hay = `${file.path} ${symbols.join(' ')}`.toLowerCase();
  let score = 0;
  for (const term of terms) if (hay.includes(term)) score += 50;
  if (/^(src|app|apps|packages|server|bot|lib)\//.test(file.path)) score += 12;
  if (/(test|spec)\.[^.]+$/.test(file.path) || file.path.includes('/test/')) score += terms.includes('test') ? 18 : -8;
  if (file.path.includes('/scripts/')) score += 4;
  if (file.lines > 0 && file.lines <= 240) score += 8;
  if (file.lines > 600) score -= 12;
  if (file.ageDays <= 14) score += 4;
  if (signals.relatedTests?.length) score += 6;
  if (signals.importedBy) score += Math.min(20, signals.importedBy * 4);
  return score;
}

function estimateTextTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function repoMapCacheFile(project) {
  return path.join(project, '.larpkeeper', 'repo-map-cache.json');
}

function sourceSignature(files) {
  return files.map((f) => `${f.path}:${Math.round(f.mtimeMs)}:${f.lines}`).join('|');
}

function buildRepoMap(project, flags = {}) {
  const cfg = readConfig(project);
  const task = flags.task || flags.query || '';
  const terms = queryTerms(task);
  const budgetTokens = Math.max(800, Number(flags.budget || flags['repo-map-budget'] || flags.repoMapBudget || 4000));
  const files = sourceFiles(project, cfg);
  const fanIn = importFanIn(files);
  const signature = sourceSignature(files);
  const cacheFile = repoMapCacheFile(project);
  const cacheKey = JSON.stringify({ v: REPO_MAP_CACHE_VERSION, task, budgetTokens, signature });
  if (!flags['no-cache'] && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached.cacheKey === cacheKey && cached.map) return { ...cached.map, cache: 'hit' };
    } catch {}
  }
  const rows = files.map((file) => {
    let text = '';
    try { text = fs.readFileSync(file.abs, 'utf8'); } catch {}
    const symbols = extractSymbols(file.path, text);
    const imports = extractImports(file.path, text);
    const relatedTests = relatedTestFiles(project, file.path);
    const importedBy = fanIn.get(file.path) || 0;
    const hay = `${file.path} ${symbols.join(' ')}`.toLowerCase();
    const termMatches = terms.filter((term) => hay.includes(term)).length;
    const signals = {
      relatedTests,
      importedBy,
      recent: file.ageDays <= 14,
      small: file.lines > 0 && file.lines <= 240,
    };
    return {
      path: file.path,
      lines: file.lines,
      symbols: symbols.slice(0, 10),
      imports: imports.slice(0, 8),
      relatedTests,
      signals,
      score: scoreSourceForTask(file, symbols, terms, signals),
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
      imports: row.imports,
      relatedTests: row.relatedTests,
      signals: row.signals,
      reason: row.termMatches > 0 ? 'task/path/symbol match' : 'high-signal source file',
    });
    estimatedTokens += cost;
  }

  const map = {
    project,
    task: task || null,
    budgetTokens,
    estimatedTokens,
    sourceFilesScanned: files.length,
    includedFiles: included,
    omittedFiles: Math.max(0, files.length - included.length),
    command: `${commandName()} repo-map ${quotePath(project)} --task ${JSON.stringify(task || '...')}`,
    readStrategy: 'Read repo-map first, then only listed files plus direct dependencies discovered by exact search.',
    cache: 'miss',
  };
  if (!flags['no-cache']) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ cacheKey, map }, null, 2));
    } catch {}
  }
  return map;
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
    if (f.imports?.length) lines.push(`  imports: ${f.imports.slice(0, 5).join(', ')}`);
    if (f.relatedTests?.length) lines.push(`  tests: ${f.relatedTests.join(', ')}`);
    if (f.signals) {
      const signalText = [
        f.signals.importedBy ? `imported_by=${f.signals.importedBy}` : '',
        f.signals.recent ? 'recent' : '',
        f.signals.small ? 'small' : '',
      ].filter(Boolean).join(', ');
      if (signalText) lines.push(`  signals: ${signalText}`);
    }
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

function redactSecretLike(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]')
    .replace(/(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]');
}

function summarizeToolOutput(text, flags = {}) {
  const clean = redactSecretLike(text);
  const lines = clean.split(/\r?\n/);
  const maxLines = Number(flags['max-lines'] || flags.maxLines || 80);
  const errorPatterns = /(error|exception|failed|fatal|traceback|denied|timeout|enoent|eacces|segmentation|panic)/i;
  const errorLines = [];
  const matches = new Map();
  for (const line of lines) {
    if (errorPatterns.test(line) && errorLines.length < 40) errorLines.push(line.slice(0, 500));
    const rg = /^([^:\n]{1,160}):(\d+):/.exec(line);
    if (rg) matches.set(rg[1], (matches.get(rg[1]) || 0) + 1);
  }
  const tail = lines.slice(Math.max(0, lines.length - Math.min(maxLines, 30))).map((line) => line.slice(0, 500));
  const topFiles = [...matches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([file, count]) => ({ file, count }));
  return {
    inputLines: lines.length,
    inputBytes: Buffer.byteLength(text || '', 'utf8'),
    estimatedInputTokens: estimateTextTokens(text || ''),
    outputLines: Math.min(lines.length, maxLines),
    errorLines,
    topFiles,
    tail,
    warnings: [
      ...(lines.length > maxLines ? [`input had ${lines.length} lines; compressed to summary`] : []),
      ...(clean !== text ? ['secret-like values were redacted'] : []),
    ],
  };
}

function compressOutput(project, flags = {}) {
  const file = flags.file ? path.resolve(project, flags.file) : null;
  if (file && isDeniedPath(rel(project, file))) throw new Error('refusing to read secret-like path');
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const result = summarizeToolOutput(text, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# compressed output\n`);
    console.log(`input: ${result.inputLines} lines, ~${result.estimatedInputTokens} tokens`);
    if (result.warnings.length) for (const w of result.warnings) console.log(`warning: ${w}`);
    if (result.errorLines.length) {
      console.log(`\nerrors:`);
      for (const line of result.errorLines.slice(0, 20)) console.log(`- ${line}`);
    }
    if (result.topFiles.length) {
      console.log(`\ntop matched files:`);
      for (const row of result.topFiles) console.log(`- ${row.file}: ${row.count}`);
    }
    console.log(`\ntail:`);
    for (const line of result.tail) console.log(line);
  }
  return result;
}

function runWrapped(project, flags = {}) {
  const sep = process.argv.indexOf('--');
  if (sep === -1 || sep === process.argv.length - 1) throw new Error('run requires command after --');
  const args = process.argv.slice(sep + 1);
  const startedAt = new Date();
  const result = spawnSync(args[0], args.slice(1), {
    cwd: project,
    encoding: 'utf8',
    shell: false,
    maxBuffer: Number(flags['max-buffer'] || flags.maxBuffer || 20 * 1024 * 1024),
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = [
    stdout ? `# stdout\n${stdout}` : '',
    stderr ? `# stderr\n${stderr}` : '',
  ].filter(Boolean).join('\n\n');
  const runsDir = path.join(project, '.larpkeeper', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const base = path.join(runsDir, `run-${stamp}`);
  const stdoutFile = `${base}.stdout.log`;
  const stderrFile = `${base}.stderr.log`;
  const metaFile = `${base}.json`;
  fs.writeFileSync(stdoutFile, stdout);
  fs.writeFileSync(stderrFile, stderr);
  const summary = summarizeToolOutput(combined, flags);
  const meta = {
    project,
    command: args,
    status: result.status ?? null,
    signal: result.signal || null,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    stdoutFile: rel(project, stdoutFile),
    stderrFile: rel(project, stderrFile),
    summary,
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  if (flags.json) console.log(JSON.stringify(meta, null, 2));
  else {
    console.log(`# larp run\n`);
    console.log(`command: ${args.join(' ')}`);
    console.log(`status: ${meta.status}${meta.signal ? ` signal=${meta.signal}` : ''}`);
    console.log(`raw stdout: ${meta.stdoutFile}`);
    console.log(`raw stderr: ${meta.stderrFile}`);
    console.log(`input: ${summary.inputLines} lines, ~${summary.estimatedInputTokens} tokens`);
    for (const warning of summary.warnings) console.log(`warning: ${warning}`);
    if (summary.errorLines.length) {
      console.log(`\nerrors:`);
      for (const line of summary.errorLines.slice(0, 20)) console.log(`- ${line}`);
    }
    if (summary.topFiles.length) {
      console.log(`\ntop matched files:`);
      for (const row of summary.topFiles.slice(0, 10)) console.log(`- ${row.file}: ${row.count}`);
    }
    console.log(`\ntail:`);
    for (const line of summary.tail) console.log(line);
  }
  process.exitCode = result.status ?? (result.signal ? 1 : 0);
  return meta;
}

const RUN_RETENTION_DEFAULTS = Object.freeze({ keepDays: 14, keepLast: 20 });

function runArtifacts(project) {
  const runsDir = path.join(project, '.larpkeeper', 'runs');
  if (!fs.existsSync(runsDir)) return { runsDir, files: [] };
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      let stat;
      try { stat = fs.lstatSync(abs); } catch { continue; }
      if (stat.isDirectory()) walk(abs);
      else if (stat.isFile() && name.startsWith('run-')) files.push({ abs, stat });
    }
  };
  walk(runsDir);
  return { runsDir, files: files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs || a.abs.localeCompare(b.abs)) };
}

function runsPrune(project, flags = {}) {
  const keepDaysRaw = Number(flags['keep-days'] ?? flags.keepDays ?? RUN_RETENTION_DEFAULTS.keepDays);
  const keepLastRaw = Number(flags['keep-last'] ?? flags.keepLast ?? RUN_RETENTION_DEFAULTS.keepLast);
  if (!Number.isFinite(keepDaysRaw) || keepDaysRaw < 0) throw new Error('--keep-days must be a non-negative number');
  if (!Number.isFinite(keepLastRaw) || keepLastRaw < 0) throw new Error('--keep-last must be a non-negative number');
  const keepDays = Math.floor(keepDaysRaw);
  const keepLast = Math.floor(keepLastRaw);
  const now = Date.now();
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  const { runsDir, files } = runArtifacts(project);
  const groups = new Map();
  for (const item of files) {
    const name = path.basename(item.abs);
    const runId = (name.match(/^(run-[^.]+)/) || [name])[1];
    const row = groups.get(runId) || { runId, files: [], newestMtime: 0 };
    row.files.push(item);
    row.newestMtime = Math.max(row.newestMtime, item.stat.mtimeMs);
    groups.set(runId, row);
  }
  const orderedGroups = [...groups.values()].sort((a, b) => b.newestMtime - a.newestMtime || a.runId.localeCompare(b.runId));
  const keepLastRunIds = new Set(orderedGroups.slice(0, keepLast).map((group) => group.runId));
  const keepRecentRunIds = new Set(orderedGroups.filter((group) => group.newestMtime >= cutoff).map((group) => group.runId));
  const keptRunIds = new Set([...keepLastRunIds, ...keepRecentRunIds]);
  const kept = orderedGroups
    .filter((group) => keptRunIds.has(group.runId))
    .flatMap((group) => group.files.map(({ abs, stat }) => ({
      path: rel(project, abs),
      bytes: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
      reason: keepLastRunIds.has(group.runId) ? 'keep-last' : `newer-than-${keepDays}-days`,
    })));
  const candidates = orderedGroups
    .filter((group) => !keptRunIds.has(group.runId))
    .flatMap((group) => group.files.map(({ abs, stat }) => ({
      path: rel(project, abs),
      bytes: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
      reason: `run-group-older-than-${keepDays}-days`,
    })));
  const totalBytes = files.reduce((sum, item) => sum + item.stat.size, 0);
  const candidateBytes = candidates.reduce((sum, item) => sum + item.bytes, 0);
  const result = {
    project,
    runsDir: rel(project, runsDir),
    mode: flags.apply ? 'apply' : 'dry-run',
    apply: Boolean(flags.apply),
    dryRun: !flags.apply,
    retention: { keepDays, keepLast, cutoff: new Date(cutoff).toISOString(), artifactPrefix: 'run-' },
    count: files.length,
    bytes: totalBytes,
    candidates,
    candidateCount: candidates.length,
    candidateBytes,
    kept,
    keptCount: kept.length,
    keptBytes: kept.reduce((sum, item) => sum + item.bytes, 0),
    runCount: groups.size,
    keptRunCount: keptRunIds.size,
    removed: [],
  };
  if (flags.apply) {
    for (const item of candidates) {
      const abs = path.join(project, item.path);
      try { fs.unlinkSync(abs); result.removed.push(item); } catch (err) { item.error = err.message; }
    }
  }
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# runs prune\n`);
    console.log(`mode: ${result.mode}`);
    console.log(`retention: keep last ${keepLast}, keep newer than ${keepDays} days`);
    console.log(`artifacts: ${result.count} in ${result.runCount} runs (${result.bytes} bytes)`);
    console.log(`candidates: ${result.candidateCount} (${result.candidateBytes} bytes)`);
    if (result.removed.length) console.log(`removed: ${result.removed.length}`);
    if (!flags.apply) console.log('dry-run: pass --apply to remove only listed run-* artifacts');
    for (const item of candidates.slice(0, 40)) console.log(`- ${item.path} (${item.bytes} bytes; ${item.reason})`);
  }
  return result;
}

function semanticSearch(project, flags = {}) {
  const query = flags.query || flags.task;
  if (!query) throw new Error('semantic-search requires --query');
  const terms = queryTerms(query);
  const cfg = readConfig(project);
  const rows = sourceFiles(project, cfg).map((file) => {
    let text = '';
    try { text = fs.readFileSync(file.abs, 'utf8'); } catch {}
    const symbols = extractSymbols(file.path, text);
    const imports = extractImports(file.path, text);
    const lower = `${file.path}\n${symbols.join(' ')}\n${imports.join(' ')}\n${text.slice(0, 12000)}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = (lower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      score += Math.min(12, count) * 10;
      if (file.path.toLowerCase().includes(term)) score += 40;
      if (symbols.some((s) => s.toLowerCase().includes(term))) score += 35;
    }
    return {
      path: file.path,
      lines: file.lines,
      score,
      symbols: symbols.slice(0, 8),
      imports: imports.slice(0, 6),
      relatedTests: relatedTestFiles(project, file.path),
    };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, Number(flags.limit || 20));
  const result = { project, query, mode: 'semantic-lite', results: rows };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# semantic-lite search\n`);
    console.log(`query: ${query}`);
    for (const row of rows) console.log(`- ${row.path} score=${row.score} symbols=${row.symbols.join(', ') || '-'}`);
  }
  return result;
}

function parseSinceSeconds(value) {
  if (!value || value === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }
  if (value === '24h') return Math.floor(Date.now() / 1000) - 86400;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sqliteJson(db, sql) {
  const out = spawnSync('sqlite3', ['-json', db, sql], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (out.status !== 0) throw new Error((out.stderr || 'sqlite3 failed').trim());
  return out.stdout.trim() ? JSON.parse(out.stdout) : [];
}

function normalizePathForCompare(value) {
  if (!value) return '';
  return path.resolve(String(value).replace(/^~(?=$|\/)/, os.homedir()));
}

function safeProjectLabel(value) {
  const normalized = normalizePathForCompare(value);
  if (!normalized) return '(unknown)';
  const base = path.basename(normalized);
  const parent = path.basename(path.dirname(normalized));
  return parent && parent !== path.sep ? `${parent}/${base}` : base;
}

function codexSessionRows(indexFile = CODEX_SESSION_INDEX) {
  if (!fs.existsSync(indexFile)) return [];
  const rows = [];
  const text = fs.readFileSync(indexFile, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      rows.push({
        id: String(row.id || row.thread_id || row.threadId || row.session_id || row.sessionId || ''),
        thread: String(row.thread_id || row.threadId || row.id || ''),
        process: String(row.process_uuid || row.processUuid || ''),
        cwd: normalizePathForCompare(row.cwd || row.project_cwd || row.projectPath || row.repo || row.root || row.path || ''),
        project: row.project || row.projectName || null,
        updatedAt: row.updated_at || row.updatedAt || row.ts || row.timestamp || null,
      });
    } catch {
      // Session index is advisory; malformed rows should not break token-burn.
    }
  }
  return rows.filter((row) => row.id || row.thread || row.process || row.cwd || row.project);
}

function buildCodexProjectIndex(project, flags = {}) {
  const indexFile = flags['session-index'] || flags.sessionIndex || CODEX_SESSION_INDEX;
  const rows = codexSessionRows(indexFile);
  const byThread = new Map();
  const byProcess = new Map();
  for (const row of rows) {
    const label = row.cwd ? safeProjectLabel(row.cwd) : (row.project ? String(row.project) : '(unknown)');
    const value = { ...row, label };
    if (row.thread && row.thread !== '(none)') byThread.set(row.thread, value);
    if (row.id && row.id !== '(none)') byThread.set(row.id, value);
    if (row.process && row.process !== '(none)') byProcess.set(row.process, value);
  }
  return {
    source: fs.existsSync(indexFile) ? indexFile : null,
    rows: rows.length,
    hasCwd: rows.some((row) => Boolean(row.cwd)),
    projectRoot: normalizePathForCompare(project),
    byThread,
    byProcess,
  };
}

function projectFromLogRow(row, projectIndex) {
  const thread = String(row.thread || row.thread_id || '');
  const process = String(row.process || row.process_uuid || '');
  const matched = projectIndex.byThread.get(thread) || projectIndex.byProcess.get(process);
  if (!matched) return { label: '(unknown)', cwd: null, matchedBy: null };
  return {
    label: matched.label || '(unknown)',
    cwd: matched.cwd || null,
    matchedBy: projectIndex.byThread.has(thread) ? 'thread' : 'process',
  };
}

function aggregateProjectsFromThreads(threadRows, projectIndex) {
  const totals = new Map();
  for (const row of threadRows) {
    const projectInfo = projectFromLogRow(row, projectIndex);
    const key = projectInfo.cwd || projectInfo.label || '(unknown)';
    const existing = totals.get(key) || {
      project: projectInfo.label || '(unknown)',
      cwd: projectInfo.cwd,
      matchedBy: projectInfo.matchedBy,
      rows: 0,
      estimatedTokens: 0,
      threads: 0,
    };
    existing.rows += Number(row.rows || 0);
    existing.estimatedTokens += Math.ceil(Number(row.bytes || 0) / 4);
    existing.threads += 1;
    totals.set(key, existing);
  }
  return [...totals.values()].sort((a, b) => b.estimatedTokens - a.estimatedTokens).slice(0, 10);
}

function tokenBurnRecommendations(result) {
  const recs = [];
  const targetNames = result.topTargets.map((row) => row.target).join(' ').toLowerCase();
  const moduleNames = result.topModules.map((row) => row.source).join(' ').toLowerCase();
  if (/transport|sse|responses|outgoing_message/.test(targetNames)) {
    recs.push('Transport/model stream dominates: reduce long turns, compact earlier, and avoid repeating full context in follow-ups.');
  }
  if (/markdown_stream|chatwidget/.test(targetNames)) {
    recs.push('TUI/chat rendering is noisy: keep assistant/tool summaries shorter and avoid pasting long raw output.');
  }
  if (/mcp|connection_manager/.test(targetNames)) {
    recs.push('MCP traffic is visible: prefer fewer large MCP calls and summarize MCP results before continuing.');
  }
  if (/tool|exec|shell|process/.test(`${targetNames} ${moduleNames}`)) {
    recs.push('Tool output is visible: use `larp run` or `larp compress-output` for tests, logs, grep, and build output.');
  }
  if (result.projectEstimate.avoidableTokens > 10000) {
    recs.push('Project context has avoidable tokens: start sessions with `larp codex-preflight . --task "..."`.');
  }
  if (!recs.length) recs.push('No single burn source dominates; keep using preflight, repo-map, and compressed command output.');
  return recs;
}

function tokenBurn(project, flags = {}) {
  const db = flags.db || CODEX_LOG_DB;
  const since = parseSinceSeconds(flags.since || 'today');
  const lang = textLang(flags);
  const exists = fs.existsSync(db);
  const auditResult = audit(project, { quiet: true });
  const estimate = computeBudget(project, { ...flags, brief: true });
  const result = {
    project,
    lang,
    since: flags.since || 'today',
    source: exists ? db : null,
    mode: exists ? 'codex-sqlite-estimated-bytes' : 'project-estimate-only',
    totals: null,
    topTargets: [],
    topModules: [],
    topProcesses: [],
    topThreads: [],
    topProjects: [],
    projectLogEstimate: null,
    dailyBuckets: [],
    recommendations: [],
    projectEstimate: {
      broadContextTokens: estimate.beforeTokens,
      selectedPackTokens: estimate.afterTokens,
      avoidableTokens: estimate.savedTokens,
      hotContextLines: auditResult.hotContextLines,
      broadContextLines: auditResult.broadContextLines,
      risks: auditResult.risks,
    },
    warnings: [
      'does not read raw prompt/tool bodies',
      'estimated_bytes is converted with ~4 bytes/token; billing numbers may differ',
    ],
  };
  if (exists) {
    const where = `ts >= ${Number(since) || 0}`;
    const projectIndex = buildCodexProjectIndex(project, flags);
    const totalRows = sqliteJson(db, `select count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where};`)[0] || { rows: 0, bytes: 0 };
    result.totals = {
      rows: Number(totalRows.rows || 0),
      estimatedBytes: Number(totalRows.bytes || 0),
      estimatedTokens: Math.ceil(Number(totalRows.bytes || 0) / 4),
    };
    result.topTargets = sqliteJson(db, `select target, count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where} group by target order by bytes desc limit 15;`)
      .map((r) => ({ target: r.target || '(none)', rows: Number(r.rows || 0), estimatedTokens: Math.ceil(Number(r.bytes || 0) / 4) }));
    result.topModules = sqliteJson(db, `select coalesce(module_path,file,'(none)') as source, count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where} group by source order by bytes desc limit 15;`)
      .map((r) => ({ source: r.source || '(none)', rows: Number(r.rows || 0), estimatedTokens: Math.ceil(Number(r.bytes || 0) / 4) }));
    result.topProcesses = sqliteJson(db, `select coalesce(process_uuid,'(none)') as process, count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where} group by process order by bytes desc limit 10;`)
      .map((r) => ({ process: r.process || '(none)', rows: Number(r.rows || 0), estimatedTokens: Math.ceil(Number(r.bytes || 0) / 4) }));
    result.topThreads = sqliteJson(db, `select coalesce(thread_id,'(none)') as thread, count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where} group by thread order by bytes desc limit 10;`)
      .map((r) => ({ thread: r.thread || '(none)', rows: Number(r.rows || 0), estimatedTokens: Math.ceil(Number(r.bytes || 0) / 4) }));
    const threadProjectRows = sqliteJson(db, `select coalesce(thread_id,'(none)') as thread, coalesce(process_uuid,'(none)') as process, count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where} group by thread, process order by bytes desc limit 500;`);
    result.topProjects = aggregateProjectsFromThreads(threadProjectRows, projectIndex);
    const projectRoot = projectIndex.projectRoot;
    const currentRows = result.topProjects.filter((row) => row.cwd && projectRoot && (row.cwd === projectRoot || row.cwd.startsWith(`${projectRoot}${path.sep}`)));
    if (currentRows.length) {
      result.projectLogEstimate = currentRows.reduce((acc, row) => ({
        project: safeProjectLabel(projectRoot),
        cwd: projectRoot,
        rows: acc.rows + row.rows,
        estimatedTokens: acc.estimatedTokens + row.estimatedTokens,
        threads: acc.threads + row.threads,
      }), { project: safeProjectLabel(projectRoot), cwd: projectRoot, rows: 0, estimatedTokens: 0, threads: 0 });
    }
    result.dailyBuckets = sqliteJson(db, `select date(ts, 'unixepoch') as day, count(*) as rows, coalesce(sum(estimated_bytes),0) as bytes from logs where ${where} group by day order by day desc limit 14;`)
      .map((r) => ({ day: r.day, rows: Number(r.rows || 0), estimatedTokens: Math.ceil(Number(r.bytes || 0) / 4) }));
    result.projectAttribution = {
      mode: projectIndex.hasCwd ? 'session-index-cwd' : 'thread/process-best-effort',
      source: projectIndex.source,
      indexedSessions: projectIndex.rows,
      unknownTokens: result.topProjects.find((row) => row.project === '(unknown)')?.estimatedTokens || 0,
    };
    if (!projectIndex.hasCwd) {
      result.warnings.push('project attribution is limited: Codex log rows do not contain cwd and session index has no cwd fields');
    }
  }
  result.recommendations = tokenBurnRecommendations(result);
  if (flags.returnResult) return result;
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    const lang = result.lang || 'en';
    const totalTokens = result.totals?.estimatedTokens || 0;
    const avoidable = result.projectEstimate.avoidableTokens || 0;
    const unknown = result.projectAttribution?.unknownTokens || 0;
    console.log(`${bold('Larpkeeper token burn')} ${dim(`(${path.basename(project)})`)}`);
    console.log(`${tr(lang, 'verdict', 'вердикт')}: ${totalTokens > 1000000 || avoidable > 200000 ? red(tr(lang, 'high pressure', 'высокое давление')) : totalTokens > 100000 || avoidable > 50000 ? yellow(tr(lang, 'watch', 'следить')) : green('ok')}`);
    console.log('');
    console.log(`${tr(lang, 'safe estimate', 'безопасная оценка')}   ~${totalTokens} ${tr(lang, 'tokens', 'токенов')}${result.totals ? ` ${tr(lang, 'from', 'из')} ${result.totals.rows} aggregate log rows` : ` ${tr(lang, 'from project context only', 'только из project context')}`}`);
    console.log(`${tr(lang, 'saved/avoidable', 'сэкономлено/можно не тянуть')} ~${avoidable} ${tr(lang, 'avoidable tokens', 'токенов')}; hot context ${result.projectEstimate.hotContextLines} ${tr(lang, 'lines', 'строк')}`);
    console.log(`mode            ${result.mode}`);
    if (result.projectAttribution) {
      console.log(`attribution     ${result.projectAttribution.mode}; indexed sessions ${result.projectAttribution.indexedSessions}`);
      if (unknown) console.log(`unknown bucket  ~${unknown} tokens; Codex logs do not expose cwd for exact project mapping`);
    }
    section(tr(lang, 'Payoff', 'Выигрыш'));
    for (const line of explainLines([
      avoidable
        ? lang === 'ru'
          ? `быстрый выигрыш: можно не тянуть ~${fmtNumber(avoidable)} project-context токенов через более узкие startup packs`
          : `quick win: ~${fmtNumber(avoidable)} project-context tokens can be avoided with tighter startup packs`
        : tr(lang, 'project context is not showing a large avoidable bucket', 'project context не показывает большой avoidable bucket'),
      result.projectEstimate.hotContextLines
        ? lang === 'ru'
          ? `hot context сейчас ${fmtNumber(result.projectEstimate.hotContextLines)} строк; нормальная цель для first-pass context ближе к 500-800 строкам`
          : `hot context is ${fmtNumber(result.projectEstimate.hotContextLines)} lines; target is closer to 500-800 lines for first-pass context`
        : '',
      totalTokens
        ? lang === 'ru'
          ? `сегодня safe aggregate burn ~${fmtNumber(totalTokens)} токенов; ниже видно, где утекает внимание`
          : `today's safe aggregate burn is ~${fmtNumber(totalTokens)} tokens; top targets below show where the attention leak is`
        : '',
      result.topTargets[0]?.estimatedTokens
        ? lang === 'ru'
          ? `самый большой bucket: ${result.topTargets[0].target} — ~${fmtNumber(result.topTargets[0].estimatedTokens)} токенов`
          : `largest single bucket: ${result.topTargets[0].target} at ~${fmtNumber(result.topTargets[0].estimatedTokens)} tokens`
        : '',
    ])) console.log(line);
    section(tr(lang, 'Why It Matters', 'Почему это важно'));
    for (const line of explainLines([
      tr(lang, 'token burn is usually repeated context plus noisy tool output, not just model reasoning', 'token burn чаще всего съедают повторенный контекст и шумный tool output, а не только reasoning модели'),
      avoidable
        ? tr(lang, 'avoidable project context means agents are reading docs that should be scoped, archived, or summarized', 'avoidable project context значит, что агенты читают docs, которые надо scoped/archive/summary')
        : tr(lang, 'project context is not the main pressure point right now', 'project context сейчас не главный источник давления'),
      unknown
        ? tr(lang, 'unknown project attribution is a data-quality limit; use this as a burn signal, not billing truth', 'unknown project attribution — ограничение данных; это сигнал burn, а не биллинговая истина')
        : tr(lang, 'project attribution can point to the hottest repo/session buckets', 'project attribution может показать самые горячие repo/session buckets'),
    ])) console.log(line);
    if (result.topTargets.length) {
      section(tr(lang, 'Top Log Targets', 'Топ источников burn'));
      for (const row of result.topTargets.slice(0, 8)) console.log(`- ${row.target}: ~${row.estimatedTokens} tok (${row.rows} rows)`);
    }
    if (result.topModules.length) {
      section(tr(lang, 'Top Modules/Files', 'Топ modules/files'));
      for (const row of result.topModules.slice(0, 8)) console.log(`- ${row.source}: ~${row.estimatedTokens} tok (${row.rows} rows)`);
    }
    if (result.topProjects.length) {
      section(tr(lang, 'Top Projects', 'Топ проектов'));
      for (const row of result.topProjects.slice(0, 6)) console.log(`- ${row.project}: ~${row.estimatedTokens} tok (${row.threads} threads)`);
    }
    if (result.projectLogEstimate) {
      section(tr(lang, 'Current Project Logs', 'Логи текущего проекта'));
      console.log(`- ~${result.projectLogEstimate.estimatedTokens} tok (${result.projectLogEstimate.threads} threads)`);
    }
    if (result.dailyBuckets.length) {
      section(tr(lang, 'Daily Buckets', 'По дням'));
      for (const row of result.dailyBuckets.slice(0, 7)) console.log(`- ${row.day}: ~${row.estimatedTokens} tok (${row.rows} rows)`);
    }
    if (result.recommendations.length) {
      section(tr(lang, 'What To Cut First', 'Что резать первым'));
      for (const item of result.recommendations) {
        const ru = String(item)
          .replace('Transport/model stream dominates: reduce long turns, compact earlier, and avoid repeating full context in follow-ups.', 'Transport/model stream доминирует: делай turns короче, compact раньше и не повторяй полный контекст в follow-up.')
          .replace('TUI/chat rendering is noisy: keep assistant/tool summaries shorter and avoid pasting long raw output.', 'TUI/chat rendering шумит: держи assistant/tool summaries короче и не вставляй сырой длинный output.')
          .replace('MCP traffic is visible: prefer fewer large MCP calls and summarize MCP results before continuing.', 'MCP traffic заметен: меньше крупных MCP calls, summarize результаты перед продолжением.')
          .replace('Tool output is visible: use `larp run` or `larp compress-output` for tests, logs, grep, and build output.', 'Tool output заметен: используй `larp run` или `larp compress-output` для tests/logs/grep/build.')
          .replace('Project context has avoidable tokens: start sessions with `larp codex-preflight . --task "..."`.', 'Project context содержит avoidable tokens: начинай сессии через `larp codex-preflight . --task "..."`.');
        console.log(`- ${lang === 'ru' ? ru : item}`);
      }
    }
    if (result.warnings.length) {
      section(tr(lang, 'Limits', 'Ограничения'));
      for (const item of result.warnings.slice(0, 4)) console.log(`- ${item}`);
    }
  }
  return result;
}

function spendGuard(project, flags = {}) {
  const burn = tokenBurn(project, { ...flags, returnResult: true });
  const lang = textLang(flags);
  const totalTokens = burn.totals?.estimatedTokens || 0;
  const avoidableTokens = burn.projectEstimate?.avoidableTokens || 0;
  const hotContextLines = burn.projectEstimate?.hotContextLines || 0;
  const topTarget = burn.topTargets[0];
  const pressure =
    totalTokens > 10000000 || avoidableTokens > 200000 || hotContextLines > 8000
      ? 'critical'
      : totalTokens > 1000000 || avoidableTokens > 50000 || hotContextLines > 2000
        ? 'high'
        : totalTokens > 100000 || avoidableTokens > 10000
          ? 'watch'
          : 'ok';
  const maxParallelAgents = pressure === 'critical' || pressure === 'high' ? 1 : pressure === 'watch' ? 2 : 3;
  const expensiveLanesAllowed = pressure === 'critical' || pressure === 'high' ? 'explicit-approval-only' : 'scoped-only';
  const result = {
    project,
    lang,
    since: burn.since,
    pressure,
    maxParallelAgents,
    expensiveLanesAllowed,
    localEstimate: {
      tokens: totalTokens,
      avoidableProjectTokens: avoidableTokens,
      hotContextLines,
      topTarget: topTarget ? { name: topTarget.target, estimatedTokens: topTarget.estimatedTokens } : null,
    },
    immediateActions: [
      'Run codex-preflight before reading more files.',
      'Use pack and repo-map; read only ranked files.',
      'Use exact search, not broad rg/rg --files.',
      'Wrap noisy tests/logs with larp run or compress-output.',
      'Do not spawn multiple expensive agents until scope is smaller.',
    ],
    blockedByDefault: [
      'raw long logs in chat or memory',
      'broad home-directory scans',
      '3+ parallel agents',
      'xhigh/opus/gpt-5.5 lanes without explicit owner approval',
      'archive/heavy docs as startup context',
    ],
    nextCommands: [
      `larp codex-preflight ${quotePath(project)} --task "..." --lang ${lang}`,
      `larp tool-guard ${quotePath(project)} --task "..." --lang ${lang}`,
      `larp repo-map ${quotePath(project)} --task "..."`,
    ],
    limits: burn.warnings,
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${bold('Larpkeeper spend guard')} ${dim(`(${path.basename(project)})`)}`);
    console.log(`${tr(lang, 'pressure', 'давление')}: ${pressure === 'critical' ? red('critical') : pressure === 'high' ? red(tr(lang, 'high', 'высокое')) : pressure === 'watch' ? yellow(tr(lang, 'watch', 'следить')) : green('ok')}`);
    console.log('');
    if (lang === 'ru') {
      console.log(`Локальная оценка burn: ~${fmtNumber(totalTokens)} токенов; это не биллинг провайдера.`);
      console.log(`Можно не тянуть на старте: ~${fmtNumber(avoidableTokens)} project-context токенов; hot context ${fmtNumber(hotContextLines)} строк.`);
      if (topTarget) console.log(`Самый жирный bucket: ${topTarget.target} — ~${fmtNumber(topTarget.estimatedTokens)} токенов.`);
      section('Режим работы');
      console.log(`- параллельных агентов максимум: ${maxParallelAgents}`);
      console.log(`- дорогие lanes: ${expensiveLanesAllowed === 'explicit-approval-only' ? 'только после явного разрешения владельца' : 'только после scoped pack/repo-map'}`);
      section('Сразу делаем');
      for (const item of result.immediateActions) {
        const ru = item
          .replace('Run codex-preflight before reading more files.', 'перед новым чтением файлов запускаем codex-preflight')
          .replace('Use pack and repo-map; read only ranked files.', 'используем pack и repo-map; читаем только ранжированные файлы')
          .replace('Use exact search, not broad rg/rg --files.', 'делаем точечный поиск, не широкий rg/rg --files')
          .replace('Wrap noisy tests/logs with larp run or compress-output.', 'шумные тесты/логи запускаем через larp run или compress-output')
          .replace('Do not spawn multiple expensive agents until scope is smaller.', 'не запускаем несколько дорогих агентов, пока scope не сжат');
        console.log(`- ${ru}`);
      }
      section('Запрещено по умолчанию');
      for (const item of result.blockedByDefault) console.log(`- ${item}`);
      section('Следующие команды');
      for (const cmd of result.nextCommands) console.log(`- ${cmd}`);
    } else {
      console.log(`Local burn estimate: ~${fmtNumber(totalTokens)} tokens; this is not provider billing.`);
      console.log(`Avoidable startup context: ~${fmtNumber(avoidableTokens)} project-context tokens; hot context ${fmtNumber(hotContextLines)} lines.`);
      if (topTarget) console.log(`Largest bucket: ${topTarget.target} at ~${fmtNumber(topTarget.estimatedTokens)} tokens.`);
      section('Work Mode');
      console.log(`- max parallel agents: ${maxParallelAgents}`);
      console.log(`- expensive lanes: ${expensiveLanesAllowed}`);
      section('Immediate Actions');
      for (const item of result.immediateActions) console.log(`- ${item}`);
      section('Blocked By Default');
      for (const item of result.blockedByDefault) console.log(`- ${item}`);
      section('Next Commands');
      for (const cmd of result.nextCommands) console.log(`- ${cmd}`);
    }
  }
  return result;
}

function codexPreflight(project, flags = {}) {
  const task = flags.task || flags.query || '...';
  const packResult = buildGather(project, { ...flags, task, query: task });
  const repo = buildRepoMap(project, { ...flags, task, budget: flags['repo-map-budget'] || 1800 });
  const guard = buildToolGuard(project, flags);
  const budgetResult = computeBudget(project, { ...flags, task, query: task });
  const result = {
    project,
    task,
    readFirst: packResult.recommendedContextPack,
    repoMapCommand: repo.command,
    repoMapTopFiles: repo.includedFiles.slice(0, 8),
    guard,
    budget: {
      beforeTokens: budgetResult.beforeTokens,
      afterTokens: budgetResult.afterTokens,
      savedTokens: budgetResult.savedTokens,
      savedPct: budgetResult.savedPct,
    },
    next: [
      `Read only: ${packResult.recommendedContextPack.join(', ') || 'no default docs'}`,
      `Open repo-map top files first`,
      `Use max_output_tokens <= ${guard.maxOutputTokens}; logs --tail ${guard.logTailLines}`,
    ],
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# Codex preflight\n`);
    console.log(`task: ${task}`);
    console.log(`budget: ~${result.budget.beforeTokens} -> ~${result.budget.afterTokens} tokens, saved ~${result.budget.savedTokens} (${result.budget.savedPct}%)`);
    console.log(`\nread first:`);
    for (const f of result.readFirst) console.log(`- ${f}`);
    console.log(`\nsource map:`);
    for (const f of result.repoMapTopFiles) console.log(`- ${f.path} (${f.lines}l)`);
    console.log(`\nguard: max_output_tokens=${guard.maxOutputTokens}, logs tail=${guard.logTailLines}`);
  }
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
  const largeActive = large.filter((f) => {
    const role = classify(f);
    return role !== 'archive' && role !== 'agent-skill';
  });
  const duplicateEntrySurfaces = files
    .filter((f) => ['agent-entry'].includes(classify(f)))
    .map((f) => ({ path: f.path, lines: f.lines }));
  const activeMemory = considered.filter((f) => ['active-memory', 'product-context'].includes(classify(f))).map((f) => ({ path: f.path, lines: f.lines }));
  const duplicateTerms = scanTerms(considered.filter((f) => !f.path.includes('/archive/') && classify(f) !== 'agent-skill'));
  const hotContextLines = activeMemory.reduce((sum, f) => sum + f.lines, 0) + duplicateEntrySurfaces.reduce((sum, f) => sum + f.lines, 0);
  const broadContextFiles = new Map();
  for (const f of activeMemory) broadContextFiles.set(f.path, f.lines);
  for (const f of duplicateEntrySurfaces) broadContextFiles.set(f.path, f.lines);
  for (const f of largeActive) broadContextFiles.set(f.path, f.lines);
  const broadContextLines = [...broadContextFiles.values()].reduce((sum, lines) => sum + lines, 0);
  const risks = [];
  if (standardPath(project, 'contextIndex') && missing.includes(standardPath(project, 'contextIndex'))) risks.push('missing-default-context-index');
  if (largeActive.length) risks.push('large-active-docs');
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
  report.defaultStart = computeBudget(project, { brief: true }, report);
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
  console.log(`progress       ${progressBar(savings.savedPct)}`);
  console.log(`confidence     ${savings.confidence} - ${savings.confidenceReason}`);
  if (savings.readPack.length) {
    console.log(`read first     ${savings.readPack.join(', ')}`);
  } else {
    console.log(`read first     missing; bootstrap or add a project profile`);
  }
  console.log(`task pack      run ${commandName()} pack ${quotePath(r.project)} --task "..."`);

  section('Payoff');
  bullet(`already avoiding ~${fmtNumber(savings.savedTokens)} tokens per default start (${savings.savedPct}% less broad markdown)`);
  if (savings.afterLines > 500) {
    bullet(`next unlock: cut another ${fmtNumber(linesOverTarget(savings.afterLines, 500))} startup lines to get under the 500-line target`);
  } else {
    bullet('startup pack is already under the 500-line target; the next win is task-specific pack accuracy');
  }
  if (r.large.length) bullet(`biggest dopamine hit: move/summarize ${r.large.length} large active doc${r.large.length === 1 ? '' : 's'}`);

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
    'larp codex-preflight . --task "..."',
    'larp recommend .',
    'larp pack . --task "..."',
    'larp repo-map . --task "..."',
    'larp tool-guard . --task "..."',
    'larp semantic-search . --query "..."',
    'larp compress-output . --file log.txt',
    'larp token-burn . --since today',
    '```',
    '',
    'After `audit`, tell the human: health, cleanup potential, missing files, and next safe command.',
    'Before `rg --files`, broad `rg`, Docker/container logs over 80 lines, or more than one subagent: run `pack` + `repo-map`, then read only the returned docs/source files and exact-search dependencies.',
    'Keep shell outputs compact: prefer exact searches, `--tail 80` for logs, and `max_output_tokens` near the `tool-guard` recommendation. Summarize outputs instead of pasting raw logs.',
    'For token accounting, use allowlisted aggregates only. Do not scan `~/.codex`, auth backups, `.env`, or secret files with broad search.',
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
    if (query && new RegExp(pattern, 'i').test(query)) {
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

function computeBudget(project, flags = {}, auditResult = null) {
  const targetLines = Number(flags['target-lines'] || flags.targetLines || 500);
  const lang = textLang(flags);
  const r = auditResult || audit(project, { quiet: true });
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
    lang,
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
    reduceCandidates: r.large.filter((f) => {
      const role = classify(f);
      return role !== 'archive' && role !== 'agent-skill' && !unique.includes(f.path);
    }).slice(0, 20),
  };
}

function printBudget(result) {
  const lang = result.lang || 'en';
  if (result.brief) {
    console.log(`mode: ${result.estimateKind}`);
    console.log(`could read without Larpkeeper: ${result.beforeLines} lines (~${result.beforeTokens} tok)`);
    console.log(`will read first now: ${result.afterLines} lines (~${result.afterTokens} tok)`);
    console.log(`skipped as not needed now: ${result.savedLines} lines (~${result.savedTokens} tok, ${result.savedPct}% less first-read context)`);
    console.log(`confidence: ${result.confidence} - ${result.confidenceReason}`);
    console.log(`status: ${result.status}`);
    return;
  }
  console.log(`${bold('Larpkeeper context budget')} ${dim(`(${path.basename(result.project)})`)}`);
  console.log(`${tr(lang, 'verdict', 'вердикт')}: ${result.status === 'within-target' ? green(tr(lang, 'within target', 'в цели')) : result.status === 'no-read-pack' ? yellow(tr(lang, 'no read pack', 'нет read pack')) : red(tr(lang, 'over target', 'выше цели'))}`);
  console.log(`mode: ${result.estimateKind}`);
  console.log(`${tr(lang, 'could read without Larpkeeper', 'без Larpkeeper агент мог потащить')}: ${result.beforeLines} ${tr(lang, 'lines', 'строк')} (~${result.beforeTokens} tok)`);
  console.log(`${tr(lang, 'will read first now', 'теперь первым чтением берет')}: ${result.afterLines} ${tr(lang, 'lines', 'строк')} (~${result.afterTokens} tok)`);
  console.log(`${tr(lang, 'skipped as not needed now', 'не читаем лишнего сейчас')}: ${result.savedLines} ${tr(lang, 'lines', 'строк')} (~${result.savedTokens} tok, ${result.savedPct}% ${tr(lang, 'less first-read context', 'меньше стартового контекста')})`);
  console.log(`${tr(lang, 'token effect', 'эффект по токенам')}: ~${result.beforeTokens} -> ~${result.afterTokens}; ${tr(lang, 'not sent now', 'сейчас не отправляем')} ~${result.savedTokens}`);
  console.log(`progress: ${progressBar(result.savedPct)}`);
  console.log(`${tr(lang, 'approx saved/read', 'примерно сэкономлено за чтение')}: $${result.approxUsdSavedPerRead}`);
  console.log(`confidence: ${result.confidence} - ${result.confidenceReason}`);
  console.log(`target: ${result.targetLines} lines`);
  console.log(`status: ${result.status}`);
  section(tr(lang, 'What Improved', 'Что улучшили'));
  for (const line of explainLines([
    result.savedTokens > 0
      ? lang === 'ru'
        ? `раньше первый заход мог тащить ~${fmtNumber(result.beforeTokens)} токенов, теперь стартует с ~${fmtNumber(result.afterTokens)}`
        : `first pass could have pulled ~${fmtNumber(result.beforeTokens)} tokens, now it starts with ~${fmtNumber(result.afterTokens)}`
      : tr(lang, 'no measurable context saving yet because no read pack exists', 'измеримой экономии пока нет, потому что read pack не собран'),
    result.savedPct > 0
      ? lang === 'ru'
        ? `${result.savedPct}% широкого markdown остается доступным, но не грузится в первое чтение`
        : `${result.savedPct}% of broad markdown stays available but out of the first read`
      : tr(lang, '0% avoided means the project needs a context index/profile before payoff appears', '0% экономии значит, что проекту нужен context index/profile'),
    result.afterLines > result.targetLines
      ? lang === 'ru'
        ? `следующая цель: срезать еще ${fmtNumber(linesOverTarget(result.afterLines, result.targetLines))} строк из ${result.estimateKind} pack`
        : `next target: cut ${fmtNumber(linesOverTarget(result.afterLines, result.targetLines))} more lines from the ${result.estimateKind} pack`
      : lang === 'ru'
        ? `цель достигнута: ${fmtNumber(result.afterLines)} строк внутри бюджета ${fmtNumber(result.targetLines)}`
        : `target hit: ${fmtNumber(result.afterLines)} lines is within the ${fmtNumber(result.targetLines)} line budget`,
  ])) console.log(line);
  section(tr(lang, 'Why It Matters', 'Почему это важно'));
  for (const line of explainLines([
    result.estimateKind === 'task-pack'
      ? tr(lang, 'this estimates the context a task-specific agent should read before implementation', 'это оценка контекста, который task-agent должен прочитать перед реализацией')
      : tr(lang, 'this estimates the default startup context before the task is known', 'это оценка стартового контекста до того, как известна конкретная задача'),
    result.savedTokens > 0
      ? tr(lang, 'saved tokens are old/broad markdown the agent can avoid without deleting the underlying knowledge', 'сэкономленные токены — это старый/широкий markdown, который можно не читать без удаления знания')
      : tr(lang, 'there is no clear read pack yet, so the next session may either under-read or over-read', 'четкого read pack пока нет, поэтому следующая сессия может недочитать или перечитать лишнее'),
    result.status === 'over-target'
      ? tr(lang, 'over-target packs should be split into current summary plus scoped references', 'over-target pack нужно разнести на current summary и scoped references')
      : tr(lang, 'within-target packs are suitable as the first read, then expand through repo-map/exact search', 'pack внутри цели подходит для первого чтения, дальше расширяемся через repo-map/exact search'),
  ])) console.log(line);
  section(tr(lang, 'Read Pack', 'Read Pack'));
  for (const f of result.readPack) console.log(`- ${f}`);
  if (result.reduceCandidates.length) {
    const shown = result.reduceCandidates.slice(0, 10);
    const shownLines = shown.reduce((sum, f) => sum + Number(f.lines || 0), 0);
    section(tr(lang, 'Not Loaded On First Pass', 'Что не грузим в первый заход'));
    console.log(tr(
      lang,
      `These files are still available, but Larpkeeper keeps them out of the startup pack until the task needs them. Top ${shown.length} shown: ${fmtNumber(shownLines)} lines.`,
      `Эти файлы не удалены и остаются доступны, но Larpkeeper не кладет их в стартовый pack без необходимости. Ниже топ-${shown.length}: ${fmtNumber(shownLines)} строк.`,
    ));
    for (const f of shown) console.log(`- ${f.path} (${f.lines} ${tr(lang, 'lines', 'строк')})`);
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
  const targetLines = Math.max(1, Number(flags['target-lines'] || flags.targetLines || 500));
  const profile = profileFor(project);
  const defaultRead = new Set(existing(project, profile.defaultRead));
  const scopedRead = new Set(profile.scoped.flatMap(([, files]) => existing(project, files)));
  const actions = [];
  const excluded = [];
  let projectedRemaining = b.beforeLines;
  const addAction = (action) => {
    const savings = Math.max(0, Number(action.projectedSavings || 0));
    projectedRemaining = Math.max(0, projectedRemaining - savings);
    actions.push({
      ...action,
      currentLines: Number(action.currentLines || 0),
      projectedSavings: savings,
      projectedRemaining,
      status: projectedRemaining <= targetLines ? 'on-target' : 'above-target',
      targetLines,
      estimate: true,
    });
  };
  for (const f of r.large) {
    const role = classify({ path: f.path });
    if (role === 'archive' || role === 'agent-skill') {
      excluded.push({ path: f.path, category: role, currentLines: f.lines, reason: 'not an active prune action' });
      continue;
    }
    if (role === 'agent-entry' && r.duplicateEntrySurfaces.length > 1) continue;
    const isDefault = defaultRead.has(f.path);
    const isScopedOnly = !isDefault && scopedRead.has(f.path);
    const category = isDefault ? 'default-read' : isScopedOnly ? 'task-scoped' : 'hot-active';
    const action = isScopedOnly
      ? 'summarize-or-index-task-scoped-doc'
      : isDefault || ['active-memory', 'product-context'].includes(role)
        ? 'summarize-or-index-authoritative-doc'
        : 'archive-or-split';
    const reason = isScopedOnly
      ? `${f.lines} lines in task-scoped profile read`
      : isDefault
        ? `${f.lines} lines in default profile read`
        : `${f.lines} lines outside profile read sets`;
    addAction({ action, path: f.path, category, currentLines: f.lines, projectedSavings: Math.max(0, f.lines - Math.min(160, f.lines)), reason });
  }
  if (r.duplicateEntrySurfaces.length > 1) {
    const currentLines = r.duplicateEntrySurfaces.reduce((sum, f) => sum + f.lines, 0);
    const projectedSavings = Math.max(0, currentLines - Math.max(...r.duplicateEntrySurfaces.map((f) => f.lines)));
    addAction({ action: 'dedupe-agent-entry-surfaces', category: 'hot-active', paths: r.duplicateEntrySurfaces.map((f) => f.path), currentLines, projectedSavings, reason: 'multiple agent startup files can duplicate instructions; review before editing' });
  }
  const plan = {
    project,
    mode: 'plan-only',
    targetLines,
    budget: b,
    baselineLines: b.beforeLines,
    projectedSavings: Math.max(0, b.beforeLines - projectedRemaining),
    projectedRemaining,
    status: projectedRemaining <= targetLines ? 'on-target' : 'above-target',
    actions,
    excluded,
  };
  if (flags.json) console.log(JSON.stringify(plan, null, 2));
  else {
    console.log(`# prune plan\n`);
    console.log(`budget before: ${b.beforeLines} lines`);
    console.log(`budget after: ${b.afterLines} lines`);
    console.log(`budget saved: ${b.savedLines} lines (${b.savedPct}%)`);
    console.log(`budget status: ${b.status}`);
    console.log(`prune target: ${targetLines} lines; projected remaining: ${projectedRemaining} (${plan.status})`);
    console.log(``);
    for (const a of actions) console.log(`- ${a.action} [${a.category}]: ${a.path || a.paths.join(', ')} (${a.currentLines} lines, saves ~${a.projectedSavings}, leaves ~${a.projectedRemaining}; ${a.status})`);
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
  const duplicationHints = [];
  const consistencyHints = [];
  const semanticConflicts = [];
  for (const p of ['CLAUDE.md', 'PLAN.md', 'ARCHITECTURE.md', 'STATUS.md']) {
    const f = path.join(project, p);
    if (fs.existsSync(f)) consistencyHints.push({ type: 'possibly-stale-entry', path: p, confidence: 'low', reason: 'generic active-looking file may drift; compare with current docs/code' });
  }
  for (const [term, hits] of Object.entries(r.duplicateTerms || {})) {
    if (hits.length >= 5) duplicationHints.push({ type: 'repeated-term', term, files: hits.slice(0, 6).map((h) => h.path), confidence: 'high', reason: 'same concept repeated across many files; this is not proof of contradiction' });
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
  if (cardRows.length) consistencyHints.push({ type: 'hermes-card-drift', files: cardRows, confidence: 'medium', reason: 'repo hermes card differs from ~/.hermes card; review source-of-truth before syncing' });
  const hints = [...semanticConflicts, ...consistencyHints, ...duplicationHints];
  const legacyHints = [
    ...semanticConflicts,
    ...consistencyHints,
    ...duplicationHints.map((hint) => ({ ...hint, type: 'repeated-instruction' })),
  ];
  const result = { project, version: 2, duplicationHints, consistencyHints, semanticConflicts, hints, legacyHints };
  if (flags.json) console.log(JSON.stringify(flags.structured ? result : legacyHints, null, 2));
  else {
    console.log(`# conflict and duplication hints\n`);
    console.log(`confirmed semantic conflicts: ${semanticConflicts.length}`);
    for (const h of semanticConflicts.slice(0, 40)) {
      console.log(`- ${h.type}: ${h.path || h.term || (h.files || []).join(', ')} — ${h.reason}`);
    }
    console.log(`consistency hints: ${consistencyHints.length}`);
    for (const h of consistencyHints.slice(0, 40)) {
      console.log(`- ${h.type}: ${h.path || h.term || (h.files || []).join(', ')} — ${h.reason}`);
    }
    console.log(`duplication hints: ${duplicationHints.length}`);
    for (const h of duplicationHints.slice(0, 40)) {
      console.log(`- ${h.type}: ${h.path || h.term || (h.files || []).join(', ')} — ${h.reason}`);
    }
    if (!hints.length) console.log('- no obvious consistency or duplication hints');
  }
  return result;
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
  console.log(`report-only by default: audit, gather, budget, prune, runs-prune, score, doctor, conflicts, blindspots, pressure, update, recommend, watch, profile-sync`);
  console.log(`writes only with --apply: bootstrap, init, maintain, fix-safe, install-adapter, journal, compact-handoff, compact-chat, finish, profile-sync, runs-prune`);
  console.log(`runs-prune retention defaults: keep last ${RUN_RETENTION_DEFAULTS.keepLast} artifacts and artifacts newer than ${RUN_RETENTION_DEFAULTS.keepDays} days; only run-* files are eligible`);
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
  const body = buildSmartCompactHandoff(project, note);
  if (flags.apply) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body);
  }
  console.log(`${flags.apply ? 'wrote' : 'would write'} ${outRel}`);
  console.log('Use this as the compact summary before continuing in a fresh/compacted context.');
}

function buildCompiledContext(project, flags = {}) {
  const now = new Date().toISOString();
  const r = audit(project, { quiet: true });
  const budget = computeBudget(project, { brief: true });
  const readStandard = (role) => {
    const relativePath = standardPath(project, role);
    return relativePath ? readTextIfExists(path.join(project, relativePath)) : '';
  };
  const contextIndex = compactLinesFromMarkdown(readStandard('contextIndex'), { maxLines: 12 });
  const currentState = compactLinesFromMarkdown(readStandard('currentState'), { maxLines: 18 });
  const worklogFacts = extractRecentFactsFromMarkdown(readStandard('worklog'), { maxFacts: 10 });
  const journalFacts = extractRecentFactsFromMarkdown(readStandard('journal'), { maxFacts: 8 });
  const graphiti = graphitiRowsForProject(project, 6);
  const facts = [...worklogFacts, ...journalFacts].slice(-14);
  const touched = [...new Set(facts.flatMap((fact) => fact.files || []))].slice(0, 18);
  const next = [...new Set(facts.map((fact) => fact.next).filter(Boolean))].slice(-6);
  return {
    project,
    generatedAt: now,
    audit: {
      hotContextLines: r.hotContextLines,
      broadContextLines: r.broadContextLines,
      risks: r.risks,
    },
    budget: {
      beforeLines: budget.beforeLines,
      afterLines: budget.afterLines,
      savedTokens: budget.savedTokens,
      savedPct: budget.savedPct,
    },
    currentTruth: currentState.length ? currentState : contextIndex,
    recentFacts: facts,
    touchedFiles: touched,
    next,
    memory: graphiti,
  };
}

function formatCompiledContext(compiled) {
  const lines = [
    '# Compiled Context',
    '',
    `Generated: ${compiled.generatedAt}`,
    `Project: ${compiled.project}`,
    '',
    '## Why This Exists',
    '',
    'This is the compact compiled layer: raw worklogs/journals stay available, but future agents should start from current truth and recent durable facts instead of reading append-only history.',
    '',
    '## Current Truth',
    '',
    ...(compiled.currentTruth.length ? compiled.currentTruth : ['- No current truth found.']),
    '',
    '## Recent Durable Facts',
    '',
    ...(compiled.recentFacts.length
      ? compiled.recentFacts.map((fact) => `- ${fact.fact}`)
      : ['- No recent facts compiled.']),
    '',
    '## Touched Files',
    '',
    ...(compiled.touchedFiles.length ? compiled.touchedFiles.map((file) => `- ${file}`) : ['- No touched files compiled.']),
    '',
    '## Next / Open Loops',
    '',
    ...(compiled.next.length ? compiled.next.map((item) => `- ${item}`) : ['- No open loops compiled.']),
    '',
    '## Memory Rows',
    '',
    ...(compiled.memory.length ? compiled.memory : ['- No matching Graphiti rows found.']),
    '',
    '## Context Budget',
    '',
    `- hot context: ${compiled.audit.hotContextLines} lines`,
    `- broad context: ${compiled.audit.broadContextLines} lines`,
    `- first read: ${compiled.budget.afterLines} lines`,
    `- not loaded on first pass: ~${compiled.budget.savedTokens} tokens (${compiled.budget.savedPct}% less)`,
    `- risks: ${compiled.audit.risks.join(', ') || 'none'}`,
    '',
    '## Rules',
    '',
    '- Treat this as a compiled entrypoint, not full product truth.',
    '- Expand through `larp pack`, `larp repo-map`, exact search, then touched files.',
    '- Read archived/raw worklog only for contradiction resolution or missing evidence.',
    '',
  ];
  return lines.join('\n');
}

function compileMemory(project, flags = {}) {
  const compiled = buildCompiledContext(project, flags);
  const text = formatCompiledContext(compiled);
  const outRel = flags.file || 'docs/COMPILED_CONTEXT.md';
  const out = path.join(project, outRel);
  if (flags.apply) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
  }
  if (flags.json) console.log(JSON.stringify({ ...compiled, file: outRel, wrote: Boolean(flags.apply) }, null, 2));
  else {
    console.log(`${flags.apply ? 'wrote' : 'would write'} ${outRel}`);
    console.log(`facts: ${compiled.recentFacts.length}`);
    console.log(`touched files: ${compiled.touchedFiles.length}`);
    console.log(`first read: ${compiled.budget.afterLines} lines; saved ~${compiled.budget.savedTokens} tokens`);
    if (!flags.apply) console.log('dry-run: use --apply to write compiled context');
  }
  return compiled;
}

function fileFreshness(project, relativePath) {
  const absolutePath = path.join(project, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  const mtimeMs = fs.statSync(absolutePath).mtimeMs;
  return {
    path: relativePath,
    mtimeMs,
    modifiedAt: new Date(mtimeMs).toISOString(),
  };
}

function compiledContextFreshness(project) {
  const compiled = fileFreshness(project, 'docs/COMPILED_CONTEXT.md');
  const sources = ['currentState', 'worklog', 'journal']
    .map((role) => standardPath(project, role))
    .filter(Boolean)
    .map((file) => fileFreshness(project, file))
    .filter(Boolean);
  const newestSource = sources.slice().sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
  const state = !compiled
    ? 'missing'
    : newestSource && newestSource.mtimeMs > compiled.mtimeMs
      ? 'stale'
      : 'fresh';
  return {
    state,
    file: 'docs/COMPILED_CONTEXT.md',
    compiledAt: compiled?.modifiedAt || null,
    newestSource: newestSource?.path || null,
    newestSourceAt: newestSource?.modifiedAt || null,
    sources,
    reason: state === 'missing'
      ? 'compiled context does not exist'
      : state === 'stale'
        ? `${newestSource.path} is newer than docs/COMPILED_CONTEXT.md`
        : newestSource
          ? 'compiled context is at least as new as all source memory files'
          : 'compiled context exists and no source memory files were found',
  };
}

function workflowStatus(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const packResult = buildGather(project, { task: flags.task || flags.query || 'workflow status' }, r);
  const guard = buildToolGuard(project, flags);
  const compileFreshness = compiledContextFreshness(project);
  const standardReadiness = (role) => {
    const relativePath = standardPath(project, role);
    if (relativePath === null) return 'not-configured';
    return fs.existsSync(path.join(project, relativePath)) ? 'ready' : 'missing';
  };
  const result = {
    project,
    state: {
      audit: r.risks.length ? 'warning' : 'ok',
      pack: packResult.recommendedContextPack.length ? 'ready' : 'missing',
      worklog: standardReadiness('worklog'),
      journal: standardReadiness('journal'),
      compile: compileFreshness.state,
      guard: guard.pressureLevel,
    },
    compileFreshness,
    workflow: [
      'audit',
      'pack',
      'repo-map',
      'tool-guard',
      'work',
      'finish',
      'verify',
      'compile-memory',
    ],
    next: compileFreshness.state === 'fresh'
      ? [`${commandName()} pack ${quotePath(project)} --task "..."`]
      : [`${commandName()} compile-memory ${quotePath(project)} --apply`],
    risks: r.risks,
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# workflow status\n`);
    console.log(`project: ${path.basename(project)}`);
    for (const [key, value] of Object.entries(result.state)) console.log(`- ${key}: ${value}`);
    console.log(`\ncompile freshness: ${compileFreshness.reason}`);
    if (compileFreshness.compiledAt) console.log(`- compiled at: ${compileFreshness.compiledAt}`);
    if (compileFreshness.newestSourceAt) console.log(`- newest source: ${compileFreshness.newestSource} at ${compileFreshness.newestSourceAt}`);
    console.log(`\nworkflow: ${result.workflow.join(' -> ')}`);
    console.log(`\nnext:`);
    for (const item of result.next) console.log(`- ${item}`);
  }
  return result;
}

function automationPlan(project, flags = {}) {
  const r = audit(project, { quiet: true });
  const result = {
    project,
    mode: 'guarded-plan',
    principles: [
      'Never auto-delete or auto-prune without explicit apply.',
      'Run scheduled audit/recommend/token-burn/digest safely.',
      'Trigger pressure compact from host signals when available.',
      'Keep raw logs in .larpkeeper/runs and show compressed summaries.',
    ],
    automations: [
      { name: 'scheduled-maintenance', command: `${commandName()} audit ${quotePath(project)} && ${commandName()} recommend ${quotePath(project)}`, writes: false },
      { name: 'pressure-check', command: `${commandName()} pressure ${quotePath(project)} --brief`, writes: false },
      { name: 'smart-compact', command: `${commandName()} compact-chat ${quotePath(project)} --apply`, writes: true, guard: 'only when pressure or hot context threshold is exceeded' },
      { name: 'memory-compile', command: `${commandName()} compile-memory ${quotePath(project)} --apply`, writes: true, guard: 'after meaningful finish/worklog entries' },
      { name: 'prune-plan', command: `${commandName()} prune ${quotePath(project)} --json`, writes: false },
      { name: 'run-retention', command: `${commandName()} runs-prune ${quotePath(project)} --json`, writes: false, retention: RUN_RETENTION_DEFAULTS },
    ],
    currentPressure: {
      hotContextLines: r.hotContextLines,
      risks: r.risks,
    },
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# automation plan\n`);
    console.log(`project: ${path.basename(project)}`);
    console.log(`mode: ${result.mode}`);
    console.log(`\nprinciples:`);
    for (const item of result.principles) console.log(`- ${item}`);
    console.log(`\nautomations:`);
    for (const item of result.automations) {
      console.log(`- ${item.name}: ${item.command}`);
      if (item.guard) console.log(`  guard: ${item.guard}`);
    }
  }
  return result;
}

function readTextIfExists(file) {
  try {
    if (!fs.existsSync(file)) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function compactLinesFromMarkdown(text, opts = {}) {
  const maxLines = opts.maxLines || 24;
  const keepHeadings = opts.keepHeadings !== false;
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^#{1,4}\s+/.test(line)) {
      if (keepHeadings) out.push(line.replace(/^#{1,4}\s+/, '### '));
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      out.push(line.length > 220 ? `${line.slice(0, 217)}...` : line);
      continue;
    }
    if (/^(Result|Done|Next|Evidence|Files|Tests|Deploy|Warning|Preference|Source):/i.test(line)) {
      out.push(line.length > 220 ? `${line.slice(0, 217)}...` : line);
      continue;
    }
    if (out.length < 6 && line.length < 180) out.push(line);
    if (out.length >= maxLines) break;
  }
  return out.slice(0, maxLines);
}

function extractRecentFactsFromMarkdown(text, opts = {}) {
  const maxFacts = opts.maxFacts || 12;
  const parts = String(text || '').split(/\n(?=###\s+)/).filter((part) => part.trim());
  const facts = [];
  for (const entry of parts.slice(-30)) {
    const heading = entry.match(/^###\s+(.+)$/m)?.[1]?.trim();
    const result = entry.match(/^(?:Result|Done|Preference):\s*(.+)$/im)?.[1]?.trim();
    const next = entry.match(/^Next:\s*(.+)$/im)?.[1]?.trim();
    const evidence = entry.match(/^Evidence:\s*([\s\S]*?)(?:\n###|\n[A-Z][A-Za-z ]+:\s|\s*$)/m)?.[1]?.trim();
    const files = [...entry.matchAll(/^-\s+([^\n]+)$/gm)]
      .map((m) => m[1].trim())
      .filter((line) => /^(src|docs|scripts|bin|profiles|test|apps|packages)\//.test(line))
      .slice(0, 5);
    const textLine = result || next || heading;
    if (!textLine) continue;
    facts.push({
      heading: heading || 'entry',
      fact: textLine.length > 260 ? `${textLine.slice(0, 257)}...` : textLine,
      next: next && next !== textLine ? next.slice(0, 220) : null,
      evidence: evidence ? evidence.split(/\n/).map((line) => line.replace(/^-\s*/, '').trim()).filter(Boolean).slice(0, 3) : [],
      files,
    });
  }
  return facts.slice(-maxFacts);
}

function tailMarkdownEntries(text, maxEntries = 4) {
  const parts = String(text || '').split(/\n(?=###\s+)/).filter((part) => part.trim());
  return parts.slice(-maxEntries).flatMap((entry) => compactLinesFromMarkdown(entry, { maxLines: 10 })).slice(0, maxEntries * 10);
}

function graphitiRowsForProject(project, maxRows = 5) {
  const file = path.join(os.homedir(), '.hermes/graphiti/context_notes.jsonl');
  if (!fs.existsSync(file)) return [];
  const base = path.basename(project).toLowerCase();
  const aliases = new Set([base]);
  if (base === 'metis') aliases.add('metis');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const projects = Array.isArray(row.projects) ? row.projects : row.project ? [row.project] : [];
      const hay = `${row.project || ''} ${projects.join(' ')} ${row.title || ''}`.toLowerCase();
      if ([...aliases].some((alias) => hay.includes(alias))) rows.push(row);
    } catch {
      // Skip malformed durable memory rows.
    }
  }
  return rows.slice(-maxRows).map((row) => {
    const title = row.title || row.kind || row.maintenance_type || 'context note';
    const content = String(row.content || row.note || '').replace(/\s+/g, ' ').trim();
    const short = content.length > 220 ? `${content.slice(0, 217)}...` : content;
    return `- ${title}: ${short}`;
  });
}

function buildSmartCompactHandoff(project, note) {
  const now = new Date().toISOString();
  const r = audit(project, { quiet: true });
  const budget = computeBudget(project, { brief: true });
  let tokenBurn = null;
  try {
    const tmp = spawnSync(process.execPath, [process.argv[1], 'token-burn', project, '--since', 'today', '--json'], {
      cwd: project,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    });
    if (tmp.status === 0 && tmp.stdout.trim()) tokenBurn = JSON.parse(tmp.stdout);
  } catch {
    tokenBurn = null;
  }

  const contextIndex = compactLinesFromMarkdown(readTextIfExists(path.join(project, 'docs/CONTEXT_INDEX.md')), { maxLines: 18 });
  const currentState = compactLinesFromMarkdown(readTextIfExists(path.join(project, 'docs/CURRENT_STATE.md')), { maxLines: 28 });
  const decisions = tailMarkdownEntries(readTextIfExists(path.join(project, 'docs/DECISIONS.md')), 3);
  const worklog = tailMarkdownEntries(readTextIfExists(path.join(project, 'docs/WORKLOG.md')), 5);
  const journal = tailMarkdownEntries(readTextIfExists(path.join(project, 'docs/CONTEXT_JOURNAL.md')), 5);
  const graphiti = graphitiRowsForProject(project, 6);
  const reduceCandidates = (budget.reduceCandidates || []).slice(0, 8).map((f) => `- ${f.path} (${f.lines} lines)`);
  const tokenTargets = (tokenBurn?.topTargets || []).slice(0, 5).map((t) => `- ${t.target}: ~${t.estimatedTokens} tokens`);
  const recommendations = (tokenBurn?.recommendations || []).slice(0, 4).map((x) => `- ${x}`);

  return [
    '# Compact Handoff',
    '',
    `Generated: ${now}`,
    `Project: ${project}`,
    '',
    '## Goal',
    '',
    note,
    '',
    '## Current Truth',
    '',
    ...(currentState.length ? currentState : contextIndex.length ? contextIndex : ['- No current-state docs found. Read runtime code plus touched files.']),
    '',
    '## Recent Worklog',
    '',
    ...(worklog.length ? worklog : ['- No recent worklog entries found.']),
    '',
    '## Recent Context Journal',
    '',
    ...(journal.length ? journal : ['- No recent context journal entries found.']),
    '',
    '## Decisions',
    '',
    ...(decisions.length ? decisions : ['- No recent decisions found.']),
    '',
    '## Memory',
    '',
    ...(graphiti.length ? graphiti : ['- No matching Graphiti context rows found.']),
    '',
    '## Context Budget',
    '',
    `- broad context: ${r.broadContextLines} lines (~${approxTokensFromLines(r.broadContextLines)} tokens)`,
    `- hot context: ${r.hotContextLines} lines`,
    `- default/task pack estimate: ${budget.afterLines} lines (~${budget.afterTokens} tokens)`,
    `- avoidable tokens: ${budget.savedTokens}`,
    `- risks: ${(r.risks || []).join(', ') || 'none'}`,
    '',
    '## Token Burn',
    '',
    tokenBurn
      ? `- today estimated burn: ${tokenBurn.totals?.estimatedTokens ?? 0} tokens from ${tokenBurn.totals?.rows ?? 0} safe aggregate rows`
      : '- token-burn unavailable',
    ...tokenTargets,
    ...recommendations,
    '',
    '## Keep Out Of Default Context',
    '',
    ...(reduceCandidates.length ? reduceCandidates : ['- No reduce candidates reported.']),
    '',
    '## Next',
    '',
    '- Start future work with `larp codex-preflight <project> --task "..."`.',
    '- Read this compact handoff, `docs/CONTEXT_INDEX.md`, `docs/CURRENT_STATE.md`, then touched files only.',
    '- Use `larp run` or `larp compress-output` for long command output.',
    '- Inspect `larp prune --json` candidates before moving heavy docs; do not auto-prune important history.',
    '',
    '## Do Not Repeat',
    '',
    '- Do not read broad markdown or archive docs before a task pack.',
    '- Do not paste raw logs, prompts, auth, token, or secret-like content into repo docs, Obsidian, Graphiti, or chat.',
    '- Do not treat this file as complete product truth; it is a compact continuation surface.',
    '',
  ].join('\n');
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
  const budget = r.defaultStart || computeBudget(project, { brief: true }, r);
  if (r.missing.length || r.risks.length || budget.status === 'over-target' || profileProblems.length) {
    const contributors = [...r.activeMemory, ...r.duplicateEntrySurfaces, ...r.large]
      .filter((item) => !['archive', 'agent-skill'].includes(classify({ path: item.path })))
      .filter((item, index, rows) => rows.findIndex((candidate) => candidate.path === item.path) === index)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 5);
    console.log('context validation: warning');
    if (r.missing.length) console.log(`missing: ${r.missing.join(', ')}`);
    if (r.risks.length) console.log(`risks: ${r.risks.join(', ')}`);
    if (profileProblems.length) console.log(`profile issues: ${profileProblems.join(', ')}`);
    console.log(`hot context: actual ${r.hotContextLines} lines; target <= 800 lines`);
    console.log(`default start: actual ${budget.afterLines} lines; target <= ${budget.targetLines} lines`);
    if (contributors.length) console.log(`top contributors: ${contributors.map((item) => `${item.path} (${item.lines} lines)`).join(', ')}`);
    console.log(`recommended command: ${nextFromAudit(r, project).command}`);
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
    ['no-read-everything', r.hotContextLines <= 800, `hot context ${r.hotContextLines} lines`, 'agents may drag broad docs into every turn', `${commandName()} pack ${quotePath(project)} --task "..."`],
    ['archive-not-delete', !archivePolicy || fs.existsSync(path.join(project, archivePolicy)), 'archive policy should exist before pruning', 'without archive rules, cleanup can become destructive or inconsistent', `${commandName()} bootstrap ${quotePath(project)} --apply`],
    ['clear-source-roles', (contextIndex && fs.existsSync(path.join(project, contextIndex))) || fs.existsSync(path.join(project, 'AGENTS.md')), 'needs routing/index source', 'agents need one map that says where current truth lives', `${commandName()} bootstrap ${quotePath(project)} --apply`],
    ['handoff-compact', !fs.existsSync(path.join(project, 'handoff.md')) || lineCount(path.join(project, 'handoff.md')) <= 260, 'handoff should stay compact', 'long handoffs become raw transcripts and confuse later sessions', `${commandName()} compact-handoff ${quotePath(project)} --file handoff.md --apply`],
    ['skills-router-only', r.duplicateEntrySurfaces.length <= 8, `${r.duplicateEntrySurfaces.length} agent entry surfaces`, 'too many entry surfaces can create competing instructions', `${commandName()} audit ${quotePath(project)}`],
    ['graphiti-safe', true, 'Graphiti writes require explicit --graphiti/--apply', 'durable machine memory should stay sourced and intentional', `${commandName()} finish ${quotePath(project)} --apply --graphiti`],
    ['duplication-surface', r.duplicateTerms && Object.keys(r.duplicateTerms).length < 16, `${Object.keys(r.duplicateTerms || {}).length} repeated-term clusters`, 'repeated themes are duplication hints, not proof of contradiction; review source ownership before cleanup', `${commandName()} conflicts ${quotePath(project)} --structured`],
    ['migration-contained', !(r.duplicateTerms.migration && r.duplicateTerms.migration.length > 8), 'migration terms should live in migration docs', 'migration notes should not become the default source of current behavior', `${commandName()} prune ${quotePath(project)}`],
    ['fast-session-start', !contextIndex || r.missing.includes(contextIndex) === false, `${contextIndex || 'context index'} enables fast startup`, 'without an index, every agent has to rediscover the project map', `${commandName()} bootstrap ${quotePath(project)} --apply`],
    ['journal-present', !journalRel || fs.existsSync(path.join(project, journalRel)), 'journal records context changes', 'without a journal, context edits cannot be audited later', `${commandName()} bootstrap ${quotePath(project)} --apply`],
  ].map(([name, ok, detail, impact, fix]) => ({ name, status: ok ? 'pass' : 'warn', detail, impact, fix }));
  const result = { project, checks };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    const warnings = checks.filter((c) => c.status === 'warn');
    console.log(`${bold('Larpkeeper doctor')} ${dim(`(${path.basename(project)})`)}`);
    console.log(`health: ${warnings.length ? yellow(`${warnings.length} warnings`) : green('clean')}`);
    section('Findings');
    for (const c of checks) {
      console.log(`- ${c.status.padEnd(4)} ${c.name}: ${c.detail}`);
      if (c.status === 'warn') {
        console.log(`  impact: ${c.impact}`);
        console.log(`  fix: ${c.fix}`);
      }
    }
    if (!warnings.length) {
      section('Next');
      console.log(`  ${cyan(`${commandName()} pack ${quotePath(project)} --task "..."`)}`);
      console.log(`  ${dim('context health is clean; move through task-scoped context instead of broad reading')}`);
    }
  }
}

async function main() {
  const { cmd, project, flags } = parse(process.argv.slice(2));
  await maybeNotifyUpdate(cmd || 'help', flags);
  if (!cmd || cmd === 'help' || flags.help) usage();
  else if (cmd === 'audit') audit(project, flags);
  else if (cmd === 'pitch') pitch(project, flags);
  else if (cmd === 'gather') gather(project, flags);
  else if (cmd === 'codex-preflight' || cmd === 'preflight') codexPreflight(project, flags);
  else if (cmd === 'repo-map' || cmd === 'map') repoMap(project, flags);
  else if (cmd === 'semantic-search' || cmd === 'search') semanticSearch(project, flags);
  else if (cmd === 'tool-guard' || cmd === 'guard') toolGuard(project, flags);
  else if (cmd === 'compress-output' || cmd === 'compress') compressOutput(project, flags);
  else if (cmd === 'run') runWrapped(project, flags);
  else if (cmd === 'runs-prune') runsPrune(project, flags);
  else if (cmd === 'token-burn' || cmd === 'tokens') tokenBurn(project, flags);
  else if (cmd === 'spend-guard' || cmd === 'cost-guard') spendGuard(project, flags);
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
  else if (cmd === 'compile-memory') compileMemory(project, flags);
  else if (cmd === 'workflow-status') workflowStatus(project, flags);
  else if (cmd === 'automation-plan') automationPlan(project, flags);
  else if (cmd === 'diff-cards') diffCards(project, flags);
  else if (cmd === 'validate') validate(project);
  else throw new Error(`unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(`larpkeeper: ${err.message}`);
  process.exit(2);
});
