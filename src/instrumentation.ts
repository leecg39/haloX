export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build' || process.env.HALOX_DISABLE_SCHEDULER === '1') return;
  const runtime = globalThis as typeof globalThis & { haloxScheduleStop?: () => void };
  if (!runtime.haloxScheduleStop) {
    const { startGeoScheduler } = await import('./lib/backend/geo-scheduler');
    const interval = Number(process.env.HALOX_SCHEDULER_INTERVAL_MS || 30_000);
    runtime.haloxScheduleStop = startGeoScheduler(undefined, Number.isFinite(interval) ? interval : 30_000);
  }
}
