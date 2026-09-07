// AG Grid module registration + licence wiring for the Viewport row model
// (plan §2, D1, D7). Imported once for its side effect by `index.ts` --
// nothing else in this package should register modules a second time.
//
// Verified against ag-grid@36.1.0 docs (plan D7 -- "verify, don't assume"):
// - `ViewportRowModelModule` is ENTERPRISE (`ag-grid-enterprise`).
// - `HighlightChangesModule` (cell flash) and `CellStyleModule` (the style
//   application the flash animation depends on -- AG Grid's own Viewport +
//   cell-flash example registers both together) are both COMMUNITY
//   (`ag-grid-community`). This resolves D7: cell flash does NOT require an
//   enterprise licence on its own, only the viewport row model itself does.
// Registered globally via `ModuleRegistry.registerModules` (still supported
// in 36.1.0 alongside the newer `AgGridProvider` wrapper) so `<ViewportGrid>`
// stays a plain component -- consumers don't have to wrap their app in a
// provider just to use it.
import {
  CellStyleModule,
  HighlightChangesModule,
  ModuleRegistry,
  enableDevValidations,
} from 'ag-grid-community';
import { LicenseManager, ViewportRowModelModule } from 'ag-grid-enterprise';

if (import.meta.env?.DEV) {
  enableDevValidations();
}

// D1: no licence key exists yet -- the watermark is accepted. Wiring this
// up now means a real key can be dropped into `VITE_AG_GRID_LICENSE_KEY`
// later with no code change; unset, this is a no-op.
const licenseKey = import.meta.env?.VITE_AG_GRID_LICENSE_KEY;
if (licenseKey) {
  LicenseManager.setLicenseKey(licenseKey);
}

ModuleRegistry.registerModules([ViewportRowModelModule, HighlightChangesModule, CellStyleModule]);
