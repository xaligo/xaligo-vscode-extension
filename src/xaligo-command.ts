import { promises as fs } from "node:fs";
import path from "node:path";
import type { DiffSummary } from "./preview-contract";

export type XaligoRenderFormat = "svg" | "pptx" | "excalidraw";

export function buildRenderArguments(
  sourcePath: string,
  outputPath: string,
  format: XaligoRenderFormat,
  servicesPath?: string
): string[] {
  const args = ["render", sourcePath, "--format", format, "-o", outputPath];
  if (servicesPath) {
    args.push("--services", servicesPath);
  }
  return args;
}

export function buildDiffArguments(beforePath: string, afterPath: string, outputPrefix: string): string[] {
  return ["diff", beforePath, afterPath, "--output", outputPrefix];
}

export function diffOutputPaths(outputPrefix: string): [string, string] {
  const extension = path.extname(outputPrefix);
  const prefix = extension.toLowerCase() === ".svg"
    ? outputPrefix.slice(0, -extension.length)
    : outputPrefix;
  return [`${prefix}-removed.svg`, `${prefix}-added.svg`];
}

export function parseDiffSummary(output: string): DiffSummary | undefined {
  const match = /changes:\s*\+(\d+)\s+-(\d+)\s+~(\d+)/i.exec(output);
  if (!match) {
    return undefined;
  }
  return {
    added: Number.parseInt(match[1], 10),
    removed: Number.parseInt(match[2], 10),
    modified: Number.parseInt(match[3], 10)
  };
}

export function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${extension}`);
}

export async function createTemporaryOutputDirectory(outputRoot: string, prefix: string): Promise<string> {
  await fs.mkdir(outputRoot, { recursive: true });
  return fs.mkdtemp(path.join(outputRoot, `${prefix}-`));
}
