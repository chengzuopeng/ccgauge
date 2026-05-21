#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, createReadStream, existsSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');
const pkg = require(join(packageRoot, 'package.json'));

// commander is needed before we even parse argv to know which subcommand
// the user asked for, so we load it eagerly. `get-port` (only used by
// start / restart) and `open` (only by start / open) are deferred so
// short-lived commands like `mcp`, `status`, `logs`, `report`, `--version`
// don't pay their import cost (~20-30 ms cold-start each).
const { Command } = await import('commander');
async function loadGetPort() {
  const mod = await import('get-port');
  return mod.default;
}
async function loadOpenBrowser() {
  const mod = await import('open');
  return mod.default;
}

const STATE_DIR = process.env.CCGAUGE_STATE_DIR || join(os.homedir(), '.ccgauge');
const STATE_FILE = join(STATE_DIR, 'state.json');
const DEFAULT_LOG_FILE = join(STATE_DIR, 'ccgauge.log');
const STATE_VERSION = 1;
const DEFAULT_PORT = '3737';
const DEFAULT_HOST = '127.0.0.1';
const COMMAND_NAMES = new Set([
  'start', 'stop', 'restart', 'status', 'open', 'logs', 'mcp',
  'report', 'doctor',
]);
// `start` subcommand's own option set (incl. short aliases). The value
// indicates whether the option consumes the following positional as a
// value. Used by `normalizeArgv` to decide whether `ccgauge -p 3000`
// should be treated as the bare-`start` shortcut. Anything outside this
// set (e.g. `-r` / `--range` from `report`) makes us bail out and let
// commander surface its own "unknown option" against the root program
// — which lists subcommands. Keep in sync with `addStartOptions`.
const START_OPTIONS = new Map([
  ['-p', true], ['--port', true],
  ['-H', true], ['--host', true],
  ['--dir', true],
  ['--log', true],
  ['-q', false], ['--quiet', false],
  ['-b', false], ['--background', false],
  ['--no-open', false],
  ['--strict-port', false],
]);

function browserHost(host) {
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
  return host;
}

function buildUrl(host, port) {
  return `http://${browserHost(host)}:${port}`;
}

/** Decide whether to emit ANSI colour. Precedence (high → low):
 *  1. `forceOff` (commander's `--no-color`) → off.
 *  2. `NO_COLOR` env var (NO_COLOR.org convention) → off.
 *  3. `FORCE_COLOR` env var → on (covers tee / pipes / CI).
 *  4. stdout TTY check → on.
 *  5. else → off.
 *
 *  We take `forceOff` as an explicit boolean rather than reading
 *  `opts.color` directly because commander gives `.option('--no-color')`
 *  a default of `true` — there's no in-band way to distinguish "user
 *  didn't say anything" from "user passed --color". Callers translate
 *  their own option to `forceOff: opts.color === false`. */
function shouldUseColor({ forceOff = false } = {}) {
  if (forceOff) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

function safeKill(pid, signal) {
  if (!pid) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    throw err;
  }
}

function addStartOptions(cmd) {
  return cmd
    .option('-p, --port <port>', 'preferred port', DEFAULT_PORT)
    .option('-H, --host <host>', 'bind host', DEFAULT_HOST)
    .option('--no-open', 'do not auto-open the browser (foreground only)')
    .option('--dir <path>', 'override Claude config dir (will append /projects)')
    .option('-q, --quiet', 'silence Next.js output')
    .option('-b, --background', 'run in the background')
    .option('--strict-port', 'fail if the preferred port is unavailable')
    .option('--log <path>', 'background log file', DEFAULT_LOG_FILE);
}

// Browser-open policy:
//   - foreground: open by default; --no-open disables.
//   - background: never auto-open. Use `ccgauge open` after start.
function shouldOpenBrowser(opts) {
  if (opts.background) return false;
  return opts.open !== false;
}

