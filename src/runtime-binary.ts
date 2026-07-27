import crypto from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

const minimumNativeBinaryBytes = 1024 * 1024;

export async function verifyRuntimeBinary(
  binaryPath: string,
  platform = process.platform,
  expectedDigest?: string,
  minimumBytes = minimumNativeBinaryBytes,
  architecture = process.arch
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
    const header = Buffer.alloc(Math.min(4_096, info.size));
    try {
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (
        bytesRead !== header.length ||
        !hasNativeExecutableHeader(header.subarray(0, 4), platform) ||
        !hasNativeExecutableArchitecture(header, platform, architecture)
      ) {
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

export function hasNativeExecutableArchitecture(
  header: Buffer,
  platform: NodeJS.Platform,
  architecture: string
): boolean {
  const expected = architecture === "x64"
    ? { pe: 0x8664, elf: 62, macho: 0x01000007 }
    : architecture === "arm64"
      ? { pe: 0xaa64, elf: 183, macho: 0x0100000c }
      : undefined;
  if (!expected) {
    return false;
  }
  if (platform === "win32") {
    if (header.length < 64) {
      return false;
    }
    const peOffset = header.readUInt32LE(0x3c);
    return peOffset + 6 <= header.length &&
      header.toString("ascii", peOffset, peOffset + 4) === "PE\u0000\u0000" &&
      header.readUInt16LE(peOffset + 4) === expected.pe;
  }
  if (platform === "linux") {
    if (
      header.length < 20 ||
      header[0] !== 0x7f ||
      header.toString("ascii", 1, 4) !== "ELF" ||
      header[4] !== 2
    ) {
      return false;
    }
    const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
    return machine === expected.elf;
  }
  if (platform === "darwin") {
    return machOArchitectures(header).includes(expected.macho);
  }
  return false;
}

function machOArchitectures(header: Buffer): number[] {
  if (header.length < 8) {
    return [];
  }
  const magic = header.subarray(0, 4).toString("hex");
  if (magic === "cffaedfe") {
    return [header.readUInt32LE(4)];
  }
  if (magic === "feedfacf") {
    return [header.readUInt32BE(4)];
  }
  if (magic !== "cafebabe" && magic !== "bebafeca") {
    return [];
  }
  const littleEndian = magic === "bebafeca";
  const readUInt32 = (offset: number) => littleEndian
    ? header.readUInt32LE(offset)
    : header.readUInt32BE(offset);
  const count = readUInt32(4);
  const architectures: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * 20;
    if (offset + 4 > header.length) {
      break;
    }
    architectures.push(readUInt32(offset));
  }
  return architectures;
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
