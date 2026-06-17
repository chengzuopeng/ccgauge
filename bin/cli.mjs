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

function shouldOpenBrowser(opts) {
  if (opts.background) return false;
  return opts.open !== false;
}

async function inheritFromState(opts, cmd) {
  const prev = await readState();
  if (!prev) return { ...opts };
  const isDefault = (key) => cmd.getOptionValueSource(key) === 'default';

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
    .option('--no-breakdown', 'skip the breakdown table')
    .option('-d, --dashboard', 'rich one-screen TUI layout (KPI tiles, stacked trend, double-column breakdown, heatmap)')
    .option('--width <n>', 'force output width (chars); default reads process.stdout.columns')
    .option('--no-banner', 'dashboard: skip the top banner row')
    .option('--compact', 'dashboard: skip the trend chart to save vertical space');
}

addReportOptions(program.command('report').description('print a formatted usage report to stdout'))
  .action(async (opts) => {
    await report(opts);
  });

await program.parseAsync(normalizeArgv(process.argv));

function normalizeArgv(argv) {
  const args = argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.includes('-V') || args.includes('--version')) {
    return argv;
  }

  if (args.length > 0 && COMMAND_NAMES.has(args[0])) return argv;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if (!arg.startsWith('-')) {

      return argv;
    }

    const eqIdx = arg.indexOf('=');
    const flag = eqIdx >= 0 ? arg.slice(0, eqIdx) : arg;
    if (!START_OPTIONS.has(flag)) return argv;

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

  function forward(signal) {
    return () => {
      if (!child.killed) child.kill(signal);

    };
  }
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  process.on('exit', () => {
    if (!child.killed) child.kill('SIGTERM');
  });

  child.on('exit', (code, signal) => {

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

    windowsHide: true,
  });
  child.unref();

  try { closeSync(out); } catch {  }
  try { closeSync(err); } catch {  }

  const url = buildUrl(opts.host, port);
  try {
    await waitForUrl(url, 15_000);
  } catch (startErr) {
    if (isProcessRunning(child.pid)) {
      safeKill(child.pid, 'SIGTERM');
      const exited = await waitForProcessExit(child.pid, 2_000);
      if (!exited) safeKill(child.pid, 'SIGKILL');
    }

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
  const width = opts.width ? parseInt(String(opts.width), 10) : undefined;
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
    dashboard: Boolean(opts.dashboard),
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    banner: opts.banner !== false,
    compact: Boolean(opts.compact),
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

  if (opts.check) {
    const mod = await import(pathToFileURL(bundle).href);
    if (typeof mod.printCheck !== 'function') {
      console.error('[ccgauge-mcp] error: this bundle was built without --check support');
      process.exit(1);
    }
    const code = await mod.printCheck();
    process.exit(typeof code === 'number' ? code : 0);
  }

  try {
    const mod = await import(pathToFileURL(bundle).href);
    if (typeof mod.runStdioServer !== 'function') {
      console.error('[ccgauge-mcp] error: bundle missing runStdioServer export');
      process.exit(1);
    }
    await mod.runStdioServer();

  } catch (err) {
    console.error('[ccgauge-mcp] error: failed to start:', err?.message ?? err);
    process.exit(1);
  }
}

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

  for (const l of lines) console.log(l);

  const mcpBundle = join(packageRoot, 'dist', 'mcp', 'server.mjs');
  if (!existsSync(mcpBundle)) {
    console.log('indexer:  (MCP bundle missing; rebuild to run the indexer probe)');
    process.exit(0);
  }
  try {
    const mod = await import(pathToFileURL(mcpBundle).href);
    if (typeof mod.printCheck === 'function') {
      const code = await mod.printCheck();

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

  }
}

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

    if (parsed.version !== STATE_VERSION) return null;

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

function bootId() {
  return Math.floor(Date.now() - os.uptime() * 1000);
}

function isProcessRunning(pid, state) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!state) return true;

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
        if (s.size < cursor) cursor = 0;
        if (s.size === cursor) return;

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

      } finally {
        busy = false;
      }
    }, 1000);
    process.on('SIGINT', cleanup);
  });
}
