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
// `sourceOrdersTabId` (M4b addition, not in the plan's original §5 model --
// flagged): the plan's Goal is "multi-selecting rows in the orders master
// grid drives a live order_details subscription", but selection is per-tab
// (plan §5) and tabs are otherwise independent instances with no built-in
// relationship. Something has to record WHICH orders tab a given
// order-details tab's selection follows -- this is that pointer, set once
// at tab-creation time (the two startup tabs are paired this way) and
// carried by clone (`tab-actions.ts`), which severs it (see there for why).
// A details tab with no `sourceOrdersTabId` (severed by a clone, or created
// standalone) reads its OWN per-tab selection slot instead (`tab-state.tsx`).
//
// Consumed by: `shell-layout.tsx` (initial model, factory dispatch),
// `tab-actions.ts` (cloning).
import type { IJsonModel, IJsonTabNode } from 'flexlayout-react';

export type TabKind = 'orders' | 'order-details';

export interface TabConfig {
  readonly kind: TabKind;
  readonly instanceId: string;
  /** Only meaningful for `kind: 'order-details'` -- see module header. */
  readonly sourceOrdersTabId?: string;
}

const TAB_NAME: Record<TabKind, string> = {
  orders: 'Orders',
  'order-details': 'Order Details',
};

/** The single component name every tab renders through the factory (`shell-layout.tsx`). */
export const GRID_COMPONENT = 'grid';

/**
 * Builds one tab's JSON node. Always a fresh `instanceId` (a new grid
 * instance / subId) -- cloning (`tab-actions.ts`) never reuses one, only
 * the config's `kind` and separately-tracked per-tab state are copied (plan
 * §5: "a fresh `instanceId` and therefore a fresh `subId`. The clone then
 * diverges").
 */
export function createTabJson(kind: TabKind, sourceOrdersTabId?: string): IJsonTabNode {
  const instanceId = crypto.randomUUID();
  const config: TabConfig = { kind, instanceId, sourceOrdersTabId };
  return {
    type: 'tab',
    id: instanceId,
    name: TAB_NAME[kind],
    component: GRID_COMPONENT,
    config,
  };
}

export function createInitialModelJson(): IJsonModel {
  const ordersTab = createTabJson('orders');
  const ordersInstanceId = (ordersTab.config as TabConfig).instanceId;
  const detailsTab = createTabJson('order-details', ordersInstanceId);

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
          children: [ordersTab, detailsTab],
        },
      ],
    },
  };
}
