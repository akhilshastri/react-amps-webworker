// Owns the flexlayout-react `Model` (plan §5) and every interception point
// the plan calls out: the tab-content factory, add-by-clone, and
// close -> stubbed `sub.close`. Kept separate from `shell.tsx` so the
// connection banner and the `TabStateProvider` boundary don't get tangled
// up with flexlayout's own model lifecycle.
import { Actions, Layout, Model, type TabNode, type TabSetNode } from 'flexlayout-react';
import { useState } from 'react';
import { TabFooter } from './footer/tab-footer';
import { useMockSubscriptionStats } from './footer/use-mock-subscription-stats';
import { GRID_COMPONENT, type TabConfig, createInitialModelJson } from './model';
import { PlaceholderPanel } from './placeholder-panel';
import { stubCloseSubscription } from './stub-close-subscription';
import { cloneActiveTab } from './tab-actions';
import { useTabStateActions } from './tab-state';

/** One grid tab's content: placeholder panel + its own footer, each fed by this instance's own mock stats. */
function GridTab({ config }: { config: TabConfig }) {
  const stats = useMockSubscriptionStats(config.kind, config.instanceId);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <PlaceholderPanel kind={config.kind} instanceId={config.instanceId} />
      </div>
      <TabFooter stats={stats} />
    </div>
  );
}

export function ShellLayout() {
  // Per the flexlayout-react docs pattern: the Model is the single source
  // of truth and manages its own re-rendering once handed to <Layout> --
  // `useState`'s lazy initializer just keeps `Model.fromJson` from
  // re-running on every render; the setter is never called.
  const [model] = useState(() => Model.fromJson(createInitialModelJson()));
  const { cloneState, removeState } = useTabStateActions();

  function factory(node: TabNode) {
    if (node.getComponent() !== GRID_COMPONENT) return null;
    const config = node.getConfig() as TabConfig | undefined;
    return config ? <GridTab config={config} /> : null;
  }

  return (
    <Layout
      model={model}
      factory={factory}
      onAction={(action) => {
        // Plan §5: "Tab close intercepted via `onAction` on
        // `Actions.DELETE_TAB` -> `sub.close(subId)` before letting the
        // action through. Closing a tab must release the AMPS
        // subscription." `model.ts` sets the flexlayout tab id to the
        // instanceId/subId, so `action.data.node` needs no extra lookup.
        if (action.type === Actions.DELETE_TAB) {
          const subId = action.data.node as string;
          stubCloseSubscription(subId);
          removeState(subId);
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
            onClick={() => cloneActiveTab(model, node as TabSetNode, cloneState)}
          >
            +
          </button>,
        );
      }}
    />
  );
}
