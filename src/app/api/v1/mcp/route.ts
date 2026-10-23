import { serveMcp, rejectMcpStream } from '@/lib/api/mcp-http';
export async function POST(request: Request) { return serveMcp(request); }
// Stateless JSON responses; no server-initiated event stream or session deletion.
export async function GET(request: Request) { return rejectMcpStream(request); }
export async function DELETE(request: Request) { return rejectMcpStream(request); }
