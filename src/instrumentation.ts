export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const runtime = globalThis as typeof globalThis & { haloxDeletionStop?: () => void; haloxScheduleStop?: () => void; haloxAuditStop?: () => void; haloxObservationStop?: () => void };
  if (!runtime.haloxDeletionStop && process.env.HALOX_DISABLE_ACCOUNT_DELETION_WORKER !== '1') {
    const { startAccountDeletionWorker } = await import('./lib/backend/account-deletion-service');
    runtime.haloxDeletionStop = startAccountDeletionWorker();
  }
  if (!runtime.haloxObservationStop && process.env.HALOX_DISABLE_OBSERVABILITY_WORKER !== '1') {
    const { startObservabilityWorker } = await import('./lib/backend/observability-worker');
    const interval = Number(process.env.HALOX_OBSERVABILITY_INTERVAL_MS || 30_000);
    runtime.haloxObservationStop = startObservabilityWorker(undefined, Number.isFinite(interval) ? interval : 30_000);
  }
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
