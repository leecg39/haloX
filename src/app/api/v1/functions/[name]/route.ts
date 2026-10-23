import { NextRequest, NextResponse } from 'next/server';
import { serveMcp } from '@/lib/api/mcp-http';
import { TRANSLATION_COMMANDS, runTranslationCommand } from '@/lib/backend/translation-service';
import { ExternalServiceError } from '@/lib/backend/public-json';
import { WORDPRESS_COMMANDS, runWordPressCommand } from '@/lib/backend/wordpress-service';
import { ContentConflictError } from '@/lib/backend/content-model';
import { authenticate, type AuthResult } from '@/lib/api/route-auth';
import {
  QuotaExceededError,
  RlsAccessDeniedError,
} from '@/lib/backend/database';
import { haloxStore, StorageUnavailableError } from '@/lib/backend/store';

export function formatAgentChatSseStream(result: Record<string, unknown>): string {
  const chunks = Array.isArray(result.chunks) ? result.chunks.map(String) : [];
  const lines: string[] = [];
  lines.push(
    `event: meta\ndata: ${JSON.stringify({
      conversation: result.conversation,
      user_message: result.user_message,
    })}\n\n`
  );
  for (const delta of chunks) {
    lines.push(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
  }
  lines.push(
    `event: message\ndata: ${JSON.stringify({
      assistant_message: result.assistant_message,
    })}\n\n`
  );
  lines.push('event: done\ndata: [DONE]\n\n');
  return lines.join('');
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params;
  if (name === 'halox-mcp') return serveMcp(req, { legacy: true });
  const auth: AuthResult = await authenticate(req);
  if (auth.response) return auth.response;
  const userId = auth.actor;

  try {
    let payload: Record<string, unknown> = {};
    const text = await req.text();
    if (text.trim()) {
      payload = JSON.parse(text) as Record<string, unknown>;
    }


    const result = TRANSLATION_COMMANDS.includes(name) ? await runTranslationCommand(haloxStore, name, payload, userId) : WORDPRESS_COMMANDS.includes(name) ? await runWordPressCommand(haloxStore, name, payload, userId) : await haloxStore.write(db => db.invokeEdgeFunction(name, payload, userId));
    if ((WORDPRESS_COMMANDS.includes(name) || TRANSLATION_COMMANDS.includes(name)) && result.ok === false) return NextResponse.json(result, { status: 502 });

    const wantsSse =
      name === 'agent-chat' &&
      (req.headers.get('accept')?.includes('text/event-stream') || payload.stream === true);

    if (wantsSse) {
      const ssePayload = formatAgentChatSseStream(result);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(ssePayload));
          controller.close();
        },
      });
      return new NextResponse(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ExternalServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ContentConflictError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    if (error instanceof RlsAccessDeniedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    if (error instanceof QuotaExceededError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Edge function failed' },
      { status: 400 }
    );
  }
}
