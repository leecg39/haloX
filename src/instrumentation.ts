export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const runtime = globalThis as typeof globalThis & { haloxScheduleStop?: () => void; haloxAuditStop?: () => void };
  if (!runtime.haloxAuditStop && process.env.HALOX_DISABLE_AUDIT_WORKER !== '1') {
    const { startAuditWorker } = await import('./lib/backend/site-audit-worker');
    runtime.haloxAuditStop = startAuditWorker();
  }
  if (!runtime.haloxScheduleStop && process.env.HALOX_DISABLE_SCHEDULER !== '1') {
    const { startGeoScheduler } = await import('./lib/backend/geo-scheduler');
    const interval = Number(process.env.HALOX_SCHEDULER_INTERVAL_MS || 30_000);
    runtime.haloxScheduleStop = startGeoScheduler(undefined, Number.isFinite(interval) ? interval : 30_000);
  }
}
