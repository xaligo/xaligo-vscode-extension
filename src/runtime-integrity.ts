import crypto from "node:crypto";

export function verifySubresourceIntegrity(bytes: Buffer, integrity: string): void {
  const candidates = integrity.trim().split(/\s+/);
  const sha512 = candidates.find((candidate) => candidate.startsWith("sha512-"));
  if (!sha512) {
    throw new Error("The npm package does not provide SHA-512 integrity metadata.");
  }
  const expected = Buffer.from(sha512.slice("sha512-".length), "base64");
  const actual = crypto.createHash("sha512").update(bytes).digest();
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("The npm package integrity check failed.");
  }
}

export function verifyDigest(bytes: Buffer, digest: string): void {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest);
  if (!match) {
    throw new Error("The release asset does not provide a valid SHA-256 digest.");
  }
  const expected = Buffer.from(match[1], "hex");
  const actual = crypto.createHash("sha256").update(bytes).digest();
  if (!crypto.timingSafeEqual(expected, actual)) {
    throw new Error("The xaligo binary integrity check failed.");
  }
}
