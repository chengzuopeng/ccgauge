#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { buildTurnIndex } = await import(join(root, 'lib/turns.ts'));
const { isSyntheticUserText, parseJsonlFile } = await import(
  join(root, 'lib/data-loader/parse-jsonl.ts'),
);

function user(uuid, textPreview, opts = {}) {
  return { uuid, textPreview, isSynthetic: opts.isSynthetic ?? false };
}
function assistant(uuid) {
  return { uuid };
}

{
  const users = [user('user-A', 'Hello, can you help me?')];
  const assistants = [assistant('asst-1'), assistant('asst-2'), assistant('asst-3')];
  const parentMap = {
    'asst-1': 'user-A',
    'asst-2': 'asst-1',
    'asst-3': 'asst-2',
    'user-A': null,
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(index.get('asst-1'), 'user-A', 'linear: asst-1 → user-A');
  assert.equal(index.get('asst-2'), 'user-A', 'linear: asst-2 → user-A (transitively)');
  assert.equal(index.get('asst-3'), 'user-A', 'linear: asst-3 → user-A (transitively)');
  console.log('✓ scenario 1: linear turn collapses to the user root');
}

{
  const users = [
    user('user-A', 'Please run the mf-commit skill'),
    user('synth-1', 'Base directory for this skill: ~/.claude/skills/mf-commit', {
      isSynthetic: true,
    }),
  ];
  const assistants = [assistant('asst-1'), assistant('asst-2'), assistant('asst-3')];
  const parentMap = {
    'asst-1': 'user-A',
    'synth-1': 'asst-1',
    'asst-2': 'synth-1',
    'asst-3': 'asst-2',
    'user-A': null,
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(index.get('asst-1'), 'user-A', 'synthetic: asst-1 → user-A');
  assert.equal(
    index.get('asst-2'),
    'user-A',
    'synthetic: asst-2 must skip synth-1 and reach user-A (v3 regression site)',
  );
  assert.equal(index.get('asst-3'), 'user-A', 'synthetic: asst-3 → user-A (transitively)');
  console.log('✓ scenario 2: synthetic user injection is skipped as a turn root');
}

{
  const users = [
    user('user-A', 'Run my failing tests'),
    user('synth-r', '<system-reminder>TodoWrite hasn\'t been used recently...</system-reminder>', {
      isSynthetic: true,
    }),
  ];
  const assistants = [assistant('asst-1'), assistant('asst-2')];
  const parentMap = {
    'asst-1': 'user-A',
    'synth-r': 'asst-1',
    'asst-2': 'synth-r',
    'user-A': null,
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(index.get('asst-2'), 'user-A', 'reminder: asst-2 → user-A (not synth-r)');
  console.log('✓ scenario 3: <system-reminder> synthetic user is skipped');
}

{
  const users = [user('user-A', 'first prompt'), user('user-B', 'second prompt')];
  const assistants = [assistant('asst-A1'), assistant('asst-B1'), assistant('asst-B2')];
  const parentMap = {
    'asst-A1': 'user-A',
    'asst-B1': 'user-B',
    'asst-B2': 'asst-B1',
    'user-A': null,
    'user-B': 'asst-A1',
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(index.get('asst-A1'), 'user-A');
  assert.equal(index.get('asst-B1'), 'user-B');
  assert.equal(index.get('asst-B2'), 'user-B');
  console.log('✓ scenario 4: two real users root two separate turns');
}

{
  const users = [
    user('synth-only', 'Base directory for this skill: ~/.claude/skills/orphan', {
      isSynthetic: true,
    }),
  ];
  const assistants = [assistant('orphan-asst')];
  const parentMap = {
    'orphan-asst': 'synth-only',
    'synth-only': null,
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(
    index.get('orphan-asst'),
    'orphan-asst',
    'orphan: assistant with no real user ancestor uses its own uuid',
  );
  console.log('✓ scenario 5: orphan assistant falls back to its own uuid');
}

{
  const users = [
    user('user-empty', ''),
    user('user-real', 'real prompt'),
  ];
  const assistants = [assistant('asst-1')];
  const parentMap = {
    'asst-1': 'user-empty',
    'user-empty': 'user-real',
    'user-real': null,
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  assert.equal(
    index.get('asst-1'),
    'user-real',
    'empty-text user is invisible; walk continues to user-real',
  );
  console.log('✓ scenario 6: user with empty textPreview is invisible to turn detection');
}

{
  const users = [];
  const assistants = [assistant('asst-cycle-1'), assistant('asst-cycle-2')];
  const parentMap = {
    'asst-cycle-1': 'asst-cycle-2',
    'asst-cycle-2': 'asst-cycle-1',
  };
  const index = buildTurnIndex(assistants, users, parentMap);

  assert.ok(
    index.has('asst-cycle-1') && index.has('asst-cycle-2'),
    'cycle: both assistants get a (fallback) turn id without hanging',
  );
  console.log('✓ scenario 7: parentUuid cycle is broken (no infinite loop)');
}

// ── isSyntheticUserText classification (the turn-root gate) ────────────
{
  // Harness-injected user messages must be classified synthetic so they are
  // skipped as turn roots. `<task-notification>` is the one that regressed:
  // background-task / Workflow completions were each spawning a standalone
  // "<task-notification>…" row in the usage table.
  assert.ok(
    isSyntheticUserText('<task-notification>\n<task-id>a1d3ccc1ba</task-id>\n<output-file>…'),
    'task-notification is synthetic (the fix)',
  );
  assert.ok(isSyntheticUserText('  <task-notification> leading whitespace tolerated'));
  assert.ok(isSyntheticUserText('<system-reminder>x</system-reminder>'));
  assert.ok(isSyntheticUserText('Caveat: The messages below were generated by the user'));
  assert.ok(isSyntheticUserText('Base directory for this skill: ~/.claude/skills/mf-commit'));
  // A slash command's console echo is synthetic; the invocation that carries
  // the user's own args is not.
  assert.ok(isSyntheticUserText('<local-command-stdout>Goal set: 开发 dev</local-command-stdout>'));
  assert.equal(
    isSyntheticUserText('<command-name>/goal</command-name>\n<command-args>开发 dev</command-args>'),
    false,
    'the invocation the user typed still roots its turn',
  );
  // A genuine user prompt that merely mentions the word is NOT synthetic.
  assert.equal(isSyntheticUserText('how do task-notification messages work?'), false);
  assert.equal(isSyntheticUserText('请帮我 review 一下整体改动'), false);
  console.log('✓ scenario 8: <task-notification> (and friends) classify as synthetic');
}

// ── end-to-end: a run of task-notifications folds into the spawning turn ─
{
  // Mirrors the reported bug: one real prompt spawns background tasks, then a
  // burst of `<task-notification>` completions arrive, each with its own
  // assistant response. All of that work must fold into the single real turn.
  const users = [
    user('user-review', 'Review target: 整体 review 下所有改动'),
    user('tn-1', '<task-notification>\n<task-id>aaa</task-id>', { isSynthetic: true }),
    user('tn-2', '<task-notification>\n<task-id>bbb</task-id>', { isSynthetic: true }),
    user('tn-3', '<task-notification>\n<task-id>ccc</task-id>', { isSynthetic: true }),
  ];
  const assistants = [
    assistant('asst-spawn'), // the turn that fans out the background tasks
    assistant('asst-tn-1'),
    assistant('asst-tn-2'),
    assistant('asst-tn-3'),
  ];
  const parentMap = {
    'user-review': null,
    'asst-spawn': 'user-review',
    'tn-1': 'asst-spawn',
    'asst-tn-1': 'tn-1',
    'tn-2': 'asst-tn-1',
    'asst-tn-2': 'tn-2',
    'tn-3': 'asst-tn-2',
    'asst-tn-3': 'tn-3',
  };
  const index = buildTurnIndex(assistants, users, parentMap);
  for (const a of ['asst-spawn', 'asst-tn-1', 'asst-tn-2', 'asst-tn-3']) {
    assert.equal(index.get(a), 'user-review', `${a} folds into the spawning review turn`);
  }
  console.log('✓ scenario 9: a burst of task-notifications folds into one spawning turn');
}

// ── isMeta: harness-injected messages never root a turn ───────────────
{
  // Claude Code marks everything IT injected with `isMeta`, and none of it was
  // typed by the user: slash-command expansions, Stop-hook announcements and
  // feedback, "Continue from where you left off.", image placeholders. Before
  // this was read, 8% of usage rows were titled with that text — a single
  // typed message could scatter across half a dozen rows.
  //
  // `<task-notification>` is here too because it carries NO `isMeta` (175 of
  // 175 real records checked): the marker and the prefix list each cover what
  // the other misses, and dropping either one brings the rows back.
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'ccgauge-meta-'));
  const file = join(dir, 'session.jsonl');

  const asst = (uuid, parentUuid) => ({
    type: 'assistant',
    uuid,
    parentUuid,
    timestamp: '2026-08-19T10:00:00.000Z',
    sessionId: 's1',
    message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [] },
  });
  const usr = (uuid, parentUuid, text, extra = {}) => ({
    type: 'user',
    uuid,
    parentUuid,
    timestamp: '2026-08-19T10:00:00.000Z',
    sessionId: 's1',
    message: { role: 'user', content: text },
    ...extra,
  });

  writeFileSync(
    file,
    [
      usr('u-real', null, '看一下 pdp 上方的图片展示逻辑'),
      asst('a-1', 'u-real'),
      // /simplify expansion — injected, marked.
      usr('u-slash', 'a-1', '`/simplify → 4 cleanup agents in parallel`\n\nYou are improving…', { isMeta: true }),
      asst('a-2', 'u-slash'),
      // Stop hook announcement — injected, marked.
      usr('u-hook', 'a-2', 'A session-scoped Stop hook is now active with condition: "…"', { isMeta: true }),
      asst('a-3', 'u-hook'),
      // Background task completion — injected, but NOT marked; prefix catches it.
      usr('u-task', 'a-3', '<task-notification>\n<task-id>a3f53d766</task-id>', {}),
      asst('a-4', 'u-task'),
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n',
    'utf8',
  );

  const parsed = await parseJsonlFile(file);

  rmSync(dir, { recursive: true, force: true });

  const byUuid = Object.fromEntries(parsed.user.map((u) => [u.uuid, u]));
  assert.equal(byUuid['u-real'].isSynthetic, false, 'a typed prompt still roots its own turn');
  assert.equal(byUuid['u-slash'].isSynthetic, true, 'slash-command expansion is synthetic (isMeta)');
  assert.equal(byUuid['u-hook'].isSynthetic, true, 'Stop hook announcement is synthetic (isMeta)');
  assert.equal(byUuid['u-task'].isSynthetic, true, 'task-notification is synthetic (prefix, no isMeta)');

  const parentMap = Object.fromEntries(parsed.parentLinks);
  const index = buildTurnIndex(parsed.assistant, parsed.user, parentMap);
  for (const a of ['a-1', 'a-2', 'a-3', 'a-4']) {
    assert.equal(index.get(a), 'u-real', `${a} folds into the one message the user typed`);
  }
  console.log('✓ isMeta injections + task-notifications all fold into the typed prompt');
}

console.log('\nAll turn-grouping assertions passed.');
