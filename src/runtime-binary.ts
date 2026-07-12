import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

const minimumNativeBinaryBytes = 1024 * 1024;

export async function verifyRuntimeBinary(
  binaryPath: string,
  platform = process.platform,
  expectedDigest?: string,
  minimumBytes = minimumNativeBinaryBytes
): Promise<boolean> {
  try {
    const info = await fs.stat(binaryPath);
    if (!info.isFile() || info.size < minimumBytes) {
      return false;
    }
    if (platform !== "win32") {
      await fs.access(binaryPath, fs.constants.X_OK);
    }
    const handle = await fs.open(binaryPath, "r");
    const header = Buffer.alloc(4);
    try {
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== header.length || !hasNativeExecutableHeader(header, platform)) {
        return false;
      }
    } finally {
      await handle.close();
    }
    return !expectedDigest || await binaryMatchesDigest(binaryPath, expectedDigest);
  } catch {
    return false;
  }
}

export function hasNativeExecutableHeader(header: Buffer, platform: NodeJS.Platform): boolean {
  const hex = header.toString("hex");
  if (platform === "win32") {
    return hex.startsWith("4d5a");
  }
  if (platform === "linux") {
    return hex === "7f454c46";
  }
  if (platform === "darwin") {
    return ["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(hex);
  }
  return false;
}

async function binaryMatchesDigest(binaryPath: string, expectedDigest: string): Promise<boolean> {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(expectedDigest);
  if (!match) {
    return false;
  }
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(binaryPath)) {
    hash.update(chunk);
  }
  const expected = Buffer.from(match[1], "hex");
  const actual = hash.digest();
  return crypto.timingSafeEqual(expected, actual);
}
