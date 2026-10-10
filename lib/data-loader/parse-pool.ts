import { Worker } from 'node:worker_threads';
import os from 'node:os';
import type { ProviderAdapter } from '../providers';
import type { ParsedFile } from '../providers/types';

const IDLE_TIMEOUT_MS = 10_000;
const MAX_WORKERS = 6;

interface Task {
  id: number;
  provider: ProviderAdapter;
  file: string;
  resolve: (parsed: ParsedFile) => void;
  reject: (err: unknown) => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
  completed: number;
}

type WorkerReply = { id: number; parsed: ParsedFile } | { id: number; error: string };

function workerScript(): string | null {
  return process.env.CCGAUGE_PARSE_WORKER || null;
}

function poolSize(): number {
  const raw = process.env.CCGAUGE_PARSE_WORKERS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  const cores =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1));
}

class ParsePool {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private nextId = 1;
  private disabled = false;
  private idleTimer: NodeJS.Timeout | null = null;

  parse(provider: ProviderAdapter, file: string): Promise<ParsedFile> {
    const script = workerScript();
    const size = poolSize();
    if (this.disabled || !script || size === 0) return provider.parseFile(file);
    return new Promise<ParsedFile>((resolve, reject) => {
      this.queue.push({ id: this.nextId++, provider, file, resolve, reject });
      this.pump(script, size);
    });
  }

  private pump(script: string, size: number): void {
    this.cancelIdle();
    while (this.queue.length > 0) {
      if (this.disabled) {
        for (const task of this.queue.splice(0)) this.inThread(task);
        return;
      }
      let slot: Slot | null = this.slots.find((s) => s.task === null) ?? null;
      if (!slot) {
        if (this.slots.length >= size) return;
        slot = this.spawn(script);
        if (!slot) continue;
      }
      const task = this.queue.shift()!;
      slot.task = task;
      slot.worker.ref();
      slot.worker.postMessage({ id: task.id, source: task.provider.id, file: task.file });
    }
  }

  private spawn(script: string): Slot | null {
    let worker: Worker;
    try {
      worker = new Worker(script);
    } catch {
      this.disabled = true;
      return null;
    }
    const slot: Slot = { worker, task: null, completed: 0 };
    worker.unref();
    worker.on('message', (reply: WorkerReply) => {
      const task = slot.task;
      if (!task || reply.id !== task.id) return;
      slot.task = null;
      slot.completed += 1;
      worker.unref();
      if ('error' in reply) this.inThread(task);
      else task.resolve(reply.parsed);
      this.afterTask();
    });
    worker.on('error', () => {});
    worker.on('exit', () => {
      this.slots = this.slots.filter((s) => s !== slot);
      if (slot.completed === 0) this.disabled = true;
      const task = slot.task;
      slot.task = null;
      if (task) this.inThread(task);
      this.afterTask();
    });
    this.slots.push(slot);
    return slot;
  }

  private inThread(task: Task): void {
    task.provider.parseFile(task.file).then(task.resolve, task.reject);
  }

  private afterTask(): void {
    const script = workerScript();
    if (this.queue.length > 0 && script) {
      this.pump(script, poolSize());
      return;
    }
    if (this.slots.every((s) => s.task === null)) this.scheduleIdle();
  }

  private scheduleIdle(): void {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      for (const slot of this.slots.splice(0)) {
        slot.worker.removeAllListeners('exit');
        void slot.worker.terminate();
      }
    }, IDLE_TIMEOUT_MS);
    this.idleTimer.unref();
  }

  private cancelIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

declare global {
  var __ccgaugeParsePool: ParsePool | undefined;
}

export function parseTranscript(provider: ProviderAdapter, file: string): Promise<ParsedFile> {
  if (!globalThis.__ccgaugeParsePool) globalThis.__ccgaugeParsePool = new ParsePool();
  return globalThis.__ccgaugeParsePool.parse(provider, file);
}
