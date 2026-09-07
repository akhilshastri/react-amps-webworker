import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vite';
import { sharedViteConfig } from '../../vite.config.base';

// Re-exports the root shared config (M0's worker settings) and adds the
// app-specific React plugin plus Tailwind v4 (M3B, plan §2: `@tailwindcss/vite`,
// not PostCSS). See vite.config.base.ts for why the worker settings look the
// way they do, and `@amps-ui/ui/index.css` for the Tailwind source-detection
// gotcha this plugin's scan root creates for sibling workspace packages.
export default defineConfig(
  mergeConfig(sharedViteConfig, {
    plugins: [react(), tailwindcss()],
  }),
);
