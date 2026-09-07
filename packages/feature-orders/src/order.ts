// The `orders` topic row shape -- all 24 fields (CLIENT.md schema). Static:
// written once at seed, never updated (unlike `order_details`, so no
// tick-handling machinery is needed anywhere in this package).
export interface Order {
  readonly orderId: string;
  readonly orderDate: string;
  readonly symbol: string;
  readonly instrumentName: string;
  readonly assetClass: 'EQUITY' | 'RATES' | 'FX' | 'COMMOD';
  readonly exchange: string;
  readonly side: 'BUY' | 'SELL';
  readonly orderType: 'LIMIT' | 'MARKET' | 'STOP' | 'STOP_LIMIT';
  readonly tif: 'DAY' | 'GTC' | 'IOC' | 'FOK';
  readonly quantity: number;
  readonly limitPrice: number;
  readonly filledQty: number;
  readonly avgFillPrice: number;
  readonly status: 'NEW' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
  readonly currency: 'USD' | 'EUR' | 'GBP' | 'JPY';
  readonly notional: number;
  readonly trader: string;
  readonly desk: string;
  readonly book: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly settlementDate: string;
  /** Rows this order owns in `order_details` -- the exact basis for `projectDetailRowCount()`. */
  readonly childCount: number;
  readonly createdAt: string;
}
