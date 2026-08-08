import { NextResponse } from 'next/server';
import { withApiErrorHandling, badRequest } from '@/lib/api/error-handler';
import { parseTurnFilters, loadTurnScope } from '@/lib/api/turn-scope';

/**
 * /api/turns/children — the individual API calls behind one turn row.
 *
 * Split out of /api/turns because it dwarfs everything else there: the calls
 * were 99.5% of that payload (9.29MB vs 43KB without them) yet are only ever
 * looked at when someone expands a row. Takes the same filter params, so the
 * turn list it derives from is the identical cached one.
 *
 * Paginated because one turn can hold thousands of calls (3498 observed), which
 * is both a multi-megabyte response and, unbounded, a multi-second render.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const CHILDREN_PAGE_SIZE = 200;
const MAX_LIMIT = 1000;

export const GET = withApiErrorHandling(async (req: Request) => {
  const sp = new URL(req.url).searchParams;

  const turnId = sp.get('turnId');
  if (!turnId) return badRequest('turnId is required', 'missing_turn_id');

  const parsed = await parseTurnFilters(sp);
  if ('error' in parsed) return parsed.error;

  const offset = Math.max(0, Number(sp.get('offset')) || 0);
  const limitRaw = Number(sp.get('limit'));
  const limit = Math.min(
    MAX_LIMIT,
    Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : CHILDREN_PAGE_SIZE,
  );

  const { allTurns } = await loadTurnScope(parsed.filters);
  const turn = allTurns.find((t) => t.turnId === turnId);
  // Not an error: the turn can legitimately vanish between the list render and
  // the expand click (a re-index dropped it, or the filters moved on).
  if (!turn) {
    return NextResponse.json({ turnId, children: [], total: 0, offset: 0 });
  }

  return NextResponse.json({
    turnId,
    children: turn.children.slice(offset, offset + limit),
    total: turn.children.length,
    offset,
  });
});
