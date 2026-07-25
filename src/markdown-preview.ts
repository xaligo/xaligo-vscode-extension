import { promises as fs } from "node:fs";
import path from "node:path";
import type { MarkdownPreviewAsset } from "./preview-contract";

export interface RenderedMarkdownPreview {
  source: string;
  assets: MarkdownPreviewAsset[];
}

export async function readRenderedMarkdownPreview(
  markdownPath: string,
  svgDirectory: string
): Promise<RenderedMarkdownPreview> {
  let source = await fs.readFile(markdownPath, "utf8");
  const entries = (await fs.readdir(svgDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".svg")
    .sort((left, right) => left.name.localeCompare(right.name));
  const assets: MarkdownPreviewAsset[] = [];

  for (const [index, entry] of entries.entries()) {
    const svgPath = path.join(svgDirectory, entry.name);
    const relativePath = path
      .relative(path.dirname(markdownPath), svgPath)
      .split(path.sep)
      .join("/");
    const generatedReference = `![](${relativePath})`;
    if (!source.includes(generatedReference)) {
      throw new Error(
        `The rendered Markdown did not reference generated SVG ${entry.name}.`
      );
    }

    const placeholder = `xaligo-preview-svg:asset-${index + 1}`;
    source = source.replaceAll(generatedReference, `![](${placeholder})`);
    assets.push({
      placeholder,
      svg: await fs.readFile(svgPath, "utf8")
    });
  }

  return { source, assets };
}
