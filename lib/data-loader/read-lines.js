import { createReadStream } from 'node:fs';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const CHUNK_BYTES = 1 << 20;

function withoutCarriageReturn(line) {
  return line.length > 0 && line[line.length - 1] === CARRIAGE_RETURN
    ? line.subarray(0, line.length - 1)
    : line;
}

export async function forEachLine(file, onLine) {
  const stream = createReadStream(file, { highWaterMark: CHUNK_BYTES });
  let carry = [];
  try {
    for await (const chunk of stream) {
      let start = 0;
      let nl = chunk.indexOf(NEWLINE, start);
      while (nl !== -1) {
        let line;
        if (carry.length > 0) {
          carry.push(chunk.subarray(start, nl));
          line = Buffer.concat(carry);
          carry = [];
        } else {
          line = chunk.subarray(start, nl);
        }
        if (onLine(withoutCarriageReturn(line)) === false) return;
        start = nl + 1;
        nl = chunk.indexOf(NEWLINE, start);
      }
      if (start < chunk.length) carry.push(chunk.subarray(start));
    }
    if (carry.length > 0) onLine(withoutCarriageReturn(Buffer.concat(carry)));
  } finally {
    stream.destroy();
  }
}
