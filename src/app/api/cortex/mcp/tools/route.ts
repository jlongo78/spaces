import { NextResponse } from 'next/server';
import { getCortexTools } from '@/lib/cortex/mcp/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getCortexTools());
}
