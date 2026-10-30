// Test-only config. It exists so `tests/setup/art-cache-dir.ts` runs before every test file,
// pointing the generated-art cache at a throwaway folder instead of the checkout's
// public/art/gen (bead cvu). `vite.config.ts` still owns the dev server and the build.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["tests/setup/art-cache-dir.ts"],
  },
});
