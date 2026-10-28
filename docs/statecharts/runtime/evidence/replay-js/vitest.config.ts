import { defineConfig } from "vitest/config";
export default defineConfig({
  root: "<repo>",
  server: { fs: { strict: false } },
  test: {
    include: ["<scratch>/runtime/replay-js/*.replay.ts"],
    setupFiles: ["<repo>/src/test/setupLocale.ts"],
  },
});
