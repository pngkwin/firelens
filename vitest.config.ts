import { defineConfig } from "vitest/config";

// Wall-clock assertions depend on machine load, so they are not part of the
// `npm test` commit gate (review finding TEST-1). `npm run test:perf` runs the
// timing tests alone, one file at a time, with FIRELENS_PERF=1.
const perf = !!process.env.FIRELENS_PERF;
export default defineConfig({
  test: {
    include: perf ? ["src/data/v2/perf.test.ts", "src/data/v2/events.test.ts"] : ["src/**/*.test.ts", "convex/**/*.test.ts"],
    exclude: perf ? [] : ["src/data/v2/perf.test.ts", "**/node_modules/**"],
    fileParallelism: !perf,
    testTimeout: 30000,
  },
});
