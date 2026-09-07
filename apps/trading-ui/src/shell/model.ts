// The flexlayout-react model for the tab shell (plan §5, amended).
//
// One row, one tabset, two tabs at startup: "Orders" and "Order Details".
// Every tab carries a `TabConfig` -- `{ kind, instanceId }` -- and the plan's
// invariant is exact identity, not just a naming convention: "one tab = one
// grid instance = one `subId` in the worker. The mapping is exactly
// `subId === instanceId`". This module also sets the flexlayout tab node's
// own `id` to `instanceId` (the plan doesn't require this, but it means
// `Actions.DELETE_TAB`'s `action.data.node` -- a plain node id string -- IS
// the instanceId/subId already, with no extra lookup needed; see
// `shell-layout.tsx`'s `onAction` handler).
//
// Consumed by: `shell-layout.tsx` (initial model, factory dispatch),
// `tab-actions.ts` (cloning).
import type { IJsonModel, IJsonTabNode } from 'flexlayout-react';

export type TabKind = 'orders' | 'order-details';

export interface TabConfig {
  readonly kind: TabKind;
  readonly instanceId: string;
}

const TAB_NAME: Record<TabKind, string> = {
  orders: 'Orders',
  'order-details': 'Order Details',
};

/** The single component name every tab renders through the factory (`shell-layout.tsx`). */
export const GRID_COMPONENT = 'grid';

/**
 * Builds one tab's JSON node. Defaults to a fresh `instanceId` (a new grid
 * instance / subId); cloning (`tab-actions.ts`) passes an explicit one only
 * when copying is not the goal, which it never is for a clone -- clones
 * always get a fresh id, only the config's `kind` and separately-tracked
 * per-tab state are copied (plan §5: "a fresh `instanceId` and therefore a
 * fresh `subId`. The clone then diverges").
 */
export function createTabJson(kind: TabKind): IJsonTabNode {
  const instanceId = crypto.randomUUID();
  const config: TabConfig = { kind, instanceId };
  return {
    type: 'tab',
    id: instanceId,
    name: TAB_NAME[kind],
    component: GRID_COMPONENT,
    config,
  };
}

export function createInitialModelJson(): IJsonModel {
  return {
    global: {
      tabEnableClose: true,
      tabSetEnableMaximize: true,
    },
    borders: [],
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          children: [createTabJson('orders'), createTabJson('order-details')],
        },
      ],
    },
  };
}
