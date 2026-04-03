import { NextRequest, NextResponse } from 'next/server';
import { vmManager } from '@/lib/vms/manager';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const username = getCurrentUser();
    const { modelId } = await params;
    const status = await vmManager.getStatus(username, modelId);
    return NextResponse.json({ status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ modelId: string }> }) {
  try {
    const username = getCurrentUser();
    const { modelId } = await params;
    const body = await req.json();
    if (body.action === 'start') {
      await vmManager.startVm(username, modelId);
      return NextResponse.json({ status: await vmManager.getStatus(username, modelId) });
    } else if (body.action === 'stop') {
      await vmManager.stopVm(username, modelId);
      return NextResponse.json({ status: await vmManager.getStatus(username, modelId) });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
