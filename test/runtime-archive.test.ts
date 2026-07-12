import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import {
  createArchiveByteLimiter,
  validatePackageArchiveEntry,
  type ArchiveBudget,
  type ArchiveLimits
} from "../src/runtime-archive";

function budget(): ArchiveBudget {
  return { entryCount: 0, unpackedBytes: 0 };
}

describe("runtime package archive policy", () => {
  it("accepts ordinary npm package files and directories", () => {
    const usage = budget();
    expect(validatePackageArchiveEntry("package/", "Directory", 0, usage)).toBe(true);
    expect(validatePackageArchiveEntry("package/etc/app.yaml", "File", 128, usage)).toBe(true);
    expect(usage).toEqual({ entryCount: 2, unpackedBytes: 128 });
  });

  it.each([
    "../outside",
    "package/../../outside",
    "/package/outside",
    "package\\outside",
    "other/file"
  ])("rejects unsafe archive path %s", (entryPath) => {
    expect(() => validatePackageArchiveEntry(entryPath, "File", 1, budget())).toThrow(/unsafe path/);
  });

  it.each(["SymbolicLink", "Link", "CharacterDevice", "BlockDevice"])(
    "rejects unsupported %s entries",
    (entryType) => {
      expect(() => validatePackageArchiveEntry(
        "package/link",
        entryType,
        0,
        budget()
      )).toThrow(/unsupported/);
    }
  );

  it("enforces entry count and unpacked byte limits", () => {
    const limits: ArchiveLimits = { maximumEntries: 1, maximumUnpackedBytes: 4 };
    const countUsage = budget();
    validatePackageArchiveEntry("package/one", "File", 1, countUsage, limits);
    expect(() => validatePackageArchiveEntry(
      "package/two",
      "File",
      1,
      countUsage,
      limits
    )).toThrow(/limits/);
    expect(() => validatePackageArchiveEntry(
      "package/large",
      "File",
      5,
      budget(),
      limits
    )).toThrow(/limits/);
  });

  it("limits all decompressed tar bytes, including metadata headers", async () => {
    await expect(pipeline(
      Readable.from([Buffer.alloc(3), Buffer.alloc(3)]),
      createArchiveByteLimiter(5),
      new Writable({ write(_chunk, _encoding, callback) { callback(); } })
    )).rejects.toThrow(/decompressed byte limit/);
  });
});
