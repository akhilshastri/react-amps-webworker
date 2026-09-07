# M7 — Trading blotter visual & layout design spec

Design pass only. No application code was changed to produce this; it is written against
the M4 codebase as it stands (`plan/01-amps-viewport-ui.md`, `apps/trading-ui/src/shell/*`,
`packages/feature-orders`, `packages/feature-order-details`, `packages/grid-viewport`,
`packages/ui`) so it can be implemented directly against those files.

Reference screenshots reviewed: the Orders master grid (1,000 rows, 24 columns, unstyled
AG Grid on white) and the Order Details grid (23 columns, ticking, currently reachable only
by switching tabs away from Orders).

No Figma file was supplied for this project, so this spec treats `packages/ui`'s vendored
shadcn "new-york/neutral" components and existing OKLCH token set as the source-of-truth
design system, per the brief's own instruction to check there. Nothing here invents a
component shadcn doesn't already provide except where called out under "New components."

---

## 0. What this changes, in one paragraph

Today: one flexlayout `Row` → one `TabSet` → two tabs ("Orders", "Order Details") that hide
each other, both rendering default-themed `AgGridReact`. This spec moves to one `Row` → two
side-by-side `TabSet`s (Orders left, Details right), applies a themed, dense, dark-mode-aware
AG Grid Theming-API skin shared by both grids, adds a small colour-coded "which orders feed
this details pane" affordance, redesigns the footer/connection/empty/loading states, and
defines a semantic colour system for P&L, side, and status backed by `@radix-ui/colors`
(new, tiny, non-runtime dependency — see §4).

---

## 1. Layout — flexlayout model

### 1.1 Model shape

Replace `createInitialModelJson()` in `apps/trading-ui/src/shell/model.ts`. The change is
the `layout.children` shape only — one `Row` with two `TabSet` children instead of one:

```jsonc
{
  "global": { "tabEnableClose": true, "tabSetEnableMaximize": true },
  "borders": [],
  "layout": {
    "type": "row",
    "children": [
      {
        "type": "tabset",
        "weight": 38,
        "children": [ /* ordersTab */ ]
      },
      {
        "type": "tabset",
        "weight": 62,
        "children": [ /* detailsTab */ ]
      }
    ]
  }
}
```

