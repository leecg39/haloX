import { serveMcp } from '@/lib/api/mcp-http';
export async function POST(request: Request, context: { params: Promise<{ tool: string }> }) { return serveMcp(request, { tool: (await context.params).tool }); }
