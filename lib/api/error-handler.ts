import { NextResponse } from 'next/server';
import os from 'node:os';

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response> | Response;

interface ApiError {
  error: string;
  message: string;

  code?: string;
}

const HOME = os.homedir();

function sanitizeMessage(msg: string): string {
  if (!HOME) return msg;
  const escaped = HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return msg.replace(new RegExp(escaped, 'g'), '~');
}

export function withApiErrorHandling<T extends RouteHandler>(handler: T): T {
  const wrapped = async (req: Request, ctx?: unknown): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      const e = err as Error;
      const stack = e.stack || e.message || String(e);

      console.error('[ccgauge:api] handler threw', stack);
      const body: ApiError = {
        error: 'internal_error',
        message: sanitizeMessage(e.message || 'unexpected server error'),
      };
      return NextResponse.json(body, { status: 500 });
    }
  };
  return wrapped as T;
}

export function badRequest(message: string, code = 'bad_request'): Response {
  const body: ApiError = {
    error: 'bad_request',
    code,
    message: sanitizeMessage(message),
  };
  return NextResponse.json(body, { status: 400 });
}
