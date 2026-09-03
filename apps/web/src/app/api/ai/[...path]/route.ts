import { NextRequest, NextResponse } from 'next/server';

const API = process.env.API_PROXY_TARGET || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

async function proxy(req: NextRequest, pathSegments: string[]) {
  const suffix = pathSegments.map((segment) => encodeURIComponent(segment)).join('/');
  const url = `${API}/api/ai/${suffix}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  const res = await fetch(url, init);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(req, path);
}
