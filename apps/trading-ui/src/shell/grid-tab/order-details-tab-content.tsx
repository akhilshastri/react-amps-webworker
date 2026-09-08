import { OrderDetailsGrid } from '@amps-ui/feature-order-details';
// The `order_details` grid tab's content (plan §4/§5, M4b). Unlike the
// orders tab, this component does not open a subscription itself --
// `<OrderDetailsGrid>` owns that lifecycle entirely (debounced open/update/
// close driven by `selectedOrders`, see its own header) -- this component's
// only job is resolving WHICH selection to follow (`config.sourceOrdersTabId`,
// `../model.ts`) and forwarding the resulting handle to the shared
// `<TabFrame>`/`<TabFooter>` (plan §5: real `stats` events, not a mock).
//
// M7 (design spec §1.4/§2.2) adds the "Following" toolbar: with two
// tabsets, either side can hold more than one tab, so `sourceOrdersTabId`
// alone (set once at creation, severed by a clone) is no longer enough --
// this is the UI that lets a trader repoint a Details tab at a different
// live Orders tab, or make it independent, via `setDetailsSource()`
// (`../tab-actions.ts`, `Actions.updateNodeAttributes`).
import { type Order, projectDetailRowCount } from '@amps-ui/feature-orders';
import { type TabAccent, tabAccent } from '@amps-ui/grid-viewport';
import { toSubscriptionId } from '@amps-ui/protocol';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@amps-ui/ui';
import type { DataClient, SubscriptionHandle } from '@amps-ui/worker-client';
import { type Model, TabNode } from 'flexlayout-react';
import { useState } from 'react';
import { AccentDot } from '../accent-dot';
import type { TabConfig } from '../model';
import { listOrdersTabs, setDetailsSource } from '../tab-actions';
import { useTabState } from '../tab-state';
import { TabFrame } from './tab-frame';

/** A tab's live display name -- read fresh off the model, not cached, so a user rename never goes stale (design spec §2.2). */
function tabName(model: Model, id: string): string | undefined {
  const node = model.getNodeById(id);
  return node instanceof TabNode ? node.getName() : undefined;
}

function EmptyDetailsState({
  accent,
  sourceName,
}: {
  accent: TabAccent | undefined;
  sourceName: string | undefined;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-muted-foreground text-sm">
      <p className="font-medium text-foreground">No orders selected</p>
      <p className="inline-flex items-center gap-1.5">
        Select rows in
        {accent && sourceName ? (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <AccentDot accent={accent} />
            {sourceName}
          </span>
        ) : (
          'an Orders tab'
        )}
        to see their execution detail here.
      </p>
    </div>
  );
}

/**
 * The slim strip above the details grid (design spec §2.2) -- mirrors the
 * Orders tab's own "Clear selection" strip. Shows which Orders tab this pane
 * follows, the exact order/row counts, and (only once there is something to
 * switch to) a "Change ▾" picker.
 */
function FollowingToolbar({
  model,
  detailsTabId,
  sourceId,
  selectedOrders,
}: {
  model: Model;
  detailsTabId: string;
  sourceId: string | undefined;
  selectedOrders: readonly Order[];
}) {
  const sourceName = sourceId ? tabName(model, sourceId) : undefined;
  const accent = sourceId ? tabAccent(sourceId) : undefined;
  // Read fresh off the model on every render rather than cached -- flexlayout
  // tabs can be added/closed/renamed anywhere in either tabset at any time
  // (design spec §1.4), and the dropdown must never offer a stale choice.
  const orderTabs = listOrdersTabs(model);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-xs">
      {accent && <AccentDot accent={accent} />}
      <span className="font-medium">
        {sourceName ? `Following ${sourceName}` : 'Independent selection'}
      </span>
      <span className="text-muted-foreground">
        {selectedOrders.length.toLocaleString()} orders ·{' '}
        {projectDetailRowCount(selectedOrders).toLocaleString()} rows
      </span>
      {/* An always-disabled dropdown with nothing to switch to is worse than
          no dropdown -- only offer it once a second Orders tab exists. */}
      {orderTabs.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="ml-auto h-6 px-2">
              Change ▾
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {orderTabs.map((tab) => (
              <DropdownMenuItem
                key={tab.instanceId}
                onSelect={() => setDetailsSource(model, detailsTabId, tab.instanceId)}
              >
                <AccentDot accent={tab.accent} />
                {tab.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => setDetailsSource(model, detailsTabId, undefined)}>
              Independent selection (don't follow any tab)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function OrderDetailsTabContent({
  client,
  config,
  model,
}: {
  client: DataClient;
  config: TabConfig;
  model: Model;
}) {
  // No `sourceOrdersTabId` means this tab was severed by a clone, made
  // independent via "Change ▾", or created standalone -- it falls back to
  // its OWN slot, which a clone seeds once at creation time and nothing
  // else ever writes (`../tab-actions.ts`).
  const sourceId = config.sourceOrdersTabId;
  const [sourceState] = useTabState(sourceId ?? config.instanceId);
  const [handle, setHandle] = useState<SubscriptionHandle | undefined>(undefined);

  return (
    <TabFrame handle={handle}>
      <FollowingToolbar
        model={model}
        detailsTabId={config.instanceId}
        sourceId={sourceId}
        selectedOrders={sourceState.selectedOrders}
      />
      <div className="min-h-0 flex-1">
        <OrderDetailsGrid
          client={client}
          subId={toSubscriptionId(config.instanceId)}
          selectedOrders={sourceState.selectedOrders}
          onHandleChange={setHandle}
          emptyState={
            <EmptyDetailsState
              accent={sourceId ? tabAccent(sourceId) : undefined}
              sourceName={sourceId ? tabName(model, sourceId) : undefined}
            />
          }
        />
      </div>
    </TabFrame>
  );
}
