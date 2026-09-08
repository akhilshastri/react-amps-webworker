// Owns the flexlayout-react `Model` (plan §5) and every interception point
// the plan calls out: the tab-content factory, add-by-clone, and
// close -> `DataClient.closeSubscription` (M4b: was a stub through M3B).
// Kept separate from `shell.tsx` so the connection banner and the
// `TabStateProvider` boundary don't get tangled up with flexlayout's own
// model lifecycle.
import { tabAccent } from '@amps-ui/grid-viewport';
import { toSubscriptionId } from '@amps-ui/protocol';
import type { DataClient } from '@amps-ui/worker-client';
import { Actions, Layout, Model, type TabNode, type TabSetNode } from 'flexlayout-react';
import { useState } from 'react';
import { AccentDot } from './accent-dot';
import { GridTab } from './grid-tab';
import { GRID_COMPONENT, type TabConfig, createInitialModelJson } from './model';
import { cloneActiveTab } from './tab-actions';
import { useTabStateActions } from './tab-state';

export function ShellLayout({ client }: { client: DataClient }) {
  // Per the flexlayout-react docs pattern: the Model is the single source
  // of truth and manages its own re-rendering once handed to <Layout> --
  // `useState`'s lazy initializer just keeps `Model.fromJson` from
  // re-running on every render; the setter is never called.
  const [model] = useState(() => Model.fromJson(createInitialModelJson()));
  const tabState = useTabStateActions();

  function factory(node: TabNode) {
    if (node.getComponent() !== GRID_COMPONENT) return null;
    const config = node.getConfig() as TabConfig | undefined;
    return config ? <GridTab config={config} client={client} model={model} /> : null;
  }

  return (
    <Layout
      model={model}
      factory={factory}
      // Design spec §2.1: every Orders tab gets a small accent dot before
      // its label, deterministic from its own instanceId; the Details tab
      // paired to it (`sourceOrdersTabId`) renders the SAME dot, so the two
      // panes visually match without reading anything. A severed/independent
      // Details tab (no `sourceOrdersTabId`) gets no dot -- there is nothing
      // for it to match.
      onRenderTab={(node, renderValues) => {
        const config = node.getConfig() as TabConfig | undefined;
        if (!config) return;
        const accentSourceId =
          config.kind === 'orders' ? config.instanceId : config.sourceOrdersTabId;
        if (!accentSourceId) return;
        renderValues.leading = <AccentDot accent={tabAccent(accentSourceId)} className="mr-1.5" />;
      }}
      onAction={(action) => {
        // Plan §5: "Tab close intercepted via `onAction` on
        // `Actions.DELETE_TAB` -> `sub.close(subId)` before letting the
        // action through. Closing a tab must release the AMPS
        // subscription." `model.ts` sets the flexlayout tab id to the
        // instanceId/subId, so `action.data.node` needs no extra lookup.
        if (action.type === Actions.DELETE_TAB) {
          const subId = action.data.node as string;
          client.closeSubscription(toSubscriptionId(subId));
          tabState.removeState(subId);
        }
        return action;
      }}
      onRenderTabSet={(node, renderValues) => {
        // Plan §5, AMENDED: "Add tab CLONES THE ACTIVE TAB". One clone
        // control per tabset (a layout can be split into several by
        // dragging), cloning that tabset's own selected tab -- see
        // `tab-actions.ts` for why "active tab" is scoped this way.
        if (node.getType() !== 'tabset') return;
        renderValues.stickyButtons.push(
          <button
            key="clone-tab"
            type="button"
            title="Clone active tab"
            aria-label="Clone active tab"
            className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => cloneActiveTab(model, node as TabSetNode, tabState)}
          >
            +
          </button>,
        );
      }}
    />
  );
}
