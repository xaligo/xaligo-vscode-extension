import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasNativeExecutableArchitecture,
  hasNativeExecutableHeader,
  verifyRuntimeBinary
} from "../src/runtime-binary";

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
    const bytes = Buffer.alloc(36);
    Buffer.from("7f454c46", "hex").copy(bytes);
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(62, 18);
    try {
      await fs.writeFile(binaryPath, bytes, { mode: 0o755 });
      const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
      await expect(verifyRuntimeBinary(binaryPath, "linux", digest, 4, "x64")).resolves.toBe(true);
      await expect(verifyRuntimeBinary(
        binaryPath,
        "linux",
        `sha256:${"0".repeat(64)}`,
        4,
        "x64"
      )).resolves.toBe(false);
      await fs.chmod(binaryPath, 0o644);
      await expect(verifyRuntimeBinary(binaryPath, "linux", digest, 4, "x64")).resolves.toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a native executable built for another architecture", () => {
    const elf = Buffer.alloc(64);
    Buffer.from("7f454c46", "hex").copy(elf);
    elf[4] = 2;
    elf[5] = 1;
    elf.writeUInt16LE(183, 18);
    expect(hasNativeExecutableArchitecture(elf, "linux", "arm64")).toBe(true);
    expect(hasNativeExecutableArchitecture(elf, "linux", "x64")).toBe(false);

    const pe = Buffer.alloc(256);
    Buffer.from("4d5a", "hex").copy(pe);
    pe.writeUInt32LE(128, 0x3c);
    pe.write("PE\u0000\u0000", 128, "ascii");
    pe.writeUInt16LE(0x8664, 132);
    expect(hasNativeExecutableArchitecture(pe, "win32", "x64")).toBe(true);
    expect(hasNativeExecutableArchitecture(pe, "win32", "arm64")).toBe(false);
  });
});
