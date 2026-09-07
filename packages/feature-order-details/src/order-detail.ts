// The `order_details` topic row shape -- all 23 fields (CLIENT.md schema).
// 17 static (set at seed, never change) + 6 ticking (~2,500 rows/sec across
// the topic, CLIENT.md). Mirrors `@amps-ui/feature-orders`'s `order.ts`.
export interface OrderDetail {
  // -- static (17) --
  readonly detailId: string;
  readonly orderId: string;
  readonly seq: number;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly execId: string;
  readonly executionTime: string;
  readonly venue: string;
  readonly counterparty: string;
  readonly lastQty: number;
  readonly lastPx: number;
  readonly cumQty: number;
  readonly leavesQty: number;
  readonly commission: number;
  readonly fees: number;
  readonly currency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  readonly status: 'FILLED' | 'PARTIAL' | 'PENDING';
  // -- ticking (6), CLIENT.md: "updated ~2,500 rows/sec" --
  readonly markPrice: number;
  readonly marketValue: number;
  readonly unrealizedPnl: number;
  readonly dayPnl: number;
  readonly lastUpdated: string;
  readonly tickSeq: number;
}
