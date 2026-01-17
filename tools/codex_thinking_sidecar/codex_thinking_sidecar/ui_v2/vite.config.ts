import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIDECAR_ORIGIN = process.env.SIDECAR_ORIGIN || "http://127.0.0.1:8787";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const LEGACY_UI_DIR = resolve(HERE, "../ui");

export default defineConfig(({ command }) => {
  const isBuild = command === "build";
  return {
    // UI v2 作为独立实验入口：运行时由 sidecar 以 `/ui-v2/*` 提供静态资源；dev 期使用 Vite 根路径更顺手。
    base: isBuild ? "/ui-v2/" : "/",
    plugins: [vue()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      fs: {
        // 允许在开发期复用 legacy CSS（后续会逐步迁移/内联到 V2 工程）。
        allow: [LEGACY_UI_DIR],
      },
      proxy: {
        "/api": {
          target: SIDECAR_ORIGIN,
          changeOrigin: false,
        },
        // SSE：Vite proxy 会保留长连接。
        "/events": {
          target: SIDECAR_ORIGIN,
          changeOrigin: false,
        },
        "/health": {
          target: SIDECAR_ORIGIN,
          changeOrigin: false,
        },
      },
    },
    build: {
      // 注意：开发实施阶段先不默认覆盖现有 `ui/`，落地部署由单独脚本处理。
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          // 产物文件名尽量稳定，便于后续把 dist 内容提交到仓库（如决定提交）。
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  };
});
