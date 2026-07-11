import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
];

export default defineConfig({
  build: {
    lib: {
      entry: "src/extension.ts",
      formats: ["cjs"],
      fileName: () => "extension.js"
    },
    outDir: "dist/extension",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: ["vscode", ...nodeBuiltins],
      output: {
        exports: "named"
      }
    },
    target: "node18"
  }
});
