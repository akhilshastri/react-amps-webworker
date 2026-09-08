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
import type { TabAccent } from '@amps-ui/grid-viewport';
import { tabAccent } from '@amps-ui/grid-viewport';
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

/**
 * One entry in the "Following ▾" / "Change ▾" picker (design spec
 * §1.4/§2.2): every currently-open Orders tab, by name + its own accent dot
 * colour (`AccentDot`, `./accent-dot.tsx`).
 */
export interface OrdersTabSummary {
  readonly instanceId: string;
  readonly name: string;
  readonly accent: TabAccent;
}

/**
 * Enumerates every open Orders tab live from the model (design spec §1.4).
 * Deliberately NOT derived from React state -- with two tabsets, tabs can be
 * added/closed/dragged anywhere, and this is only read at the moment a
 * "Change ▾" menu opens (`order-details-tab-content.tsx`), so a fresh read
 * off `model` is simpler than keeping a parallel list in sync.
 */
export function listOrdersTabs(model: Model): OrdersTabSummary[] {
  const tabs: OrdersTabSummary[] = [];
  model.visitNodes((node) => {
    if (!(node instanceof TabNode)) return;
    const config = node.getConfig() as TabConfig | undefined;
    if (config?.kind !== 'orders') return;
    tabs.push({
      instanceId: config.instanceId,
      name: node.getName(),
      accent: tabAccent(config.instanceId),
    });
  });
  return tabs;
}

/**
 * Repoints a Details tab at a different Orders tab's selection, or severs it
 * entirely (`sourceOrdersTabId: undefined`, "Independent selection"). The
 * concrete fix for §1.4's gap: a details clone is deliberately severed from
 * its source on creation (`cloneActiveTab` above), and with two tabsets each
 * potentially holding more than one tab, there was previously no way to
 * point a severed Details tab at a (possibly different) live Orders tab.
 * Additive to the model -- `sourceOrdersTabId` already exists on
 * `TabConfig`, this just updates it in place via flexlayout's own supported
 * mechanism for editing a tab node's `config` (`TabNode.getConfig()`'s own
 * doc comment shows this exact call shape).
 */
export function setDetailsSource(
  model: Model,
  detailsTabId: string,
  sourceOrdersTabId: string | undefined,
): void {
  const node = model.getNodeById(detailsTabId);
  if (!(node instanceof TabNode)) return;
  const currentConfig = node.getConfig() as TabConfig;
  model.doAction(
    Actions.updateNodeAttributes(detailsTabId, {
      config: { ...currentConfig, sourceOrdersTabId },
    }),
  );
}