// For `restart`: when the user did not explicitly pass an option, fall back
// to whatever the previous background run was using.
async function inheritFromState(opts, cmd) {
  const prev = await readState();
  if (!prev) return { ...opts };
  const isDefault = (key) => cmd.getOptionValueSource(key) === 'default';
  // `--dir` has no default value (see addStartOptions), so commander
  // reports its source as `undefined` when unset and `'cli'` when the
  // user typed it — including `--dir ""` which means "clear override".
  // Using truthy-on-opts.dir would conflate "unset" and "explicit empty"
  // and re-inherit the old dataDir, defeating the whole point of
  // letting users switch back to the default Claude path on restart.
  const isProvided = (key) => cmd.getOptionValueSource(key) === 'cli';
  const merged = { ...opts };
  if (isDefault('port') && prev.port) merged.port = String(prev.port);
  if (isDefault('host') && prev.host) merged.host = prev.host;
  if (isDefault('log') && prev.logFile) merged.log = prev.logFile;
  if (!isProvided('dir') && prev.dataDir) merged.dir = prev.dataDir;
  return merged;
}

const program = new Command();
program
  .name('ccgauge')
  .description(pkg.description ?? 'Local Usage Dashboard')
  .version(pkg.version ?? '0.0.0');

addStartOptions(program.command('start').description('start the dashboard'))
  .action(async (opts) => {
    await start(opts);
  });

program
  .command('stop')
  .description('stop a background dashboard')
  .option('--force', 'force kill the background process')
  .action(async (opts) => {
    await stop({ force: opts.force, verbose: true });
  });

addStartOptions(program.command('restart').description('restart the background dashboard'))
  .action(async (opts, cmd) => {
    const merged = await inheritFromState(opts, cmd);
    await stop({ force: false, verbose: false });
    await start({ ...merged, background: true });
  });

program
  .command('status')
  .description('show background dashboard status')
  .option('--json', 'print machine-readable JSON')
  .action(async (opts) => {
    await status(opts);
  });

program
  .command('open')
  .description('open the running background dashboard')
  .action(async () => {
    await openRunningDashboard();
  });

program
  .command('logs')
  .description('show background dashboard logs')
  .option('-f, --follow', 'follow log output')
  .option('-n, --lines <lines>', 'number of lines to show', '80')
  .action(async (opts) => {
    await logs(opts);
  });

program
  .command('mcp')
  .description('start the MCP server (stdio) so LLMs can query usage data')
  .option('--check', 'verify the bundle + indexer; print one line per provider and exit')
  .action(async (opts) => {
    await startMcp(opts);
  });

program
  .command('doctor')
  .description('print a one-screen diagnostic: env, build artifacts, state, indexer')
  .action(async () => {
    await doctor();
  });

function addReportOptions(cmd) {
  return cmd
    .option('-r, --range <range>', 'today | 1d | 7d | 30d | 90d | all', '7d')
    .option('-s, --source <provider>', 'claude | codex | all', 'all')
    .option('-b, --by <dim>', 'breakdown dimension: model | project | session', 'model')
    .option('-g, --gran <granularity>', 'trend granularity: hour | day | week | month', 'day')
    .option('-n, --limit <n>', 'rows in breakdown table', '10')
    .option('--since <date>', 'override range start (ISO date or YYYY-MM-DD)')
    .option('--until <date>', 'override range end (ISO date or YYYY-MM-DD)')
    .option('-m, --model <pat>', 'filter by model substring')
    .option('--project <pat>', 'filter by project (cwd basename match)')
    .option('-j, --json', 'output JSON instead of formatted text')
    .option('--no-color', 'disable ANSI colors')
    .option('--no-trend', 'skip the trend chart')
    .option('--no-breakdown', 'skip the breakdown table');
}

addReportOptions(program.command('report').description('print a formatted usage report to stdout'))
  .action(async (opts) => {
    await report(opts);
  });

await program.parseAsync(normalizeArgv(process.argv));

/** Implements `ccgauge` (no subcommand) as a shortcut for `ccgauge start`,
 *  but only when every flag we see belongs to `start`. If the user typed
 *  something that looks like a `report` / `mcp` flag without the
 *  subcommand (e.g. `ccgauge -r 7d`), we leave argv alone so commander
 *  surfaces "unknown option" against the root program — which lists the
 *  available subcommands. Without this discrimination commander would
 *  complain about `start: unknown option -r`, which is the wrong hint. */
