import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRenderedMarkdownPreview } from "../src/markdown-preview";

describe("Markdown preview document", () => {
  it("replaces only CLI-generated SVG references with Webview asset placeholders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "xaligo-markdown-preview-"));
    const svgDirectory = path.join(root, "assets");
    const markdownPath = path.join(root, "document.md");
    const imageDirectory = path.join(root, "images");
    try {
      await Promise.all([mkdir(svgDirectory), mkdir(imageDirectory)]);
      await Promise.all([
        writeFile(
          markdownPath,
          "# Guide\n\n![](<assets/guide-1.svg>)\n\n![External](images/photo.png)\n"
        ),
        writeFile(
          path.join(svgDirectory, "guide-1.svg"),
          '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>'
        ),
        writeFile(path.join(imageDirectory, "photo.png"), Buffer.from("89504e470d0a1a0a", "hex"))
      ]);

      const preview = await readRenderedMarkdownPreview(markdownPath, svgDirectory);

      expect(preview.source).toContain("![](xaligo-preview-svg:asset-1)");
      expect(preview.source).toContain("![External](xaligo-preview-image:asset-2)");
      expect(preview.source).not.toContain("assets/guide-1.svg");
      expect(preview.assets).toEqual([
        {
          placeholder: "xaligo-preview-svg:asset-1",
          mediaType: "image/svg+xml",
          data: Buffer.from(
            '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>'
          ).toString("base64")
        },
        {
          placeholder: "xaligo-preview-image:asset-2",
          mediaType: "image/png",
          data: Buffer.from("89504e470d0a1a0a", "hex").toString("base64")
        }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps HTTPS images and embeds percent-encoded local image paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "xaligo-markdown-preview-"));
    const svgDirectory = path.join(root, "assets");
    const markdownPath = path.join(root, "document.md");
    const sourcePath = path.join(root, "source", "guide.md");
    try {
      await Promise.all([
        mkdir(svgDirectory),
        mkdir(path.join(root, "source", "images"), { recursive: true })
      ]);
      await Promise.all([
        writeFile(
          markdownPath,
          "![Local](<images/my%20image.webp>)\n![Remote](https://example.com/image.png)\n"
        ),
        writeFile(path.join(root, "source", "images", "my image.webp"), "webp")
      ]);
      const preview = await readRenderedMarkdownPreview(markdownPath, svgDirectory, sourcePath);
      expect(preview.source).toContain("![Local](xaligo-preview-image:asset-1)");
      expect(preview.source).toContain("![Remote](https://example.com/image.png)");
      expect(preview.assets[0]).toMatchObject({ mediaType: "image/webp" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("matches an unwrapped, unescaped SVG reference as a fallback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "xaligo-markdown-preview-"));
    const svgDirectory = path.join(root, "assets");
    const markdownPath = path.join(root, "document.md");
    try {
      await mkdir(svgDirectory);
      await Promise.all([
        writeFile(markdownPath, "# Guide\n\n![](assets/guide-1.svg)\n"),
        writeFile(
          path.join(svgDirectory, "guide-1.svg"),
          '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>'
        )
      ]);

      const preview = await readRenderedMarkdownPreview(markdownPath, svgDirectory);

      expect(preview.source).toContain("![](xaligo-preview-svg:asset-1)");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the MIT Vue Markdown renderer with raw HTML disabled", async () => {
    const appSource = await readFile(
      new URL("../src/webview/App.vue", import.meta.url),
      "utf8"
    );
    expect(appSource).toContain('from "vue-markdown-render"');
    expect(appSource).toContain("html: false");
    expect(appSource).toContain(
      '<VueMarkdown :source="markdownSource" :options="markdownOptions" />'
    );
    expect(appSource).not.toContain("<iframe");
    expect(appSource).not.toContain("v-html");
  });

  it("keeps Markdown outside the draggable diagram stage and fills the viewport", async () => {
    const [appSource, previewStyles] = await Promise.all([
      readFile(new URL("../src/webview/App.vue", import.meta.url), "utf8"),
      readFile(new URL("../media/preview.css", import.meta.url), "utf8")
    ]);

    expect(appSource).toMatch(
      /v-if="state\.mode === 'markdown'"[\s\S]*?class="markdown-fullscreen-view"/
    );
    expect(appSource).toContain('<section v-else ref="stageRef" class="stage"');
    expect(appSource).toContain(
      'v-if="state.mode !== \'markdown\'" class="zoom-controls"'
    );
    expect(previewStyles).toMatch(
      /\.markdown-fullscreen-view\s*\{[\s\S]*?\binset:\s*0;/
    );
    expect(previewStyles).toMatch(
      /\.markdown-fullscreen-view\s*\{[\s\S]*?\boverflow:\s*auto;/
    );
    expect(previewStyles).toContain(".markdown-page-sheet");
  });

  it("renders generated SVGs without border or shadow decoration", async () => {
    const previewStyles = await readFile(
      new URL("../media/preview.css", import.meta.url),
      "utf8"
    );

    expect(previewStyles).toMatch(
      /\.markdown-document img\[src\^="blob:"\]\s*\{[^}]*\bborder:\s*0;[^}]*\bbox-shadow:\s*none;[^}]*\}/
    );
  });
});
