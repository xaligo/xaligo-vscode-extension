import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDigest, verifySubresourceIntegrity } from "../src/runtime-integrity";

const payload = Buffer.from("verified xaligo runtime", "utf8");

describe("runtime package integrity", () => {
  it("accepts the matching npm SHA-512 SRI value", () => {
    const integrity = `sha512-${crypto.createHash("sha512").update(payload).digest("base64")}`;
    expect(() => verifySubresourceIntegrity(payload, integrity)).not.toThrow();
  });

  it("rejects a missing SHA-512 algorithm or changed payload", () => {
    const integrity = `sha512-${crypto.createHash("sha512").update(payload).digest("base64")}`;
    expect(() => verifySubresourceIntegrity(payload, "sha256-deadbeef")).toThrow(/SHA-512/);
    expect(() => verifySubresourceIntegrity(Buffer.from("changed"), integrity)).toThrow(/integrity/);
  });
});

describe("runtime binary integrity", () => {
  it("accepts the matching GitHub Release SHA-256 digest", () => {
    const digest = `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
    expect(() => verifyDigest(payload, digest)).not.toThrow();
  });

  it("rejects malformed digests and changed binaries", () => {
    const digest = `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
    expect(() => verifyDigest(payload, "sha256:abc")).toThrow(/valid SHA-256/);
    expect(() => verifyDigest(Buffer.from("changed"), digest)).toThrow(/integrity/);
  });
});
