import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function POST(request: NextRequest) {
  const { name, args } = await request.json();
  const cortex = await getCortex();
  const result = await handleToolCall(name, args || {}, cortex);
  return NextResponse.json(result);
}
