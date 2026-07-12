import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasNativeExecutableHeader, verifyRuntimeBinary } from "../src/runtime-binary";

describe("native runtime binary health", () => {
  it("recognizes supported native executable headers", () => {
    expect(hasNativeExecutableHeader(Buffer.from("7f454c46", "hex"), "linux")).toBe(true);
    expect(hasNativeExecutableHeader(Buffer.from("cffaedfe", "hex"), "darwin")).toBe(true);
    expect(hasNativeExecutableHeader(Buffer.from("4d5a0000", "hex"), "win32")).toBe(true);
    expect(hasNativeExecutableHeader(Buffer.from("23212f62", "hex"), "linux")).toBe(false);
  });

  it("checks executable permission and the recorded managed digest", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-runtime-binary-"));
    const binaryPath = path.join(root, "xaligo");
    const bytes = Buffer.concat([Buffer.from("7f454c46", "hex"), Buffer.alloc(32)]);
    try {
      await fs.writeFile(binaryPath, bytes, { mode: 0o755 });
      const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
      await expect(verifyRuntimeBinary(binaryPath, "linux", digest, 4)).resolves.toBe(true);
      await expect(verifyRuntimeBinary(binaryPath, "linux", `sha256:${"0".repeat(64)}`, 4)).resolves.toBe(false);
      await fs.chmod(binaryPath, 0o644);
      await expect(verifyRuntimeBinary(binaryPath, "linux", digest, 4)).resolves.toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
