import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    lib: {
      entry: "src/webview/main.ts",
      name: "XaligoPreviewWebview",
      formats: ["iife"],
      fileName: () => "preview.js"
    },
    outDir: "dist/webview",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        assetFileNames: "preview.css"
      }
    }
  }
});
