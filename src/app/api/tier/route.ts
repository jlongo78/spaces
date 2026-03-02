import { NextResponse } from 'next/server';
import { getTierFlags } from '@/lib/tier';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(getTierFlags());
}
