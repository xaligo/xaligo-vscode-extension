import crypto from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const script = require("../scripts/prepare-vsix-native-binaries.cjs") as {
  installTarget(options: {
    target: { platform: string; arch: string };
    name: string;
    destination: string;
    releaseUrl: string;
    downloadFile: (url: string, destination: string) => Promise<void>;
  }): Promise<{ status: string; checksum: string }>;
  parseChecksum(contents: string, expectedName: string): string;
  validateDownloadUrl(value: string): URL;
};

function peBinary(machine: number): Buffer {
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\u0000\u0000", 128, "ascii");
  bytes.writeUInt16LE(machine, 132);
  return bytes;
}

describe("VSIX native binary preparation", () => {
  it("accepts only exact checksum entries and trusted HTTPS hosts", () => {
    const digest = "a".repeat(64);
    expect(script.parseChecksum(`${digest}  xaligo-windows-amd64.exe\n`, "xaligo-windows-amd64.exe"))
      .toBe(digest);
    expect(() => script.parseChecksum(`${digest}  another.exe\n`, "xaligo-windows-amd64.exe"))
      .toThrow("invalid checksum");
    expect(script.validateDownloadUrl("https://github.com/xaligo/xaligo").hostname)
      .toBe("github.com");
    expect(() => script.validateDownloadUrl("https://example.com/xaligo")).toThrow("untrusted");
    expect(() => script.validateDownloadUrl("http://github.com/xaligo")).toThrow("untrusted");
  });

  it("replaces a stale artifact only after checksum and architecture validation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "xaligo-vsix-binary-"));
    const name = "xaligo-windows-amd64.exe";
    const destination = path.join(root, "native", name);
    const binary = peBinary(0x8664);
    const digest = crypto.createHash("sha256").update(binary).digest("hex");
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, peBinary(0xaa64));
      const result = await script.installTarget({
        target: { platform: "win32", arch: "x64" },
        name,
        destination,
        releaseUrl: "https://github.com/xaligo/xaligo/releases/download/test",
        downloadFile: async (url, output) => {
          await writeFile(
            output,
            url.endsWith(".sha256") ? `${digest}  ${name}\n` : binary
          );
        }
      });
      expect(result.status).toBe("installed");
      expect(await readFile(destination)).toEqual(binary);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
