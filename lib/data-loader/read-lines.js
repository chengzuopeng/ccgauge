import { createReadStream } from 'node:fs';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const CHUNK_BYTES = 1 << 20;

function withoutCarriageReturn(line) {
  return line.length > 0 && line[line.length - 1] === CARRIAGE_RETURN
    ? line.subarray(0, line.length - 1)
    : line;
}

export async function forEachLine(file, onLine, opts = {}) {
  const start = opts.start ?? 0;
  const stream = createReadStream(file, { highWaterMark: CHUNK_BYTES, start });
  let carry = [];
  let position = start;
  try {
    for await (const chunk of stream) {
      let from = 0;
      let nl = chunk.indexOf(NEWLINE, from);
      while (nl !== -1) {
        let line;
        if (carry.length > 0) {
          carry.push(chunk.subarray(from, nl));
          line = Buffer.concat(carry);
          carry = [];
        } else {
          line = chunk.subarray(from, nl);
        }
        if (onLine(withoutCarriageReturn(line), position + nl + 1, true) === false) return;
        from = nl + 1;
        nl = chunk.indexOf(NEWLINE, from);
      }
      if (from < chunk.length) carry.push(chunk.subarray(from));
      position += chunk.length;
    }
    if (carry.length > 0) onLine(withoutCarriageReturn(Buffer.concat(carry)), position, false);
  } finally {
    stream.destroy();
  }
}
