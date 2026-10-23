import { createNicePayClient, type NicePayClient } from './nicepay.ts';
import { processBillingTick } from './billing-service.ts';
import { haloxStore, type PersistentHaloXStore } from './store.ts';
export function startBillingWorker(store: PersistentHaloXStore = haloxStore, client: NicePayClient = createNicePayClient(), interval = 60_000) {
  let busy = false, stopped = false;
  const tick = async () => { if (busy || stopped) return; busy = true; try { for (let i = 0; i < 20 && await processBillingTick(store, client); i++); } catch { console.error('HaloX: 정기결제 상태를 확인하지 못했습니다. 다음 주기에 다시 확인합니다.'); } finally { busy = false; } };
  const timer = setInterval(() => { void tick(); }, Math.max(10_000, interval)); timer.unref(); void tick();
  return () => { stopped = true; clearInterval(timer); };
}
