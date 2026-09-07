// The single import shim for the `amps` package (plan §2 R1 mitigation).
//
// `amps` is UMD/CommonJS with no ESM build; M0 proved fallback 1 (native ES
// module worker + `optimizeDeps.include: ['amps']`) works unmodified in both
// `bun run dev` and `bun run build && bun run preview` (see
// plan/notes/M0-worker-bundling.md). Every other file in this package (and
// in `@amps-ui/data-worker`) imports `Client`/`Command` from here, never
// from `'amps'` directly, so a future fallback swap is a one-file change.
export { Client, Command } from 'amps';
