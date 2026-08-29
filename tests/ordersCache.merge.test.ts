import assert from "node:assert/strict";
import test from "node:test";

import { OrdersCacheManager } from "../src/services/ordersCache.ts";
import type { AccountOrder } from "../src/types/monitorTypes.ts";

function order(data: Partial<AccountOrder>): AccountOrder {
  return data as AccountOrder;
}

test("OrdersCacheManager merges updates with same ordId", () => {
  const cache = new OrdersCacheManager({ wss: {} as never });
  const accountIdx = 0;

  cache.updateOrder(
    accountIdx,
    order({
      ordId: "1001",
      instId: "BTC-USDT-SWAP",
      px: "100",
      state: "live",
    }),
  );

  cache.updateOrder(
    accountIdx,
    order({
      ordId: "1001",
      sz: "2",
    }),
  );

  const orders = cache.get(accountIdx).data;
  assert.equal(orders.length, 1);
  assert.equal((orders[0] as { px?: string }).px, "100");
  assert.equal((orders[0] as { sz?: string }).sz, "2");
});

test("OrdersCacheManager supports algoId identity and remove semantics", () => {
  const cache = new OrdersCacheManager({ wss: {} as never });
  const accountIdx = 1;

  cache.updateOrder(
    accountIdx,
    order({
      algoId: "algo-1",
      instId: "ETH-USDT-SWAP",
      state: "effective",
    }),
  );
  cache.updateOrder(
    accountIdx,
    order({
      ordId: "plain-1",
      instId: "ETH-USDT-SWAP",
      state: "live",
    }),
  );

  assert.equal(cache.get(accountIdx).data.length, 2);
  assert.equal(cache.getAll().length, 2);

  cache.removeOrder(accountIdx, "algo-1");
  assert.equal(cache.get(accountIdx).data.length, 1);
  assert.equal((cache.get(accountIdx).data[0] as { ordId?: string }).ordId, "plain-1");

  cache.removeOrder(accountIdx, "plain-1");
  assert.equal(cache.get(accountIdx).data.length, 0);
});
