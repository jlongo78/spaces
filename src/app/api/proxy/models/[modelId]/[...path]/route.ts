import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import { vmManager } from '@/lib/vms/manager';

// Ensure the proxy doesn't timeout within Next.js (maxDuration requires a paid Vercel plan but works locally)
export const maxDuration = 300; 

export async function POST(req: NextRequest, { params }: { params: Promise<{ modelId: string; path: string[] }> }) {
  return handleProxy(req, await params);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ modelId: string; path: string[] }> }) {
  return handleProxy(req, await params);
}

async function handleProxy(req: NextRequest, params: { modelId: string; path: string[] }) {
  try {
    const username = getCurrentUser();
    const config = readConfig(username);
    const model = config.customModels?.find(m => m.id === params.modelId);

    if (!model) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    if (model.provider === 'gcp') {
      try {
        await vmManager.startVm(username, model.id);
      } catch (e: any) {
        return NextResponse.json({ error: `Failed to start VM: ${e.message}` }, { status: 500 });
      }
    }

    const pathSuffix = params.path.join('/');
    const targetUrl = new URL(`${model.apiUrl}/${pathSuffix}`);

    // Copy search params if any
    const incomingUrl = new URL(req.url);
    incomingUrl.searchParams.forEach((v, k) => targetUrl.searchParams.append(k, v));

    const headers = new Headers();
    req.headers.forEach((v, k) => {
      // Avoid passing host and connection headers from proxying layer
      if (!['host', 'connection', 'content-length'].includes(k.toLowerCase())) {
        headers.set(k, v);
      }
    });

    if (model.apiKey) {
      headers.set('Authorization', `Bearer ${model.apiKey}`);
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      redirect: 'manual',
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = req.body; // Use streaming body
      // @ts-ignore
      fetchOptions.duplex = 'half'; // Required in Node.js 18+ for streaming request bodies
    }

    const res = await fetch(targetUrl.toString(), fetchOptions);
    
    // Convert fetch response to NextResponse
    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete('content-encoding'); // Let Next.js handle encoding

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error('[Proxy Error]', err);
    return NextResponse.json({ error: 'Internal proxy error', details: err.message }, { status: 500 });
  }
}