import { createReadStream } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar";

export interface ArchiveLimits {
  maximumEntries: number;
  maximumUnpackedBytes: number;
  maximumArchiveStreamBytes?: number;
  maximumMetaEntrySize?: number;
}

export interface ArchiveBudget {
  entryCount: number;
  unpackedBytes: number;
}

const defaultArchiveLimits: ArchiveLimits = {
  maximumEntries: 12_000,
  maximumUnpackedBytes: 160 * 1024 * 1024,
  maximumArchiveStreamBytes: 192 * 1024 * 1024,
  maximumMetaEntrySize: 64 * 1024
};

export async function extractPackageArchive(
  archivePath: string,
  destination: string,
  signal: AbortSignal,
  limits: ArchiveLimits = defaultArchiveLimits
): Promise<void> {
  const budget: ArchiveBudget = { entryCount: 0, unpackedBytes: 0 };
  const unpack = extract({
    cwd: destination,
    filter: (entryPath, entry) => {
      throwIfCancelled(signal);
      const entryType = "type" in entry ? entry.type : "File";
      return validatePackageArchiveEntry(entryPath, entryType, entry.size, budget, limits);
    },
    maxMetaEntrySize: limits.maximumMetaEntrySize ?? defaultArchiveLimits.maximumMetaEntrySize,
    noChmod: true,
    noMtime: true,
    preservePaths: false,
    strict: true,
    strip: 1
  });
  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    createArchiveByteLimiter(
      limits.maximumArchiveStreamBytes ?? defaultArchiveLimits.maximumArchiveStreamBytes!
    ),
    unpack,
    { signal }
  );
}

export function createArchiveByteLimiter(maximumBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        callback(new Error("The xaligo package archive exceeds the decompressed byte limit."));
        return;
      }
      callback(null, chunk);
    }
  });
}

export function validatePackageArchiveEntry(
  entryPath: string,
  entryType: string,
  entrySize: number,
  budget: ArchiveBudget,
  limits: ArchiveLimits = defaultArchiveLimits
): boolean {
  budget.entryCount += 1;
  budget.unpackedBytes += entrySize;
  if (
    !Number.isSafeInteger(entrySize) ||
    entrySize < 0 ||
    budget.entryCount > limits.maximumEntries ||
    budget.unpackedBytes > limits.maximumUnpackedBytes
  ) {
    throw new Error("The xaligo package archive exceeds the extraction limits.");
  }

  const parts = entryPath.split("/");
  if (
    entryPath.includes("\\") ||
    entryPath.includes("\0") ||
    path.posix.isAbsolute(entryPath) ||
    parts[0] !== "package" ||
    parts.some((part) => part === "..")
  ) {
    throw new Error(`The xaligo package contains an unsafe path: ${entryPath}`);
  }
  if (!["File", "OldFile", "Directory"].includes(entryType)) {
    throw new Error(`The xaligo package contains an unsupported ${entryType} entry.`);
  }
  return parts.length > 1;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error("The xaligo runtime update was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}