- **38/62 weight split, not 50/50.** The details grid is the information-dense, live side
  (23 columns, 6 ticking) and is what a trader watches once a selection is made; the orders
  grid is a picker with fewer glanced-at columns at any moment (identity + status). Weights
  are relative, not percentages — flexlayout normalizes them, and the user can drag the
  splitter that renders automatically between two sibling `tabset`s in a `row` (no extra
  code: this is flexlayout's default behaviour for adjacent panes).
- `createTabJson` (unchanged) still stamps `id = instanceId` and `config.sourceOrdersTabId`
  for the startup pairing. Nothing about the tab-node shape changes — only which `tabset`
  each starts in.
- **This is expressible in flexlayout-react 0.10.8's JSON model as-is** — a `Row`'s
  `children` array accepting two `TabSet` nodes is exactly what the library's own two-pane
  examples use. No fork, no custom layout engine.

### 1.2 Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Reconnecting…                                              (banner, dismiss│
│                                                                on 'open')     │
├───────────────────────────────────┬─────────────────────────────────────────┤
│ Orders ×            +             │ Order Details ×              +           │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ ▐ pinned: Order ID │ Symbol │ Side│ ● Following Orders   [Clear selection]   │
│  … 21 more columns, scrolls →     │ ▐ pinned-L: Detail│Order│Seq│Symbol│Side │
│                                    │  … ticking block pinned-R (see §3.4)    │
│  [selected rows tinted with the   │                                          │
│   accent dot's colour, §2]        │  [rows ticking, cells flashing, §3.4]    │
│                                    │                                          │
├───────────────────────────────────┼─────────────────────────────────────────┤
│ 1,000 rows · 3 selected      0/s  │ 24,481 rows · window 0–2,000 loaded ·    │
│                                    │ 812/s · last tick 0s ago                 │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

The vertical divider between the two tabsets is the flexlayout splitter — draggable, so a
trader can widen Details when scanning many ticking columns, or widen Orders when hunting
for a specific order.

### 1.3 Adding, closing, dragging tabs

- **Every tabset gets its own clone ("+") control** — this already falls out of
  `onRenderTabSet` in `shell-layout.tsx` firing per tabset node; with two tabsets, both get
  one automatically. No change needed there.
- **Clone stays scoped to its own tabset**, per the existing `cloneActiveTab` contract
  (`tab-actions.ts`: `Actions.addTab(cloneJson, tabSetNode.getId(), ...)`). Cloning the
  Orders tab adds a second Orders tab into the *left* tabset; cloning Details adds a second
  Details tab into the *right* tabset. Two masters and two detail panes can coexist, each
  side scrollable/tabbable independently.
- **Drag between tabsets is flexlayout's default cross-tabset drag-and-drop** — already
  exercised in M3B's "tabs can be added, dragged, and closed" DoD, and unaffected by having
  two tabsets instead of one. A trader can drag an Orders tab into the Details tabset (or
  vice versa) or split further; nothing in this spec disables that. It does mean an
  "Orders"-kind tab can end up sitting where a "Details"-kind tab used to be — the factory
  in `shell-layout.tsx` dispatches on `config.kind`, not tabset position, so this renders
  correctly regardless of which tabset a tab lives in. The two-tabset *default* is a
  starting layout, not an enforced constraint.
- **Close** is unchanged (`Actions.DELETE_TAB` → `client.closeSubscription`). If a trader
  closes every tab in a tabset, flexlayout collapses that tabset's space into its sibling —
  acceptable; re-adding a tab from the remaining tabset's "+" is the recovery path. Building
  a "restore last closed pane" affordance is out of scope (not asked for).

### 1.4 Multi-pane pairing — the gap this layout change opens, and how it's closed

With one Orders tabset and one Details tabset each potentially holding more than one tab,
`sourceOrdersTabId` (currently set once, at tab creation, per `model.ts`'s header comment)
stops being sufficient on its own: a second Details tab created by cloning is deliberately
**severed** (`tab-actions.ts`, by design — "a details clone that kept live-following the
same orders tab would not be independent"). That leaves no way to point a *severed* Details
tab at a *different* live Orders tab once both exist. §2 below specs the small, additive UI
that closes this gap (a "Following: ▾" picker in the Details tab's own toolbar) — it reuses
`TabConfig.sourceOrdersTabId` and `Actions.updateNodeAttributes`, which flexlayout already
supports for updating a tab node's `config` in place; no protocol or model-shape change.

---

## 2. Making the master→details link legible

Nothing today tells a trader *which* selected rows are driving what's on the right. Two
reinforcing signals, both cheap (no per-cell React, no extra grid work):

### 2.1 Tab accent colour — identity, not semantics

Every **Orders** tab gets a small accent colour, deterministic from its `instanceId` (no
new state, no reordering-on-close bugs):

```ts
const TAB_ACCENTS = ['violet', 'cyan', 'pink', 'indigo', 'teal'] as const; // §4.3 tokens

function tabAccent(instanceId: string): (typeof TAB_ACCENTS)[number] {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) hash = (hash * 31 + instanceId.charCodeAt(i)) >>> 0;
  return TAB_ACCENTS[hash % TAB_ACCENTS.length];
}
```

These five hues are chosen to be **disjoint from every semantic colour in §4** (P&L
green/red, side blue/orange, status amber/green/gray) — an accent dot must never be
mistaken for a data value.

Applied as:
- A **4px dot** rendered before the tab's label text (in the flexlayout tab render, via
  `onRenderTab`), fill = `var(--accent-<hue>-9)`.
- A **2px top border stripe** on that Orders tab's own `TabFrame` content area, same colour
  — a persistent, peripheral-vision-visible marker of "this is the violet one" while the
  tab is focused, that doesn't compete with grid content.
- The Details tab paired to it (`sourceOrdersTabId` resolving to that instance) renders the
  **same dot** in its own tab label and inside its toolbar's "Following" chip (§2.2). Two
  panes sharing a colour is the "at a glance" signal the brief asks for — no reading
  required, just colour-matching, which is how the rest of the layout (tabset position)
  already reinforces "left drives right" for the common one-master/one-details case.
- With only one Orders tab open (the default, startup state) the dot is still shown but is
  low-stakes — it becomes meaningful the moment a second Orders tab exists.

### 2.2 Details toolbar — explicit text, for when colour isn't enough

Add a slim toolbar strip above the Details grid (mirrors the Orders tab's existing
"Clear selection" strip, `orders-tab-content.tsx`), replacing the current bare empty-state
`<div>` wrapper in `OrderDetailsGrid`:

```
● Following Orders            3 orders · 24,481 rows          [Change ▾]
```

- `●` — the accent dot (§2.1) in the *source* Orders tab's colour.
- `Following <Orders tab name>` — the source tab's current display name (flexlayout tab
  names can be renamed by the user; read it live via `model.getNodeById(sourceId)?.getName()`
  rather than caching it, so a rename doesn't go stale).
- `N orders · M rows` — `N = selectedOrders.length`, `M = projectDetailRowCount(selectedOrders)`
  (already computed and exact, per plan §4/M3C) — gives the *true* total up front, before
  the reader even looks at the footer's loaded-window figure.
- **`Change ▾`** — a `DropdownMenu` (already vendored) listing every currently-open Orders
  tab by name + accent dot, plus a final "Independent selection (don't follow any tab)"
  item. Selecting one dispatches:
  ```ts
  model.doAction(
    Actions.updateNodeAttributes(detailsTabId, {
      config: { ...currentConfig, sourceOrdersTabId: chosenId /* or undefined */ },
    }),
  );
  ```
  This is the concrete fix for §1.4's gap. It's additive to `tab-actions.ts` (a new
  `setDetailsSource()` helper alongside `cloneActiveTab`) and needs no protocol change —
  `sourceOrdersTabId` already exists on `TabConfig`.
- When only one Orders tab exists (default state), render the toolbar **without** the
  `Change ▾` control — nothing to switch to, and an always-disabled dropdown is worse than
  no dropdown (an interface shouldn't offer a choice with one option).

### 2.3 Selection highlight in the Orders grid

Selected rows already get AG Grid's default selection background. Tint it with the tab's
own accent instead of the generic default, at low opacity so it doesn't fight row-hover or
cell text contrast:

```ts
themeQuartz.withParams({
  selectedRowBackgroundColor: `var(--accent-${accent}-3)`, // step 3 = "UI element background", light tint
});
```

Combined with §2.1's dot, this means: the rows currently lit up in the Orders grid, the dot
on its tab, and the dot on the Details toolbar are all the same colour. That's the full
legibility chain the brief asks for, and it costs one CSS variable per grid instance (theme
object is created once per tab via `useMemo`, not per row/cell — no perf concern).

---

## 3. Density and typography

### 3.1 Type

Two families, functionally justified rather than decorative (the frontend-design skill's
"ground choices in subject matter" — these are the two faces already standard in trading
terminals for exactly this split):

| role | family | why |
|---|---|---|
| UI chrome, headers, body text, all numerics | **Inter** (variable) | Excellent tabular-figure support, high x-height at small sizes, the de facto face for dense data UIs (Linear, Vercel, GitHub all use it for the same reason: it stays legible at 12–13px where most grotesques don't). |
| Identifier columns only: `orderId`, `detailId`, `execId`, `clientId` | **JetBrains Mono** (variable) | These are alphanumeric codes a trader must read character-by-character (`ORD-000042`, `EXE-015MHBQ`) — a monospace face with unambiguous `0`/`O` and `1`/`l`/`I` shapes prevents misreads. This is *not* the generic "monospace for small data labels" AI-tell the design skill warns about — it's applied to four specific ID columns because they are literally codes, not to labels/metadata generally. Every other column stays in Inter. |

Add as dependencies (small, self-hosted, no runtime logic — fits the "proven package for a
solved problem" default):
```
bun add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```
In `packages/ui/src/index.css`, alongside the existing `@theme inline` block:
```css
@import "@fontsource-variable/inter";
@import "@fontsource-variable/jetbrains-mono";

@theme inline {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, "SF Mono", monospace;
  /* ...existing tokens unchanged... */
}
```
Apply `font-mono` via `cellClass` on exactly those four column defs (`columns.ts` in both
feature packages) — a static string, zero per-render cost.

**Tabular numerals**: every numeric column (`priceCol`/`intCol` in both `columns.ts`) gets
`font-variant-numeric: tabular-nums` via a shared `cellClass: 'tabular-nums'` (Tailwind
utility, already available — no plugin needed). This is what keeps a scrolling column of
prices vertically aligned digit-for-digit, which proportional figures don't guarantee even
within one "numeric" font.

### 3.2 Row height, header, borders

| token | value | rationale |
|---|---|---|
| row height | **28px** | Quartz's default (~42px) is built for touch/generous UIs; a blotter trades that space for more rows on screen. 28px is comfortable at 12.5px type without feeling cramped — verify with a real click-target pass (44px minimum touch targets don't apply here; this is a mouse/keyboard desktop surface). |
| header height | **30px** | Marginally taller than rows so the header reads as a distinct band, not another row. |
| body font size | **12.5px**, Inter | Small enough for 24/23-column density, large enough to stay AA-legible (see §4.5). |
| header font | **12.5px, medium weight (500), Title Case** (unchanged from current screenshots — "Order ID", not "ORDER ID") | Per the frontend-design skill: all-caps tracked labels are a templated-AI tell when used decoratively; here Title Case already reads clearly as "this is the header band" via weight + the header/body background split (§4), so caps add nothing. |
| cell horizontal padding | **8px** (down from Quartz's default ~16px) | The single biggest density lever for 23–24 columns before resorting to horizontal scroll. |
| vertical cell borders | **header only** — a 1px hairline between header cells (already present in the current screenshots), at `var(--border)`. **No vertical borders in body rows.** | A full grid of vertical rules at this density reads as visual noise; traders scan rows and columns of numbers, not cell boxes. The header retains hairlines because they're doing real work there — marking where one column's label ends and the next begins when there's no cell padding gap to rely on visually. |
| horizontal row borders | **1px**, `var(--border)`, body rows only | Keeps rows scannable without a full grid. |
| zebra striping | **off, deliberately** | Alternating row backgrounds would sit *under* the flash animation and the selection tint (§2.3), and at 2,200 updates/sec across many rows, a flashing cell against two different base row colours reads as flickering harder than it should. One flat row background keeps flash the only thing that visually "moves." |
| row hover | subtle, `var(--muted)` at ~50% | orientation aid only, not a strong highlight (selection already owns strong emphasis). |

### 3.3 Taming 24/23 columns

- **Pin identity columns left**: Orders — `orderId`, `symbol`, `side`, `status` (the four a
  trader re-orients against after any horizontal scroll). Details — `detailId`, `orderId`,
  `seq`, `symbol`, `side` (extends the current single `detailId`-pinned column).
- **Pin the live block right, in Details only**: `markPrice`, `marketValue`,
  `unrealizedPnl`, `dayPnl` pinned `'right'`. Rationale: these four are *why* a trader has
  the details pane open; pinning them means they're visible regardless of how far the
  trader has scrolled to inspect `venue`/`counterparty`/`commission` in the middle columns.
  `lastUpdated`/`tickSeq` stay unpinned and un-scrolled-to by default — they're
  diagnostic/audit fields, not scan targets.
- **Optional, recommended if time allows — header column groups** (two-row header): group
  Orders' 24 flat columns under five bands — *Order* (orderId/orderDate/symbol/instrumentName),
  *Classification* (assetClass/exchange/side/orderType/tif), *Execution* (quantity/limitPrice/
  filledQty/avgFillPrice/status/currency/notional), *Ownership* (trader/desk/book/clientId/
  clientName), *Dates* (settlementDate/createdAt/childCount). This is AG Grid **header**
  grouping (`ColDef.children` under a `ColGroupDef`), not row grouping — the brief's "no row
  grouping" constraint is about the Viewport row model's row tree, which header grouping
  doesn't touch. **Flagged as unverified**: I have not confirmed header column groups
  against the Viewport row model in this specific AG Grid/version combination — the row
  model constraints table in the plan doesn't mention them, but verify in a throwaway grid
  before committing to the two-row header, since it changes `headerHeight` math (two bands
  instead of one).
- Both grids keep native horizontal scroll for the un-pinned middle columns (already present
  in the screenshots) — this spec narrows what needs scrolling to reach, it doesn't try to
  eliminate scrolling at 23–24 columns, which isn't realistic at readable font sizes.

### 3.4 Cell flash — do not colour it by direction

`ORDER_DETAILS_COLUMN_DEFS` already sets `enableCellChangeFlash: true` on exactly the 6
ticking fields (correct, keep as-is). Design decision on the flash's **colour**:

**Use one neutral flash colour for all 6 ticking fields, not a green-up/red-down flash.**
At ~2,200 updates/sec, a details grid showing a few hundred rows can have dozens of cells
flashing per second; colouring the flash by direction would make it compete directly with
`unrealizedPnl`/`dayPnl`'s own sign-based text colour (§4.2) — a cell could be static-red
(negative PnL) while flashing green (ticked upward this instant), which is confusing at a
glance and is exactly the kind of per-cell visual complexity the brief's performance
constraint warns against. Split the two signals instead:
- **Flash colour** (transient, ~500ms, all 6 fields alike): a neutral amber-tinted pulse —
  `var(--flash-9)` (§4.4) — meaning only "this value just changed," full stop.
- **Text colour** (persistent, sign-based, `unrealizedPnl`/`dayPnl` only): green/red per
  §4.2, computed once via `cellClassRules` (a cheap per-value check AG Grid already runs for
  formatting, not extra work).

**Flagged as unverified**: I could not confirm the exact AG Grid 36.1 Theming-API parameter
name for the data-changed flash colour via the available docs lookup — the underlying
mechanism is confirmed (`CellFlashService` toggles an `ag-cell-data-changed`/
`ag-cell-data-changed-animation` CSS class pair per cell, with `cellFlashDuration`/
`cellFadeDuration` as `AgGridReact` props, defaults 500ms/1000ms — keep those defaults), but
if `themeQuartz.withParams()` in this exact version has no dedicated colour param for it,
fall back to a scoped CSS override:
```css
.ag-cell-data-changed-animation {
  transition: background-color var(--ag-cell-fade-duration, 1000ms);
}
.ag-cell-data-changed {
  background-color: var(--flash-9);
}
```
scoped under the grid wrapper's class so it doesn't leak into any other themed surface.
Verify the param name against the installed `ag-grid-community@36.1.0` theming reference
before reaching for the CSS fallback.

---

## 4. Colour

### 4.1 Mechanism

Add `@radix-ui/colors` (tiny, CSS-variable-only, zero runtime JS, MIT — exactly the "proven
package for an already-solved problem" case: colour-scale accessibility is Radix's whole
job, and hand-picking hex pairs to hit contrast ratios by eye is the thing to avoid here).
It ships ready-made CSS files per scale, light and dark, as raw custom properties:

```css
/* packages/ui/src/index.css, near the top, alongside the existing @import lines */
@import "@radix-ui/colors/green.css";
@import "@radix-ui/colors/green-dark.css";
@import "@radix-ui/colors/red.css";
@import "@radix-ui/colors/red-dark.css";
@import "@radix-ui/colors/blue.css";
@import "@radix-ui/colors/blue-dark.css";
@import "@radix-ui/colors/orange.css";
@import "@radix-ui/colors/orange-dark.css";
@import "@radix-ui/colors/amber.css";
@import "@radix-ui/colors/amber-dark.css";
@import "@radix-ui/colors/slate.css";
@import "@radix-ui/colors/slate-dark.css";
@import "@radix-ui/colors/violet.css";
@import "@radix-ui/colors/violet-dark.css";
@import "@radix-ui/colors/cyan.css";
@import "@radix-ui/colors/cyan-dark.css";
@import "@radix-ui/colors/pink.css";
@import "@radix-ui/colors/pink-dark.css";
@import "@radix-ui/colors/indigo.css";
@import "@radix-ui/colors/indigo-dark.css";
@import "@radix-ui/colors/teal.css";
@import "@radix-ui/colors/teal-dark.css";
```
Each import defines `--green-1` … `--green-12` (etc.) unconditionally; the `-dark` files
define the same variable names scoped to `.dark` in Radix's own build. **Do not** alias
these per-mode yourself — that's what the `-dark` files already do, matching this repo's
existing `.dark` class convention (`@custom-variant dark (&:is(.dark *))`) with zero glue.

**Contrast mechanism, not a guess**: Radix Colors' scale steps are defined so that **step
11** ("low-contrast text") is designed to hit **≥ 4.5:1** against the step 1/2 app
background in both the light and dark scale — that's the documented purpose of step 11
across every Radix scale, light or dark. Every text-on-background semantic colour below
uses step 11 for exactly that reason, and every solid/dot/badge-fill use uses step 9
("solid backgrounds," the scale's saturated brand-colour step, meant to be paired with
white or step-11/12 text on top of it, not used for text-on-app-background itself). Spot
check with a contrast tool at implementation time regardless — treat "designed to" as a
strong prior, not a substitute for measuring the actual rendered pixels.

### 4.2 Semantic tokens

New custom properties in `packages/ui/src/index.css`'s `:root`/`.dark` blocks (values are
references, not literals — they inherit whichever scale import above resolved for the
current mode):

```css
:root, .dark {
  /* P&L — green/red reserved exclusively for gain/loss, never reused elsewhere */
  --pnl-positive-text: var(--green-11);
  --pnl-positive-solid: var(--green-9);
  --pnl-negative-text: var(--red-11);
  --pnl-negative-solid: var(--red-9);

  /* Side — deliberately NOT green/red, so BUY/SELL never reads as a P&L signal */
  --side-buy-text: var(--blue-11);
  --side-buy-bg: var(--blue-3);
  --side-sell-text: var(--orange-11);
  --side-sell-bg: var(--orange-3);

  /* Status */
  --status-new-text: var(--slate-11);
  --status-new-bg: var(--slate-3);
  --status-partial-text: var(--amber-11);
  --status-partial-bg: var(--amber-3);
  --status-filled-text: var(--green-11);
  --status-filled-bg: var(--green-3);
  /* CANCELLED is neutral-void, not "loss" — reuses slate, not red, and pairs
     with a strikethrough text style rather than a colour to carry the meaning */
  --status-cancelled-text: var(--slate-11);
  --status-cancelled-bg: var(--slate-3);

  /* Flash — neutral, distinct from every semantic colour above (§3.4) */
  --flash-9: var(--amber-9);
}
```

Why status FILLED reuses the P&L-positive green rather than getting a sixth hue: both
signal "good, complete" in the same row without contradiction — a FILLED badge next to a
positive `unrealizedPnl` reinforces rather than competes. CANCELLED deliberately avoids red
(P&L-negative) for the opposite reason: a cancelled order isn't a loss, it's void, and
colouring it like one would misstate what happened.

### 4.3 Tab-accent tokens (§2.1)

```css
:root, .dark {
  --accent-violet-9: var(--violet-9); --accent-violet-3: var(--violet-3);
  --accent-cyan-9: var(--cyan-9);     --accent-cyan-3: var(--cyan-3);
  --accent-pink-9: var(--pink-9);     --accent-pink-3: var(--pink-3);
  --accent-indigo-9: var(--indigo-9); --accent-indigo-3: var(--indigo-3);
  --accent-teal-9: var(--teal-9);     --accent-teal-3: var(--teal-3);
}
```
(Kept as an indirection layer rather than referencing `--violet-9` etc. directly from
component code, so the five-hue palette can change in one place later.)

### 4.4 Component composition — Badge variants

`Badge` (`packages/ui/src/components/ui/badge.tsx`) already takes a `variant` via `cva`.
Rather than stretch its existing `default/secondary/destructive/outline/ghost/link` set to
also mean "BUY", extend it with the semantic ones directly, so callers write intent:

```tsx
// columns.ts, side/status cellRenderer
<Badge className="bg-[var(--side-buy-bg)] text-[var(--side-buy-text)]">BUY</Badge>
<Badge className="bg-[var(--status-partial-bg)] text-[var(--status-partial-text)]">PARTIAL</Badge>
```
Using Tailwind's arbitrary-value `bg-[var(...)]` against the token layer (not new `cva`
variants baked into the shared `Badge`) keeps `Badge` itself topic-agnostic — exactly the
same "stay generic, let the feature package apply meaning" split the codebase already uses
for `ViewportGrid` vs the feature grids (plan §1: "the reusable grid never learns the words
'orders' or 'childCount'"). `unrealizedPnl`/`dayPnl` don't need a `Badge` at all — they're
plain numeric cells; sign colour is a `cellClassRules` text-colour change, not a pill (a
badge on every P&L cell in a ticking column would be its own visual-noise problem).

### 4.5 Contrast targets, stated explicitly

- Body text (numerics, IDs) on grid background: **≥ 4.5:1**, carried by `--foreground` on
  `--background` (existing shadcn tokens — unaffected by this spec, already presumed
  compliant as the app's base tokens).
- Semantic text tokens (§4.2, all step-11 references) on the grid row background: **≥
  4.5:1**, per Radix's step-11 design intent (§4.1).
- Badge fill (step-3) vs. its own step-11 text: **higher** than 4.5:1 in practice, since
  step 3 sits closer to the step-1/2 app background that step 11 was calibrated against,
  not further from it.
- Tab accent dot (step-9 solid) is a **non-text UI indicator**, target **≥ 3:1** against
  its immediate background (WCAG's non-text-contrast minimum) — step 9 vs. step 1/2 clears
  this comfortably in every Radix scale; it is never used to carry text.
- Flash pulse (`--flash-9` = amber-9) is transient (≤ 1.5s total including fade) and
  decorative-only (the data itself doesn't depend on reading text *during* the flash) —
  held to the 3:1 non-text bar, not 4.5:1.

---

## 5. Wiring AG Grid's Theming API to these tokens (both grids, light + dark, for free)

`ViewportGrid` (`packages/grid-viewport/src/viewport-grid.tsx`) currently hardcodes
`theme={themeQuartz}` with no params. Replace with one shared theme object, defined once
(e.g. `packages/grid-viewport/src/theme.ts`) and reused by both `<OrdersGrid>` and
`<OrderDetailsGrid>`:

```ts
import { themeQuartz } from 'ag-grid-community';

export const blotterTheme = themeQuartz.withParams({
  rowHeight: 28,
  headerHeight: 30,
  fontSize: 12.5,
  headerFontSize: 12.5,
  headerFontWeight: 500,
  spacing: 4,
  cellHorizontalPadding: 8,
  backgroundColor: 'var(--background)',
  foregroundColor: 'var(--foreground)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--foreground)',
  borderColor: 'var(--border)',
  rowHoverColor: 'var(--muted)',
  selectedRowBackgroundColor: 'var(--accent)', // per-tab override applied via a second
                                                // .withParams() call, §2.3 — accent colour
                                                // isn't known until an instanceId exists
  wrapperBorderRadius: 0, // a blotter pane is not a floating card (§ no gratuitous rounding)
});
```

**Key decision — do not use `themeQuartz.withPart(colorSchemeDark)` for dark mode.**
AG Grid's Theming API dark mode is normally a JS-side theme swap (confirmed: `colorSchemeDark`
is a separate `Part` applied via `.withPart()`, not a CSS-cascade response). This app's dark
mode is instead a `.dark` class on an ancestor element, flipping plain CSS custom properties
(`packages/ui/src/index.css`'s existing `:root`/`.dark` blocks). Since every colour param
above is a `var(--token)` string — confirmed passthrough: AG Grid's `ColorValue` type is
`string | {ref, mix, onto}` and a plain string is emitted into the generated CSS verbatim,
not resolved at JS-build time — the grid's colours **already** follow `.dark` for free,
the moment `--background`/`--foreground`/etc. flip, with no `setGridOption('theme', ...)`
call, no re-render, no theme-swap flicker. One `blotterTheme` object serves both modes.

Per-tab accent (§2.3) is the one param that genuinely needs a JS-side value per instance
(it depends on `instanceId`, not on light/dark), so it's layered on with a second call at
the call site, memoized on `instanceId`:
```ts
const theme = useMemo(
  () => blotterTheme.withParams({ selectedRowBackgroundColor: `var(--accent-${tabAccent(instanceId)}-3)` }),
  [instanceId],
);
```

---

## 6. Footer / status bar

Current: `"256 rows · window 0–2,000 loaded · 0/s · last tick 1s ago"` in `tab-footer.tsx`
— keep this exact information hierarchy (it's correct and load-bearing per plan §4/§5), but
tighten the visual treatment:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 24,481 rows  │  window 0–2,000 loaded  │  812/s  │  last tick 0s ago      │
└──────────────────────────────────────────────────────────────────────────┘
```

- Keep `Separator` (vertical, already used) between the four segments — don't replace with
  a middle-dot/pipe string; a real `Separator` element is more legible and is already the
  codebase's own convention here.
- **"rows" vs. "window …loaded" stay visually distinct weights**: rows count in
  `text-foreground font-medium` (it's the answer to "how big is this?"), the window clause
  in `text-muted-foreground` (it's a qualifier, "but here's what's actually on screen").
  This is the concrete rendering of "that distinction... must stay legible" — weight, not
  colour, so it survives colourblind rendering too.
- **Idle-is-expected state** (already partly built — `tab-footer.tsx`'s
  `isIdleExpected`/`IDLE_THRESHOLD_MS`, currently 15s for demo purposes, real threshold per
  plan is "~10 minutes"): keep the existing `Badge variant="outline"` + `Tooltip`
  combination, but change the badge's copy from `idle 45s ago` to **`quiet · 45s`** — "idle"
  reads as a fault state at a glance (matches "idle" ConnState-adjacent vocabulary users may
  associate with connection trouble); "quiet" is neutral and matches the tooltip's own
  framing ("quiet is expected here"). Tooltip copy unchanged (already correct: "Idle is
  expected here — a given row ticks only about once every 10 minutes.").
- Snapshot-loading phase (`stats.phase === 'snapshot'`): keep the existing
  `Badge variant="secondary">Loading` + received-count, but add a thin **indeterminate
  progress bar** (a 2px `div` with a CSS `background-position` sweep animation, `~1.2s`
  linear infinite — no library, ~10 lines of CSS) along the full footer width while
  `phase === 'snapshot'`. Numbers alone ("14,203 rows received") don't communicate "this is
  still going" as fast as motion does, and a real progress bar isn't possible (total isn't
  known until `group_end` for the snapshot itself, though `rowCountHint` from
  `projectDetailRowCount` — already computed, plan §4 — *is* known up front for the Details
  grid specifically: use it as a determinate bar there — `received / rowCountHint` — and
  fall back to indeterminate only for the Orders grid's own snapshot, where no such hint
  exists).

---

## 7. Connection states

`connection-banner.tsx`'s state → copy mapping and its "stay silent on `open`" behaviour are
both correct and unchanged. Visual refinement:

| state | `Alert` variant | icon | copy |
|---|---|---|---|
| `idle` | default | — | "Not connected" |
| `connecting` | default | spinner (`lucide-react`'s `Loader2`, already a transitive dep via other shadcn components — spin via Tailwind's `animate-spin`) | "Connecting…" |
| `open` | — (silent, unchanged) | — | — |
| `reconnecting` | default, but with `border-l-4 border-l-[var(--status-partial-text)]` (reuses the amber "in-progress" semantic, §4.2 — not a new colour) | spinner | "Reconnecting…" |
| `closed` | default | — | "Disconnected" |
| `failed` | destructive (unchanged) | `AlertCircle` | "Connection failed" |

- **Toasts for errors** (the `error` worker event, plan §3): wire the already-vendored
  `Toaster`/`sonner` — currently imported into `@amps-ui/ui` but not mounted anywhere in
  `shell.tsx`. Add `<Toaster position="bottom-right" />` once at the `Shell` root (sibling
  to `ConnectionBanner`), and call `toast.error(event.message)` from wherever `error` events
  are currently only logged (find that call site in M5's robustness work — this spec
  doesn't relocate it, just specifies the toast's shape). One toast per distinct `subId`
  error, not one per retry — dedupe on `(subId, code)` within a short window so a repeatedly
  failing subscription doesn't spam the corner.
- **Reconnect banner should not block interaction** — `Alert` here is a thin top strip
  (already `rounded-none border-x-0 border-t-0`), not a modal/`Dialog`. A trader should be
  able to keep scrolling/selecting in a degraded-but-still-showing-stale-data grid while
  reconnection is in flight; nothing in this spec changes that (the grids stay mounted with
  their last-known rows during `reconnecting`, per plan §5).

---

## 8. Empty and loading states

### 8.1 No selection yet (Details pane)

`OrderDetailsGrid`'s existing bare-text empty state:
```
Select one or more orders to see their details.
```
Replace with a slightly more oriented version, still text-only (no illustration — a
trading blotter's empty states should look like "nothing selected," not like a marketing
placeholder):
```
No orders selected
Select rows in [● Orders] to see their execution detail here.
```
where `[● Orders]` is the same accent-dot + name treatment as §2.2's "Following" chip,
naming the *specific* Orders tab this pane is paired to (or, if severed/independent, the
generic word "an Orders tab"). This reuses the exact colour link from §2 rather than
introducing new empty-state chrome.

### 8.2 Snapshot loading

Already covered in §6 (the footer's progress treatment). Additionally: while
`status.loading` is true on a **first-ever** load (`rowCount === undefined`, no prior rows
to show), the grid area itself should not render a fully blank `AgGridReact` — use the
**new `Skeleton` component** (§9) to render ~10 placeholder rows matching the real column
widths (reuse `columnDefs` for widths, render them as plain `<div>` strips, not real AG
Grid rows — cheap, no grid instantiation cost). Once `snapshot.complete` fires, swap to the
real grid. This only applies to a genuinely first load; a selection change on an
**already-populated** Details grid keeps showing the old rows per the existing "no blank
grid between selections" rule (plan §4) — the skeleton is for "nothing has ever loaded here
yet," not for every debounce cycle.

### 8.3 Selection large enough that it's still streaming

The plan's window model (`WINDOW_ROWS = 2,000`, AMPS-paginated, plan §4) means even a
1,000-order/1.49M-row selection loads its *first* window in ~50–500ms (measured) — so
"still streaming" in the sense of a stalled UI shouldn't actually occur. What *will* occur
regularly: the true total (`rows` in the footer) being far larger than the loaded window.
Design for that as the steady state, not an edge case:
- Footer already shows both numbers (§6) — that's the primary signal.
- Add one `Tooltip` on the row-count segment itself (reusing the existing `Tooltip`
  primitive, no new component) when `rowCount > loadedWindow[1]`: *"Showing rows
  0–2,000 of 24,481. Scroll to load more."* — turns the footer's own numbers into an
  explanation rather than requiring the trader to infer "window" means "not everything."
- **No separate "large selection" banner/dialog.** Plan §4/D5 explicitly withdrew the
  size-guard concept — "Nothing is ever refused" — and a banner announcing "large selection
  detected" would resurrect that framing visually even though the mechanism (guard) is
  gone. The footer tooltip is enough because the window/repage behaviour is transparent and
  non-blocking by construction.

---

## 9. New components

Two additions to `@amps-ui/ui`, both plain shadcn `add`-able components, both justified by
a concrete use above rather than spec-for-its-own-sake:

1. **`Skeleton`** (§8.2) — shadcn's standard component, one file, no new runtime dependency
   (it's a styled `div` with a shimmer animation using the existing `tw-animate-css` import
   already in `index.css`). `bunx shadcn@latest add skeleton` against the same throwaway
   scratch-Vite pattern `components.json`'s provenance comment describes, then hand-rewrite
   the `@/...` import the same way every other vendored component already was.
2. **`DropdownMenu`** is **not new** — already vendored — but is newly *used* here for the
   "Change ▾" source picker (§2.2) and could be reused later for the Details tab's sort-
   field picker if `blockedFieldsMessage` (existing `feature-order-details` component) ever
   grows an alternative-field suggestion UI. No action needed beyond using what's there.

Nothing else needs adding. `Alert`, `Badge`, `Button`, `Separator`, `Tooltip`, `Toaster` all
already exist and are used above exactly as designed for.

---

## 10. Summary of things flagged as unverified

Carried forward explicitly, per the brief's ask — do not treat these as settled:

1. **§3.3** — header column groups (two-row header) against the Viewport row model in
   ag-grid 36.1.0. Likely fine (header grouping ≠ row grouping) but not confirmed against
   this exact version; test in a throwaway grid before committing the two-row header.
2. **§3.4** — the exact `themeQuartz.withParams()` parameter name (if any) for the
   data-changed cell-flash colour in ag-grid-community 36.1.0. A CSS-class fallback is
   specified and will work regardless; prefer the theme param if one exists so dark mode
   flips it for free like every other colour in §5.
3. **§5** — `ColorValue` accepting a `var(--token)` string and having it resolve live via
   CSS cascade (not baked in at theme-object-construction time) is confirmed by the
   Theming API's own type (`ColorValue = string | {...}`, passthrough confirmed in source),
   but hasn't been visually verified end-to-end with this app's actual `.dark` class toggle
   in a browser. Do that check early in implementation — if it doesn't work as expected,
   the fallback is `setGridOption('theme', mode === 'dark' ? darkTheme : lightTheme)` on a
   dark-mode-context change, which is confirmed to work (`setGridOption('theme', ...)` is a
   documented, supported runtime theme swap) but costs a re-render on toggle.
4. **§6** — the AG Grid Enterprise no-key watermark's exact placement/timing wasn't
   re-verified for 36.1.0 in this pass (plan §8 D1 already accepted it, unstyled). This spec
   assumes it can overlay grid rows periodically and designs around that by keeping all
   custom interactive chrome (toolbars, footer, toasts) **outside** the `AgGridReact`-owned
   DOM node, never floated on top of it — verify the watermark doesn't also render into the
   footer/toolbar strips (it shouldn't, since those are sibling elements, not overlays
   AG Grid itself controls, but confirm visually).

---

## 11. Resolutions to §10, checked against the installed packages

Verified directly against
`node_modules/.bun/ag-grid-community@36.1.0/node_modules/ag-grid-community/dist/types`,
not from docs or memory. Do not re-investigate these.

### §10.2 — flash colour theme param: **RESOLVED — no such param exists. Use the CSS fallback.**

Exhaustive grep of the shipped type definitions finds only:
- `cellFlashDuration` (grid option, default 500ms)
- `cellFadeDuration` (grid option, default 1000ms)
- `cellFlashService` / `cellFlashSvc` (internal services)
- `flashCells(params)` / `FlashCellsParams` (imperative API)

There is **no** `themeQuartz.withParams()` colour parameter for the data-changed flash — every
theming type lives under `dist/types/src/theming/` and none mentions flash. So §3.4's fallback is
the only route:

```css
.amps-grid .ag-cell-data-changed { background-color: var(--flash-9); }
.amps-grid .ag-cell-data-changed-animation {
  transition: background-color var(--ag-cell-fade-duration, 1000ms);
}
```

Scope it under the grid wrapper class as §3.4 says. Because this is a plain CSS custom property, it
follows the `.dark` class for free, exactly like the themed params — so the dark-mode story in §5 is
unaffected. Keep the 500ms/1000ms defaults; the MutationObserver check that confirmed flashing works
(plan §10 C4) assumed them.

### §10.3 — `ColorValue`: partially resolved

`ColorValue` is re-exported from the `ag-stack` package (`theming/parts/theme/themes.d.ts:1`), not
defined in `ag-grid-community` itself. The spec's source-level confirmation stands, but verify the
`var(--token)` passthrough in a browser **early** in implementation, before wiring every colour
param to it. The documented fallback — `setGridOption('theme', ...)` on dark-mode toggle — is
confirmed supported and costs only a re-render.

### §10.1 and §10.4 — still open

Header column groups under the Viewport row model, and the licence watermark's placement, still need
a visual check. Both are cheap to confirm once the layout is running.

### §10.1 — header column groups under the Viewport row model: **RESOLVED — safe to use.**

The concern conflated two different features. **Row grouping** (`rowGroup: true`, group nodes,
aggregation) is genuinely unsupported by the Viewport row model. **Header/column grouping**
(`ColGroupDef` with `children`, producing a two-row header) is a pure column-definition concern:
`ColGroupDef` lives in `entities/colDef.d.ts` and `iViewportDatasource.d.ts` has no reference to
grouping of any kind. The datasource only ever answers "what rows are in this index range" — it has
no say in how the header is structured.

So §3.3's two-row header is safe. Only §10.4 (licence watermark placement) remains open, and that is
a look-at-it check once the layout renders.
