#!/usr/bin/env node --experimental-strip-types --no-warnings

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const root = dirname(dirname(__filename));

const { buildTurnIndex } = await import(join(root, 'lib/turns.ts'));

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

console.log('\nAll turn-grouping assertions passed.');
