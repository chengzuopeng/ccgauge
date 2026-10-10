import { parentPort } from 'node:worker_threads';
import { PROVIDERS } from '../providers';
import type { ProviderId } from '../providers';

interface ParseRequest {
  id: number;
  source: ProviderId;
  file: string;
}

parentPort?.on('message', async (msg: ParseRequest) => {
  try {
    const parsed = await PROVIDERS[msg.source].parseFile(msg.file);
    parentPort!.postMessage({ id: msg.id, parsed });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: (err as Error).message ?? String(err) });
  }
});
