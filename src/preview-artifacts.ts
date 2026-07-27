import { promises as fs } from "node:fs";
import path from "node:path";
import type { PreviewArtifact } from "./preview-contract";

function extractOutgoingFrameLinks(svg: string): string[] {
  const targets = new Set<string>();
  for (const match of svg.matchAll(/\bto\s+&lt;([^<>&]+)&gt;/g)) {
    const target = match[1].trim();
    if (target) {
      targets.add(target);
    }
  }
  return [...targets];
}

export async function readPreviewArtifacts(
  invocationDirectory: string,
  requestedOutputPath: string,
  orderedOutputPaths: string[] = []
): Promise<PreviewArtifact[]> {
  const requestedName = path.basename(requestedOutputPath);
  const requestedStem = path.basename(requestedOutputPath, path.extname(requestedOutputPath));
  const invocationRoot = path.resolve(invocationDirectory);
  const orderedNames = orderedOutputPaths
    .map((outputPath) => path.resolve(outputPath))
    .filter((outputPath) => path.dirname(outputPath) === invocationRoot)
    .map((outputPath) => path.basename(outputPath))
    .filter((name) => isRequestedSvgName(name, requestedName, requestedStem));
  const artifactNames = orderedNames.length > 0
    ? [...new Set(orderedNames)]
    : (await fs.readdir(invocationDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => isRequestedSvgName(name, requestedName, requestedStem))
      .sort((left, right) => left.localeCompare(right));
  if (artifactNames.length === 0) {
    throw new Error(`xaligo did not generate an SVG preview for ${requestedName}.`);
  }
  return Promise.all(artifactNames.map(async (name) => {
    const stem = path.basename(name, path.extname(name));
    const frameId = stem === requestedStem ? "preview" : stem.slice(requestedStem.length + 1);
    const svg = await fs.readFile(path.join(invocationDirectory, name), "utf8");
    return {
      id: frameId,
      title: frameId === "preview" ? "Preview" : frameId,
      svg,
      linksTo: extractOutgoingFrameLinks(svg)
    };
  }));
}

function isRequestedSvgName(name: string, requestedName: string, requestedStem: string): boolean {
  const extension = path.extname(name).toLowerCase();
  const stem = path.basename(name, extension);
  return extension === ".svg" && (name === requestedName || stem.startsWith(`${requestedStem}-`));
}
