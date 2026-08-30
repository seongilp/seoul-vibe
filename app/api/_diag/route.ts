import { NextResponse } from 'next/server';

/**
 * 임시 진단용 라우트. Vercel 함수 안에서 서울시 API 까지의 실제 왕복 시간을 잰다.
 * 로컬에서 재는 값과 같은 순간에 비교해서, 느린 게 업스트림인지 Vercel 네트워크인지
 * 가른다. 원인 확인이 끝나면 지운다.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const KEY = process.env.SEOUL_API_KEY ?? 'sample';

interface Probe {
  label: string;
  url: string;
}

function probes(area: string): Probe[] {
  const path = `/${encodeURIComponent(KEY)}/json/citydata_ppltn/1/5/${encodeURIComponent(area)}`;
  return [
    { label: 'http:8088', url: `http://openapi.seoul.go.kr:8088${path}` },
    { label: 'https:8088', url: `https://openapi.seoul.go.kr:8088${path}` },
    { label: 'https:443', url: `https://openapi.seoul.go.kr${path}` },
    { label: 'http:80', url: `http://openapi.seoul.go.kr${path}` },
    { label: 'ipv4:8088', url: `http://115.84.165.45:8088${path}` },
  ];
}

async function run(probe: Probe, timeoutMs: number) {
  const started = Date.now();
  try {
    const response = await fetch(probe.url, {
      // Data Cache 를 타면 네트워크를 안 재게 된다. 반드시 우회한다.
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    const ttfbMs = Date.now() - started;
    const text = await response.text();
    return {
      label: probe.label,
      ok: response.ok,
      status: response.status,
      ttfbMs,
      totalMs: Date.now() - started,
      bytes: text.length,
      // 키가 새지 않도록 본문은 앞부분만, 그것도 코드 부분만 본다.
      hint: text.slice(0, 80).replace(/\s+/g, ' '),
    };
  } catch (error) {
    return {
      label: probe.label,
      ok: false,
      status: 0,
      totalMs: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const area = url.searchParams.get('area') ?? '혜화역';
  const timeoutMs = Number(url.searchParams.get('timeout')) || 25_000;

  const results = await Promise.all(probes(area).map((probe) => run(probe, timeoutMs)));

  return NextResponse.json(
    {
      region: process.env.VERCEL_REGION ?? null,
      area,
      timeoutMs,
      at: new Date().toISOString(),
      results,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
