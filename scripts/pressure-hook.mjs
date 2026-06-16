#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const CLI = path.join(ROOT, 'bin/context-gardener.mjs');

function parse(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    }
  }
  return flags;
}

function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const text = fs.readFileSync(0, 'utf8').trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function number(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function pickSignals(flags, input, env) {
  const maxTokens = number(
    flags['max-tokens'],
    flags.maxTokens,
    input.maxTokens,
    input.max_tokens,
    env.LARPK_MAX_TOKENS,
    env.CODEX_MAX_TOKENS,
    env.CLAUDE_MAX_TOKENS,
  );
  const percent = number(
    flags.percent,
    input.percent,
    input.contextPercent,
    input.context_percent,
    env.LARPK_CONTEXT_PERCENT,
    env.CODEX_CONTEXT_PERCENT,
    env.CLAUDE_CONTEXT_PERCENT,
  );
  const tokens = number(
    flags.tokens,
    input.tokens,
    input.usedTokens,
    input.used_tokens,
    env.LARPK_TOKENS,
    env.CODEX_TOKENS,
    env.CLAUDE_TOKENS,
    percent && maxTokens ? Math.round((percent / 100) * maxTokens) : 0,
  );
  return {
    tokens,
    maxTokens,
    messages: number(flags.messages, input.messages, input.messageCount, input.message_count, env.LARPK_MESSAGES),
    toolLines: number(flags['tool-lines'], flags.toolLines, input.toolLines, input.tool_lines, env.LARPK_TOOL_LINES),
  };
}

function runPressure(project, signals) {
  const args = [
    CLI,
    'pressure',
    project,
    '--tokens', String(signals.tokens),
    '--max-tokens', String(signals.maxTokens),
    '--messages', String(signals.messages),
    '--tool-lines', String(signals.toolLines),
    '--json',
  ];
  return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
}

function render(result, format) {
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  if (result.level === 'ok') return '';
  const line = `Larpkeeper: ${result.level} score=${result.score}. ${result.recommendation}.`;
  const details = `signals: tokens=${result.signals.tokens || '-'} max=${result.signals.maxTokens || '-'} messages=${result.signals.messages || '-'} toolLines=${result.signals.toolLines || '-'}`;
  if (format === 'plain') return `${line}\n${details}\n`;
  return `<system-reminder>\n${line}\n${details}\nWhen safe, run: larp compact-chat . --apply or write a compact handoff before continuing broad work.\n</system-reminder>\n`;
}

const flags = parse(process.argv.slice(2));
const project = path.resolve(flags.project || flags._ || process.cwd());
const input = readStdinJson();
const signals = pickSignals(flags, input, process.env);
const result = runPressure(project, signals);
const out = render(result, flags.format || 'reminder');
if (out) process.stdout.write(out);
