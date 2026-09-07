// "Add tab" clones the active tab (plan §5, AMENDED -- supersedes the
// earlier Orders/Order-Details dropdown): `Actions.addTab` copies the
// active tab's `kind` and a snapshot of its current per-tab state, with a
// fresh `instanceId` (and therefore a fresh `subId`). The clone then
// diverges -- it is fully independent from the moment it is created.
//
// "Active tab" is scoped to the tabset the clone was requested from (its
// `getSelectedNode()`), not a single global active tab: flexlayout allows
// a layout to be split into multiple tabsets by dragging, and each one
// gets its own clone control (`shell-layout.tsx`'s `onRenderTabSet`), so
// "the active tab" is unambiguous per click.
import { Actions, DockLocation, type Model, TabNode, type TabSetNode } from 'flexlayout-react';
import { type TabConfig, createTabJson } from './model';
import type { TabStateContextValue } from './tab-state';

export function cloneActiveTab(
  model: Model,
  tabSetNode: TabSetNode,
  tabState: Pick<TabStateContextValue, 'getState' | 'setState' | 'cloneState'>,
): void {
  const active = tabSetNode.getSelectedNode();
  if (!(active instanceof TabNode)) return;

  const sourceConfig = active.getConfig() as TabConfig | undefined;
  if (!sourceConfig) return;

  // A clone never carries `sourceOrdersTabId` forward (plan §5: "the clone
  // then diverges ... fully independent from the moment it is created") --
  // a details clone that kept live-following the same orders tab would not
  // be independent, it would just be a second window onto the same state.
  const cloneJson = createTabJson(sourceConfig.kind);
  const cloneConfig = cloneJson.config as TabConfig;

  if (sourceConfig.kind === 'order-details') {
    // A details tab's own tab-state slot is never written directly -- it
    // reads through `sourceOrdersTabId` (`model.ts`) -- so `cloneState`
    // would copy an empty snapshot. Resolve what it currently shows first.
    const resolvedId = sourceConfig.sourceOrdersTabId ?? sourceConfig.instanceId;
    tabState.setState(cloneConfig.instanceId, tabState.getState(resolvedId));
  } else {
    tabState.cloneState(sourceConfig.instanceId, cloneConfig.instanceId);
  }

  model.doAction(Actions.addTab(cloneJson, tabSetNode.getId(), DockLocation.CENTER, -1, true));
}
