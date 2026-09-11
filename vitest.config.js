import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Two projects:
//  - "app": loads public/index.html in jsdom and exercises the game rules through the page's test hook.
//  - "worker": runs src/index.js inside the Workers runtime (Miniflare) with the bindings from wrangler.jsonc.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'app',
          environment: 'node',
          include: ['test/app.test.js'],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'worker',
          include: ['test/worker.test.js'],
        },
      },
    ],
  },
});
