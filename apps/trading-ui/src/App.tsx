import { M2Slice } from './m2-slice';
// M3B mounts the tab shell here (plan §7 M3B). M2's bare page -- one
// hardcoded worker -> AMPS -> viewport grid slice, no tabs, no shadcn --
// already did its job (proving that path end to end) and is superseded by
// the shell; M3C/M4 wire real grids into the shell's tab factory
// (`shell/shell-layout.tsx`) in place of today's placeholder panels.
import { PerfPage } from './perf';
import { Shell } from './shell';

// `?m2` renders the M2 verification slice instead of the shell. Dev-only
// escape hatch so the worker -> AMPS -> viewport grid path stays observable
// in isolation until QA closes the M2 gate (plan §10 C4). Remove with
// `m2-slice.tsx` once signed off.
//
// `?perf` renders the M6 performance probe (plan §6/M6, `perf/perf-page.tsx`)
// instead of the shell -- same dev-only-route pattern as `?m2`, so the probe
// is reachable in isolation without any of flexlayout's tab machinery.
export function App() {
  if (typeof location !== 'undefined' && location.search.includes('perf')) {
    return <PerfPage />;
  }
  if (typeof location !== 'undefined' && location.search.includes('m2')) {
    return <M2Slice />;
  }
  return <Shell />;
}
