import { haloxStore, type PersistentHaloXStore } from './store.ts';

export function startGeoScheduler(store: PersistentHaloXStore = haloxStore, intervalMs = 30_000) {
  let busy = false;
  let stopped = false;
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const now = Date.now();
      const anyDue = await store.read(db => db.hasDueGeoSchedules(now));
      if (anyDue && !stopped) await store.write(db => db.runDueGeoSchedules(now));
    } catch {
      // Keep the worker alive and retry storage failures; never log provider payloads or secrets.
      console.error('HaloX: 예약 실행 저장소를 확인하지 못했습니다. 다음 주기에 다시 시도합니다.');
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void tick(); }, Math.max(1000, intervalMs));
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
