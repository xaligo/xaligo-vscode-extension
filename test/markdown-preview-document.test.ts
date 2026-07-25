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
    try {
      await mkdir(svgDirectory);
      await Promise.all([
        writeFile(
          markdownPath,
          "# Guide\n\n![](assets/guide-1.svg)\n\n![External](images/photo.png)\n"
        ),
        writeFile(
          path.join(svgDirectory, "guide-1.svg"),
          '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>'
        )
      ]);

      const preview = await readRenderedMarkdownPreview(markdownPath, svgDirectory);

      expect(preview.source).toContain("![](xaligo-preview-svg:asset-1)");
      expect(preview.source).toContain("![External](images/photo.png)");
      expect(preview.source).not.toContain("assets/guide-1.svg");
      expect(preview.assets).toEqual([{
        placeholder: "xaligo-preview-svg:asset-1",
        svg: '<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>'
      }]);
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
});
