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

export function cloneActiveTab(
  model: Model,
  tabSetNode: TabSetNode,
  cloneState: (fromInstanceId: string, toInstanceId: string) => void,
): void {
  const active = tabSetNode.getSelectedNode();
  if (!(active instanceof TabNode)) return;

  const sourceConfig = active.getConfig() as TabConfig | undefined;
  if (!sourceConfig) return;

  const cloneJson = createTabJson(sourceConfig.kind);
  const cloneConfig = cloneJson.config as TabConfig;
  cloneState(sourceConfig.instanceId, cloneConfig.instanceId);

  model.doAction(Actions.addTab(cloneJson, tabSetNode.getId(), DockLocation.CENTER, -1, true));
}
