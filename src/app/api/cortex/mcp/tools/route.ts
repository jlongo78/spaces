import { NextResponse } from 'next/server';
import { CORTEX_TOOLS } from '@/lib/cortex/mcp/server';

export async function GET() {
  return NextResponse.json(CORTEX_TOOLS);
}
