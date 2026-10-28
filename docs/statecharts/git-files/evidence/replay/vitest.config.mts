import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const REPO = "<repo>";
// 外部配置：只跑 /tmp 下的回放测试，缓存也放在 /tmp，不写仓库。
export default defineConfig({
  root: REPO,
  cacheDir: "<scratch>/git-files/replay/.vite-cache",
  plugins: [react()],
  server: { fs: { strict: false } },
  test: {
    include: ["<scratch>/git-files/replay/*.test.tsx"],
    setupFiles: [`${REPO}/src/test/setupLocale.ts`],
    environment: "jsdom",
    testTimeout: 30000,
  },
});
