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
    const pattern = buildGeneratedImageReferencePattern(relativePath);
    if (!pattern.test(source)) {
      throw new Error(
        `The rendered Markdown did not reference generated SVG ${entry.name}.`
      );
    }

    const placeholder = `xaligo-preview-svg:asset-${index + 1}`;
    source = source.replace(pattern, `![](${placeholder})`);
    assets.push({
      placeholder,
      svg: await fs.readFile(svgPath, "utf8")
    });
  }

  return { source, assets };
}

// The xaligo CLI's `render markdown` command always wraps the generated
// image destination in angle brackets and percent-encodes it via Go's
// `url.URL.EscapedPath`, e.g. `![](<assets/guide-1.svg>)`. Match both that
// form and a plain, unencoded destination so this stays tolerant of CLI
// output changes and of hand-authored references in test fixtures.
function buildGeneratedImageReferencePattern(relativePath: string): RegExp {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const destinations = new Set([relativePath, encoded]);
  const alternation = [...destinations].map(escapeRegExp).join("|");
  return new RegExp(`!\\[\\]\\(<?(?:${alternation})>?\\)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