function normalizeArgv(argv) {
  const args = argv.slice(2);
  // `ccgauge` (no args) is documented as a shortcut for `ccgauge start` —
  // we deliberately do NOT early-return on `args.length === 0`. The flag
  // walk below is a no-op for an empty argv, so we fall through to the
  // final `[argv[0], argv[1], 'start']` injection.
  if (args.includes('--help') || args.includes('-h') || args.includes('-V') || args.includes('--version')) {
    return argv;
  }
  // First token is a known subcommand → caller knows what they're doing.
  if (args.length > 0 && COMMAND_NAMES.has(args[0])) return argv;
  // Walk flags; bail if we see anything `start` doesn't accept.
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if (!arg.startsWith('-')) {
      // Stray positional with no subcommand prefix → let commander error
      // out at the root rather than after silently picking `start`.
      return argv;
    }
    // Support `--port=3737` style: only the part before `=` is the flag.
    const eqIdx = arg.indexOf('=');
    const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    if (!START_OPTIONS.has(flag)) return argv;
    // If the option takes a value and the user didn't inline it with `=`,
    // the next token is the value — skip it so we don't re-check it as a
    // flag.
    if (START_OPTIONS.get(flag) === true && eqIdx < 0) i += 1;
  }
  return [argv[0], argv[1], 'start', ...args];
}

async function start(opts) {
  const standaloneEntry = assertStandaloneEntry();
  const background = Boolean(opts.background);
  if (background) {
    await startBackground(standaloneEntry, opts);
    return;
  }
  await startForeground(standaloneEntry, opts);
}

async function startForeground(standaloneEntry, opts) {
  const port = await resolvePort(opts);
  const env = makeServerEnv(opts, port);
  // `spawn` (not `fork`) because Next's standalone server is a plain
  // node script — it doesn't use the IPC channel. `fork` would open one
  // anyway, and since Next never calls `process.disconnect()`, the
  // parent could never exit cleanly without `process.exit()` racing the
  // child's shutdown. `spawn` matches the background path and lets us
  // hand the child our stdio directly. `--quiet` muffles both streams
  // (Next's warnings go to stderr, so muting only stdout misses them).
  const stdio = opts.quiet
    ? ['ignore', 'ignore', 'ignore']
    : 'inherit';
  const child = spawn(process.execPath, [standaloneEntry], {
    cwd: dirname(standaloneEntry),
    env,
    stdio,
  });

  const url = buildUrl(opts.host, port);
  waitForUrl(url, 15_000)
    .then(async () => {
      if (shouldOpenBrowser(opts)) await tryOpen(url);
      printReady(url, { background: false });
    })
    .catch((err) => {
      console.error(`\n[ccgauge] error: failed to start: ${err.message}\n`);
      safeKill(child.pid, 'SIGTERM');
      process.exit(1);
    });

  // Forward our signals to the child, then wait for it to exit so its
  // teardown is observable rather than racing `process.exit()`. The
  // child propagates the exit code back via the `exit` event below.
  function forward(signal) {
    return () => {
      if (!child.killed) child.kill(signal);
      // Don't process.exit() here; let `child.on('exit')` decide. If the
      // child ignores the signal for some reason, a second Ctrl+C will
      // re-enter and the OS eventually escalates.
    };
  }
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  process.on('exit', () => {
    if (!child.killed) child.kill('SIGTERM');
  });

  child.on('exit', (code, signal) => {
    // Convention: signal-terminated child → 128 + signal number (bash
    // standard). Plain numeric exit → forward as-is. `code === null`
    // happens when only `signal` is set.
    if (typeof code === 'number') process.exit(code);
    else process.exit(signal ? 128 : 0);
  });
}

