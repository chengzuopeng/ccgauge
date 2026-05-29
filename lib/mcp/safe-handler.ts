import { sanitizeForUser } from '@/lib/sanitize';

export function safeMcpHandler<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof Error) {

        const scrubbed = sanitizeForUser(err.message);
        if (scrubbed !== err.message) err.message = scrubbed;
        throw err;
      }

      throw new Error(sanitizeForUser(String(err)));
    }
  };
}
