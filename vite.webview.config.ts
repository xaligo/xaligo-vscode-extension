import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/webview/preview.ts",
      name: "XaligoPreviewWebview",
      formats: ["iife"],
      fileName: () => "preview.js"
    },
    outDir: "dist/webview",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: "es2022"
  }
});