async function startBackground(standaloneEntry, opts) {
  const existing = await readState();
  if (existing && isProcessRunning(existing.pid, existing)) {
    printAlreadyRunning(existing);
    return;
  }
  if (existing) await removeState();

  await ensureStateDir();
  const port = await resolvePort(opts);
  const env = makeServerEnv(opts, port);
  const logFile = resolve(String(opts.log || DEFAULT_LOG_FILE));
  await mkdir(dirname(logFile), { recursive: true });
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');
  const child = spawn(process.execPath, [standaloneEntry], {
    cwd: dirname(standaloneEntry),
    env,
    detached: true,
    stdio: ['ignore', out, err],
    // Suppress the fleeting console window that Windows pops up for a
    // detached background child. No-op on macOS/Linux.
    windowsHide: true,
  });
  child.unref();
  // Once spawn() has dup'd these fds into the child, the parent can release them.
  try { closeSync(out); } catch { /* ignore */ }
  try { closeSync(err); } catch { /* ignore */ }

  const url = buildUrl(opts.host, port);
  try {
    await waitForUrl(url, 15_000);
  } catch (startErr) {
    if (isProcessRunning(child.pid)) {
      safeKill(child.pid, 'SIGTERM');
      const exited = await waitForProcessExit(child.pid, 2_000);
      if (!exited) safeKill(child.pid, 'SIGKILL');
    }
    // The actual reason (EADDRINUSE, bad CCGAUGE_CONFIG_DIR, port taken
    // by a sibling that survived getPort's check, etc.) is in the log
    // file that the spawned child writes to. Surface the tail so users
    // don't have to discover `ccgauge logs` themselves.
    const tail = await tailLog(logFile, 5);
    const tailNote = tail ? `\nLast log lines (${logFile}):\n${tail}\n` : '';
    throw new Error(`failed to start background service: ${startErr.message}${tailNote}`);
  }

  await writeState({
    pid: child.pid,
    port,
    host: opts.host,
    url,
    logFile,
    startedAt: new Date().toISOString(),
    bootId: bootId(),
    // The Next.js standalone bundle renames the process via
    // `process.title = 'next-server (vX.Y.Z)'` on boot, so `ps` will
    // show "next-server" in the command column. Pinning that as the
    // identity marker means a recycled PID belonging to some other
    // node process won't pass the identity check in isProcessRunning.
    cmdMarker: 'next-server',
    packageRoot,
    dataDir: opts.dir ? String(opts.dir) : null,
  });
  printReady(url, { background: true, logFile, pid: child.pid });
}

async function stop({ force = false, verbose = true } = {}) {
  const state = await readState();
  if (!state) {
    if (verbose) console.log('[ccgauge] no background service state found');
    return false;
  }
  if (!isProcessRunning(state.pid, state)) {
    await removeState();
    if (verbose) console.log('[ccgauge] background service is not running; cleaned stale state');
    return false;
  }

  safeKill(state.pid, force ? 'SIGKILL' : 'SIGTERM');
  const stopped = await waitForProcessExit(state.pid, force ? 2_000 : 6_000);
  if (!stopped && !force) {
    safeKill(state.pid, 'SIGKILL');
    await waitForProcessExit(state.pid, 2_000);
  }
  await removeState();
  if (verbose) console.log(`[ccgauge] stopped background service (pid ${state.pid})`);
  return true;
}

async function status(opts) {
  const state = await readState();
  const running = !!state && isProcessRunning(state.pid, state);
  if (state && !running) await removeState();

  const payload = state
    ? { running, ...state }
    : { running: false };
  // Exit-code convention split between the two output modes:
  // - Plain text → systemd-style 3 when not running, so
  //   `if ccgauge status; then …` works in shell.
  // - `--json`   → always 0; the consumer is a script that should read
  //   `payload.running` from the JSON. Non-zero here would break
  //   pipelines like `ccgauge status --json | jq` under `set -e`.
  // Number inlined (no const) because this function sits below the
  // file's top-level `await program.parseAsync(...)` — a const there
  // would be in the TDZ when commander invokes the action handler.
  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (!running) {
    console.log('ccgauge is not running');
    process.exit(3);
  }
  console.log([
    'ccgauge is running',
    `URL: ${state.url}`,
    `PID: ${state.pid}`,
    `Started: ${state.startedAt}`,
    `Log: ${state.logFile}`,
  ].join('\n'));
}

async function openRunningDashboard() {
  const state = await readState();
  if (!state || !isProcessRunning(state.pid, state)) {
    if (state) await removeState();
    console.error('[ccgauge] error: background service is not running');
    process.exit(1);
  }
  await tryOpen(state.url);
  console.log(`[ccgauge] opened ${state.url}`);
}

async function logs(opts) {
  const state = await readState();
  const logFile = state?.logFile || DEFAULT_LOG_FILE;
  if (!existsSync(logFile)) {
    console.error(`[ccgauge] error: log file not found: ${logFile}`);
    process.exit(1);
  }
  const lines = Math.max(1, parseInt(String(opts.lines), 10) || 80);
  const content = await readFile(logFile, 'utf8');
  const tail = content.split(/\r?\n/).slice(-lines).join('\n');
  if (tail.trim()) process.stdout.write(tail.endsWith('\n') ? tail : tail + '\n');
  if (!opts.follow) return;
  await followLog(logFile, content.length);
}

