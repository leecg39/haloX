'use client';
import type { RawKind } from '@/lib/api/raw-data';
export function rawEndpoint(workspace: string, kind: RawKind, params: Record<string, string> = {}) { return `/api/v1/raw-data?${new URLSearchParams({ workspace_id: workspace, kind, ...params })}`; }
export async function rawDownload(url: string) {
  const response = await fetch(url); if (!response.ok) { const error = await response.json(); throw new Error(error.error || '다운로드하지 못했습니다.'); }
  const disposition = response.headers.get('content-disposition') || '', match = disposition.match(/filename\*=UTF-8''([^;]+)/i), filename = match ? decodeURIComponent(match[1]) : 'halox-raw.zip';
  const href = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}
