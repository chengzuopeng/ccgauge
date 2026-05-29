
const PRETTY = process.env.CCGAUGE_MCP_PRETTY === '1';

export function asTextResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: PRETTY ? JSON.stringify(payload, null, 2) : JSON.stringify(payload),
      },
    ],
  };
}