/** Shared "build artifact missing" template. Used by start / report /
 *  mcp so all three give the same diagnostic shape and so future
 *  artifacts only need a one-line registration here. Three install
 *  sources mean three different remediation hints:
 *
 *  - `npm`: the tarball should already contain this — reinstall is the
 *    move. We also print `node -v` / `ccgauge -v` so issue reports
 *    don't lose those.
 *  - `source`: a `pnpm build` (or the per-artifact target) is missing.
 *  - `dev`: there's no built artifact in dev mode — point at `pnpm dev`. */
function missingArtifactError({ artifactName, expectedPath, buildCmd, devCmd }) {
  const lines = [
    '',
    `[ccgauge] error: ${artifactName} not found:`,
    `  ${expectedPath}`,
    '',
    'If you installed ccgauge from npm: please reinstall — the published',
    'package should include this artifact. Include the following in any',
    'bug report so we can spot a packaging regression:',
    `  node:    ${process.version}`,
    `  ccgauge: v${pkg.version ?? '?'}`,
    `  platform: ${process.platform}/${process.arch}`,
    '',
    `If you are running from source: build first with`,
    `  $ ${buildCmd}`,
  ];
  if (devCmd) lines.push(`or run the dev server with`, `  $ ${devCmd}`);
  lines.push('');
  console.error(lines.join('\n'));
  process.exit(1);
}

function assertStandaloneEntry() {
  const standaloneEntry = join(packageRoot, '.next', 'standalone', 'server.js');
  if (existsSync(standaloneEntry)) return standaloneEntry;
  missingArtifactError({
    artifactName: 'Build artifact',
    expectedPath: standaloneEntry,
    buildCmd: 'pnpm build',
    devCmd: 'pnpm dev',
  });
}

