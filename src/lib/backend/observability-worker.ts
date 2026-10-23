import { haloxStore, type PersistentHaloXStore } from './store.ts';
export function startObservabilityWorker(store: PersistentHaloXStore = haloxStore, intervalMs = 30_000) {
  let busy = false, stopped = false;
  async function tick() {
    if (busy || stopped) return; busy = true;
    try { const now = Date.now(); if (await store.read(db => db.hasDueObservability(now)) && !stopped) await store.write(db => db.runDueObservability(now)); }
    catch { console.error('HaloX: 감시·리포트 예약 처리에 실패했습니다. 다음 주기에 재시도합니다.'); }
    finally { busy = false; }
  }
  const timer = setInterval(() => { void tick(); }, Math.max(1000, intervalMs)); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
