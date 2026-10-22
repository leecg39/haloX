import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_USER_ID,
  haloxDb,
  QuotaExceededError,
  RlsAccessDeniedError,
  type Row,
} from '@/lib/backend/database';

function resolveUserId(req: NextRequest): string {
  return req.headers.get('x-halox-user-id') || DEFAULT_USER_ID;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ table: string }> }
) {
  const { table } = await context.params;
  const userId = resolveUserId(req);
  const url = new URL(req.url);
  const filters: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    filters[key] = value;
  });

  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const orderParam = url.searchParams.get('order') || undefined;
  const selectParam = url.searchParams.get('select') || undefined;

  const { data, count } = haloxDb.queryTable(
    table,
    {
      select: selectParam,
      filters,
      order: orderParam,
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    },
    userId
  );

  return NextResponse.json(data, {
    status: 200,
    headers: {
      'Content-Range': `0-${Math.max(0, data.length - 1)}/${count}`,
    },
  });
}

export async function HEAD(
  req: NextRequest,
  context: { params: Promise<{ table: string }> }
) {
  const { table } = await context.params;
  const userId = resolveUserId(req);
  const url = new URL(req.url);
  const filters: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    filters[key] = value;
  });

  const { count } = haloxDb.queryTable(
    table,
    { filters, headOnly: true },
    userId
  );

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Range': `*/${count}`,
    },
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ table: string }> }
) {
  const { table } = await context.params;
  const userId = resolveUserId(req);
  try {
    const body = (await req.json()) as Row | Row[];
    const inserted = haloxDb.insertTable(table, body, userId);
    return NextResponse.json(inserted, { status: 201 });
  } catch (error) {
    if (error instanceof RlsAccessDeniedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    if (error instanceof QuotaExceededError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid request payload' },
      { status: 400 }
    );
  }
}
