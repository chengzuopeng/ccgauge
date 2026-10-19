#!/usr/bin/env node
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'ccgauge-exec-launch-'));

function rollout(name, originator) {
  const id = `${name}-thread`;
  const events = [
    { timestamp: '2026-10-18T05:59:09Z', type: 'session_meta', payload: { id, cwd: '/tmp/game', originator, cli_version: '0.162.0', thread_source: 'user' } },
    { timestamp: '2026-10-18T05:59:10Z', type: 'event_msg', payload: { type: 'user_message', message: '工作方式（最先照做）：直接调用你内置的 image_gen' } },
    { timestamp: '2026-10-18T05:59:11Z', type: 'turn_context', payload: { turn_id: `${name}-t1`, cwd: '/tmp/game', model: 'gpt-6.1-sol', effort: 'xhigh' } },
    {
      timestamp: '2026-10-18T05:59:20Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0 } } },
    },
    {
      timestamp: '2026-10-18T05:59:30Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 2000, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 } } },
    },
  ];
  const file = join(dir, `rollout-${name}.jsonl`);
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return file;
}

try {
  const entry = join(dir, 'entry.ts');
  writeFileSync(
    entry,
    [
      "export { parseCodexJsonlFile } from '@/lib/providers/codex/parse-codex-jsonl';",
      "export { recordsToTurnRows } from '@/lib/serialize';",
      "export { matchesLaunch, isLaunchFilter } from '@/lib/launch';",
    ].join('\n'),
  );
  const outfile = join(dir, 'bundle.mjs');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    alias: { '@': root },
    logLevel: 'error',
  });
  const m = await import(pathToFileURL(outfile).href);

  const exec = await m.parseCodexJsonlFile(rollout('exec', 'codex_exec'));
  const desktop = await m.parseCodexJsonlFile(rollout('desktop', 'Codex Desktop'));

  {
    assert.equal(exec.assistant.length, 2);
    for (const r of exec.assistant) assert.equal(r.launch, 'exec', 'every call of a codex exec run is marked');
    for (const r of desktop.assistant) assert.equal('launch' in r, false, 'an interactive session carries no mark');
    console.log('✓ parser: session_meta.originator "codex_exec" marks every call of the run');
  }

  {
    const parentMap = {};
    for (const [uuid, parent] of [...exec.parentLinks, ...desktop.parentLinks]) parentMap[uuid] = parent;
    const rows = m.recordsToTurnRows([...exec.assistant, ...desktop.assistant], [...exec.user, ...desktop.user], parentMap);
    const execTurn = rows.find((t) => t.sessionId === 'exec-thread');
    const desktopTurn = rows.find((t) => t.sessionId === 'desktop-thread');
    assert.equal(execTurn.launch, 'exec');
    assert.ok(execTurn.children.every((c) => c.launch === 'exec'));
    assert.equal(desktopTurn.launch, undefined);
    assert.ok(desktopTurn.children.every((c) => c.launch === undefined));
    console.log('✓ turn rows: an exec run is tagged on the turn and on each call');
  }

  {
    const execCall = exec.assistant[0];
    const interactiveCall = desktop.assistant[0];
    const claudeCall = { launch: undefined };
    assert.deepEqual(
      [m.matchesLaunch(execCall, 'all'), m.matchesLaunch(interactiveCall, 'all'), m.matchesLaunch(claudeCall, 'all')],
      [true, true, true],
    );
    assert.deepEqual(
      [m.matchesLaunch(execCall, 'interactive'), m.matchesLaunch(interactiveCall, 'interactive'), m.matchesLaunch(claudeCall, 'interactive')],
      [false, true, true],
    );
    assert.deepEqual(
      [m.matchesLaunch(execCall, 'exec'), m.matchesLaunch(interactiveCall, 'exec'), m.matchesLaunch(claudeCall, 'exec')],
      [true, false, false],
    );
    assert.equal(m.isLaunchFilter('interactive'), true);
    assert.equal(m.isLaunchFilter('everything'), false);
    assert.equal(m.isLaunchFilter(null), false);
    console.log('✓ the initiator filter keeps all, only interactive, or only exec calls');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('\nAll exec-launch assertions passed.');
