import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasCompleteRuntimeLayout,
  missingRuntimeFiles,
  requiredRuntimeRelativeFiles
} from "../src/runtime-layout";

describe("runtime package layout", () => {
  it("requires every renderer resource used by the native CLI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "xaligo-runtime-layout-"));
    try {
      for (const relativePath of requiredRuntimeRelativeFiles) {
        const target = path.join(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, "present");
      }
      await expect(hasCompleteRuntimeLayout(root)).resolves.toBe(true);

      await writeFile(path.join(root, "etc", "resources", "aws", "service-catalog.csv"), "");
      await expect(missingRuntimeFiles(root)).resolves.toEqual([
        path.join("etc", "resources", "aws", "service-catalog.csv")
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