async function report(opts) {
  const bundle = join(packageRoot, 'dist', 'report', 'index.mjs');
  if (!existsSync(bundle)) {
    missingArtifactError({
      artifactName: 'Report bundle',
      expectedPath: bundle,
      buildCmd: 'pnpm build:report',
    });
  }
  const limit = parseInt(String(opts.limit ?? '10'), 10);
  const reportOpts = {
    range: String(opts.range ?? '7d'),
    source: String(opts.source ?? 'all'),
    by: String(opts.by ?? 'model'),
    gran: String(opts.gran ?? 'day'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
    since: opts.since ? String(opts.since) : undefined,
    until: opts.until ? String(opts.until) : undefined,
    json: Boolean(opts.json),
    color: shouldUseColor({ forceOff: opts.color === false }),
    showTrend: opts.trend !== false,
    showBreakdown: opts.breakdown !== false,
    model: opts.model ? String(opts.model) : undefined,
    project: opts.project ? String(opts.project) : undefined,
  };
  let payload;
  try {
    const mod = await import(pathToFileURL(bundle).href);
    const out = await mod.runReport(reportOpts);
    payload = out.endsWith('\n') ? out : out + '\n';
  } catch (err) {
    console.error(`[ccgauge] error: report failed: ${(err && err.message) || err}`);
    process.exit(1);
  }
  // The indexer keeps fs watchers alive, which would block process exit.
  // For a one-shot report we explicitly exit once stdout is drained.
  // Use the write() return value rather than chaining a `drain` listener
  // after the fact: if drain fires between the write and the listener
  // attach, we'd hang forever waiting for an event that already happened.
  const flushed = process.stdout.write(payload);
  if (flushed) {
    process.exit(0);
  } else {
    process.stdout.once('drain', () => process.exit(0));
  }
}

async function startMcp(opts = {}) {
  const bundle = join(packageRoot, 'dist', 'mcp', 'server.mjs');
  if (!existsSync(bundle)) {
    missingArtifactError({
      artifactName: 'MCP server bundle',
      expectedPath: bundle,
      buildCmd: 'pnpm build:mcp',
    });
  }

  // --check: don't actually run the JSON-RPC server — load the bundle,
  // boot the indexer, print one line per provider, and exit. Lets users
  // verify their install without wiring up an MCP client.
  if (opts.check) {
    const mod = await import(pathToFileURL(bundle).href);
    if (typeof mod.printCheck !== 'function') {
      console.error('[ccgauge-mcp] error: this bundle was built without --check support');
      process.exit(1);
    }
    const code = await mod.printCheck();
    process.exit(typeof code === 'number' ? code : 0);
  }

  // Run the bundled MCP server **in this process** — the bundle exposes a
  // top-level `runStdioServer()` so we just import + invoke it. Spawning a
  // second Node process here is wasted memory/latency (LLM clients already
  // spawn `ccgauge mcp` per conversation), and forwarding signals across
  // processes is brittle (e.g. SIGHUP isn't covered by the old shim).
  //
  // CRITICAL: `runStdioServer()` resolves as soon as
  // `server.connect(transport)` finishes the JSON-RPC handshake setup —
  // the long-running stdio listener is what holds the process alive
  // afterwards. We must NOT call `process.exit(0)` after the await
  // returns, or we'd kill the process before any client `initialize`
  // can land. The dist/mcp/server.mjs direct-entry path gets this right
  // (entry.ts uses `.catch()` only); the CLI in-process wrapper used to
  // exit here too — a regression introduced when we moved off the
  // spawn-a-child design. Don't reintroduce.
  try {
    const mod = await import(pathToFileURL(bundle).href);
    if (typeof mod.runStdioServer !== 'function') {
      console.error('[ccgauge-mcp] error: bundle missing runStdioServer export');
      process.exit(1);
    }
    await mod.runStdioServer();
    // Function returned but didn't process.exit — stdin listener still
    // alive. Just let the event loop run; the transport calls
    // process.exit(0) when stdin closes (see `shutdown` in
    // lib/mcp/server.ts), which is the LLM client disconnecting.
  } catch (err) {
    console.error('[ccgauge-mcp] error: failed to start:', err?.message ?? err);
    process.exit(1);
  }
}

/** `ccgauge doctor` — print everything we'd ask the user to gather when
 *  debugging a "why doesn't it work" report, in one place:
 *  - version / platform
 *  - env vars that influence ccgauge behaviour
 *  - on-disk build artifacts (each can be rebuilt independently)
 *  - background service state (if any)
 *  - delegated MCP `--check` for indexer + per-provider scan stats
 *  Output is plain text (no colour) so it's easy to paste into a GitHub
 *  issue. */
async function doctor() {
  const lines = [];
  lines.push(`ccgauge:  v${pkg.version ?? '?'}`);
  lines.push(`node:     ${process.version}  ${process.platform}/${process.arch}`);
  lines.push(`cwd:      ${process.cwd()}`);
  lines.push(`stateDir: ${STATE_DIR}`);
  lines.push('');

  const envKeys = [
    'CCGAUGE_CONFIG_DIR',
    'CCGAUGE_CODEX_DIR',
    'CCGAUGE_STATE_DIR',
    'CCGAUGE_MCP_PRETTY',
    'CCGAUGE_POLL_FALLBACK',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'NO_COLOR',
    'FORCE_COLOR',
  ];
  const setEnvs = envKeys.filter((k) => process.env[k] !== undefined);
  if (setEnvs.length > 0) {
    lines.push('environment:');
    for (const k of setEnvs) lines.push(`  ${k}=${process.env[k]}`);
    lines.push('');
  } else {
    lines.push('environment: (no ccgauge / NO_COLOR vars set)');
    lines.push('');
  }

  const artifacts = [
    ['Dashboard',     join(packageRoot, '.next', 'standalone', 'server.js'), 'pnpm build'],
    ['MCP bundle',    join(packageRoot, 'dist', 'mcp', 'server.mjs'),         'pnpm build:mcp'],
    ['Report bundle', join(packageRoot, 'dist', 'report', 'index.mjs'),       'pnpm build:report'],
  ];
  lines.push('artifacts:');
  for (const [label, p, cmd] of artifacts) {
    const ok = existsSync(p);
    const status = ok ? 'OK     ' : 'MISSING';
    const hint = ok ? '' : `  (build with \`${cmd}\`)`;
    lines.push(`  ${status}  ${label.padEnd(14)} ${p}${hint}`);
  }
  lines.push('');

  const st = await readState();
  if (st) {
    const running = isProcessRunning(st.pid, st);
    lines.push(`background: pid=${st.pid} ${running ? '(running)' : '(stale)'} port=${st.port} url=${st.url}`);
    lines.push(`            log=${st.logFile}`);
  } else {
    lines.push(`background: (none)`);
  }
  lines.push('');

  // Print everything we've accumulated so the indexer probe's output
  // appears below it (printCheck writes to stdout synchronously).
  for (const l of lines) console.log(l);

  // Delegate to the MCP bundle's printCheck() for indexer / providers
  // detail — same info `ccgauge mcp --check` shows, in the same format.
  const mcpBundle = join(packageRoot, 'dist', 'mcp', 'server.mjs');
  if (!existsSync(mcpBundle)) {
    console.log('indexer:  (MCP bundle missing; rebuild to run the indexer probe)');
    process.exit(0);
  }
  try {
    const mod = await import(pathToFileURL(mcpBundle).href);
    if (typeof mod.printCheck === 'function') {
      const code = await mod.printCheck();
      // Doctor exit code mirrors the indexer probe: 0 on success, non-0
      // otherwise. Anything that printCheck couldn't decide we treat as
      // success — doctor is a diagnostic tool, not a gate.
      process.exit(typeof code === 'number' ? code : 0);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[ccgauge] error: indexer probe failed: ${err?.message ?? err}`);
    process.exit(1);
  }
}

async function resolvePort(opts) {
  const preferred = parseInt(String(opts.port), 10);
  if (!Number.isInteger(preferred) || preferred <= 0 || preferred > 65535) {
    throw new Error(`invalid port: ${opts.port}`);
  }
  // Try the preferred port first, then up to 19 ports above it (capped at
  // 65535), then 0 (let the OS pick an ephemeral port). For unusually high
  // preferred values (e.g. 65530) the +N candidates are clamped by the
  // filter, leaving just the preferred + ephemeral fallback — that's still
  // correct, just narrower.
  const candidates = opts.strictPort
    ? preferred
    : [preferred, ...Array.from({ length: 19 }, (_, i) => preferred + i + 1).filter((p) => p <= 65535), 0];
  const getPort = await loadGetPort();
  const port = await getPort({ port: candidates });
  if (opts.strictPort && port !== preferred) {
    throw new Error(`port ${preferred} is already in use`);
  }
  return port;
}

function makeServerEnv(opts, port) {
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: opts.host,
    NODE_ENV: 'production',
  };
  if (opts.dir) {
    env.CCGAUGE_CONFIG_DIR = String(opts.dir);
  }
  return env;
}

/** Read the last `lines` non-empty lines of a log file. Used as a hint
 *  in error messages when the spawned background server fails to come
 *  up — the actual root cause (port conflict, parse error, etc.) is in
 *  the log file and we'd rather not make the user go fishing for it. */
async function tailLog(logFile, lines = 5) {
  try {
    const content = await readFile(logFile, 'utf8');
    const all = content.split(/\r?\n/);
    return all.filter((l) => l.length > 0).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function waitForUrl(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target, {
        method: 'HEAD',
        signal: AbortSignal.timeout(500),
      });
      if (res.status < 500) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr ?? new Error('server did not start in time');
}

async function tryOpen(url) {
  try {
    const openBrowser = await loadOpenBrowser();
    await openBrowser(url);
  } catch {
    // ignore — user may be on remote without a browser
  }
}

/** Build a small palette of ANSI escapes that collapse to '' when colour
 *  is off, so the same template literal works for both modes without an
 *  if/else per line. */
function ansiPalette(useColor) {
  const seq = (...codes) => (useColor ? `\x1b[${codes.join(';')}m` : '');
  return {
    bold: seq(1),
    cyan: seq(36),
    dim: seq(2),
    brand: seq(38, 2, 201, 100, 66),
    reset: useColor ? '\x1b[0m' : '',
  };
}

function printReady(url, opts = {}) {
  const c = ansiPalette(shouldUseColor());
  const banner = [
    '',
    `  ${c.bold}${c.brand}ccgauge${c.reset}  Local Usage Dashboard`,
    '',
    `   ➜  Local:   ${c.cyan}${url}${c.reset}`,
    opts.background
      ? `   ➜  PID:     ${c.dim}${opts.pid}${c.reset}`
      : `   ➜  Press ${c.dim}Ctrl+C${c.reset} to stop`,
    opts.background
      ? `   ➜  Log:     ${c.dim}${opts.logFile}${c.reset}`
      : '',
    opts.background
      ? `   ➜  Stop:    ${c.dim}ccgauge stop${c.reset}`
      : '',
    '',
  ].filter(Boolean).join('\n');
  process.stdout.write(banner + '\n');
}

function printAlreadyRunning(state) {
  console.log([
    'ccgauge is already running',
    `URL: ${state.url}`,
    `PID: ${state.pid}`,
    `Stop: ccgauge stop`,
  ].join('\n'));
}

async function ensureStateDir() {
  await mkdir(STATE_DIR, { recursive: true });
}

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // Treat unknown / future versions as stale (auto-clean on next stop/start).
    if (parsed.version !== STATE_VERSION) return null;
    // Type-guard the fields callers actually use — `stop`, `status`, and
    // `restart` all assume these have the right shape. A hand-edited
    // state.json with the right `version` but garbage in `pid` could
    // otherwise crash `safeKill()` or `isProcessRunning()`.
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    if (typeof parsed.url !== 'string' || !parsed.url) return null;
    if (typeof parsed.logFile !== 'string' || !parsed.logFile) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeState(state) {
  await ensureStateDir();
  const payload = { version: STATE_VERSION, ...state };
  await writeFile(STATE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function removeState() {
  await rm(STATE_FILE, { force: true });
}

/** Best-effort approximation of system boot time, in ms since the epoch.
 *  Used as a `bootId` on persisted state so we can reject stale PIDs
 *  after a reboot (PID space gets recycled and would otherwise let us
 *  SIGTERM an unrelated process that happens to inherit the old PID). */
function bootId() {
  return Math.floor(Date.now() - os.uptime() * 1000);
}

/** Optional identity check on top of the existing `process.kill(pid, 0)`.
 *  Pass `state` to additionally verify:
 *  1. We're still on the same boot (uptime hasn't reset).
 *  2. `ps -p <pid> -o command=` mentions `state.cmdMarker` — i.e. that
 *     pid actually points at *our* dashboard child and not some other
 *     process that re-inherited the PID.
 *  Failures of (2) are tolerated (`ps` missing, sandboxed exec, etc.)
 *  so we don't false-negative on minimal containers. */
function isProcessRunning(pid, state) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!state) return true;
  // Reboot detection: bootId drifts by tens of ms across reads on the
  // same boot (os.uptime() has float jitter), so use a generous window.
  if (typeof state.bootId === 'number') {
    if (Math.abs(bootId() - state.bootId) > 60_000) return false;
  }
  if (process.platform !== 'win32' && typeof state.cmdMarker === 'string' && state.cmdMarker) {
    try {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1_000,
      });
      if (!out.includes(state.cmdMarker)) return false;
    } catch {
      // `ps` not available or PID gone between kill(0) and exec — fall
      // back to the kill(0) result we already have. We deliberately do
      // NOT fail closed here: a missing `ps` is more common than a PID
      // collision (PID reuse requires a reboot or wraparound), so the
      // false-negative cost of "treat as not-running" outweighs the
      // false-positive of "treat as running".
    }
  }
  return true;
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isProcessRunning(pid);
}

async function followLog(logFile, offset) {
  let cursor = offset;
  let busy = false;
  console.log('[ccgauge] following logs; press Ctrl+C to stop');
  await new Promise((resolveFollow) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearInterval(id);
      resolveFollow();
    };
    const id = setInterval(async () => {
      if (busy || done) return;
      busy = true;
      try {
        const s = await stat(logFile);
        if (s.size < cursor) cursor = 0; // log was truncated / rotated
        if (s.size === cursor) return;
        // Pin the upper bound to the size we saw in stat() — otherwise a
        // chunk written *after* stat returns would slip into this read,
        // and the next tick (which starts at `s.size`) would replay it.
        // `end` is inclusive, hence the -1.
        const endAt = s.size - 1;
        await new Promise((res, rej) => {
          const stream = createReadStream(logFile, {
            start: cursor,
            end: endAt,
            encoding: 'utf8',
          });
          stream.on('data', (chunk) => process.stdout.write(chunk));
          stream.on('end', () => {
            cursor = s.size;
            res();
          });
          stream.on('error', rej);
        });
      } catch {
        // keep following unless interrupted
      } finally {
        busy = false;
      }
    }, 1000);
    process.on('SIGINT', cleanup);
  });
}
