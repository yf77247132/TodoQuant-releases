import type { OrdersCacheManager } from '../../services/ordersCache.ts';
import type { SavingsPoller } from '../../services/savingsPoller.ts';
import type { OKXWebSocketManager } from '../../bootstrap/ws/wsManager.ts';

export interface ApiRoutesConfig {
  ordersCache: OrdersCacheManager;
  savingsPoller: SavingsPoller;
  wsManager: OKXWebSocketManager;
  startAccountMonitoring: () => Promise<void>;
}
