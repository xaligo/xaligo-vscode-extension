import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiffArguments,
  buildGenerateXalArguments,
  buildMarkdownRenderArguments,
  buildRenderArguments,
  createTemporaryOutputDirectory,
  diffOutputPaths,
  isMarkdownFilePath,
  parseCommandWarnings,
  parseDiffSummary,
  parseRenderedOutputPaths,
  renderedOutputPaths,
  replaceExtension
} from "../src/xaligo-command";

describe("xaligo command contracts", () => {
  it("recognizes Markdown preview source paths", () => {
    expect(isMarkdownFilePath("guide.md")).toBe(true);
    expect(isMarkdownFilePath("GUIDE.MARKDOWN")).toBe(true);
    expect(isMarkdownFilePath("diagram.xal")).toBe(false);
  });

  it("builds Markdown preview assets without sizing embedded SVGs as pages", () => {
    expect(buildMarkdownRenderArguments(
      "guide.md",
      "/tmp/preview/document.md",
      "/tmp/preview/assets"
    )).toEqual([
      "render",
      "markdown",
      "guide.md",
      "--output",
      "/tmp/preview/document.md",
      "--svg-dir",
      "/tmp/preview/assets"
    ]);
    expect(buildMarkdownRenderArguments(
      "guide.md",
      "/tmp/preview/document.md",
      "/tmp/preview/assets",
      { servicesPath: "services.csv" }
    )).toEqual([
      "render",
      "markdown",
      "guide.md",
      "--output",
      "/tmp/preview/document.md",
      "--svg-dir",
      "/tmp/preview/assets",
      "--services",
      "services.csv"
    ]);
  });

  it("passes services only to render", () => {
    expect(buildRenderArguments("source.xal", "preview.svg", "svg", "services.csv")).toEqual([
      "render",
      "source.xal",
      "--format",
      "svg",
      "-o",
      "preview.svg",
      "--services",
      "services.csv"
    ]);
    expect(buildDiffArguments("before.xal", "after.xal", "/tmp/architecture")).toEqual([
      "diff",
      "before.xal",
      "after.xal",
      "--output",
      "/tmp/architecture"
    ]);
  });

  it("combines preview frames so cross-frame page links share one SVG", () => {
    expect(buildRenderArguments("source.xal", "preview.svg", "svg", {
      combineFrames: true,
      servicesPath: "services.csv"
    })).toEqual([
      "render",
      "source.xal",
      "--format",
      "svg",
      "-o",
      "preview.svg",
      "--services",
      "services.csv",
      "--combine-frames"
    ]);
  });

  it("derives the two structural diff image paths", () => {
    expect(diffOutputPaths(path.join("tmp", "architecture.SVG"))).toEqual([
      path.join("tmp", "architecture-removed.svg"),
      path.join("tmp", "architecture-added.svg")
    ]);
  });

  it("supplies generation defaults required by older bundled runtimes", () => {
    expect(buildGenerateXalArguments("architecture.xal")).toEqual([
      "generate",
      "xal",
      "--clouds",
      "1",
      "--accounts",
      "1",
      "--regions",
      "1",
      "--azs",
      "2",
      "--az-layout",
      "grid",
      "--subnets",
      "2",
      "--spacing",
      "both",
      "--start",
      "top",
      "--paper",
      "A4",
      "--orientation",
      "landscape",
      "--output",
      "architecture.xal"
    ]);
  });

  it("parses the CLI structural change summary", () => {
    expect(parseDiffSummary("changes: +12 -3 ~4")).toEqual({
      added: 12,
      removed: 3,
      modified: 4
    });
    expect(parseDiffSummary("render complete")).toBeUndefined();
  });

  it("reads ordered render paths and warnings from structured logs", () => {
    const output = [
      JSON.stringify({
        level: "INFO",
        code: "ICRRR-005",
        fields: { output: "/tmp/preview-overview.svg" }
      }),
      JSON.stringify({
        level: "WARN",
        code: "IUPP-018",
        message: "legacy root"
      }),
      JSON.stringify({
        level: "INFO",
        code: "ICRRR-005",
        fields: { output: "/tmp/preview-detail.svg" }
      })
    ].join("\n");
    expect(parseRenderedOutputPaths(output)).toEqual([
      "/tmp/preview-overview.svg",
      "/tmp/preview-detail.svg"
    ]);
    expect(parseCommandWarnings(output)).toEqual(["IUPP-018: legacy root"]);
  });

  it("preserves structured source order for multi-frame render artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-output-paths-"));
    const overview = path.join(root, "preview-overview.svg");
    const detail = path.join(root, "preview-detail.svg");
    try {
      await Promise.all([
        fs.writeFile(overview, "<svg/>"),
        fs.writeFile(detail, "<svg/>")
      ]);
      const stdout = [
        JSON.stringify({ code: "ICRRR-005", fields: { output: overview } }),
        JSON.stringify({ code: "ICRRR-005", fields: { output: detail } })
      ].join("\n");
      await expect(renderedOutputPaths(
        path.join(root, "preview.svg"),
        { stdout, stderr: "" },
        Date.now()
      )).resolves.toEqual([overview, detail]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("replaces only the final file extension", () => {
    expect(replaceExtension(path.join("docs.v1", "diagram.xal"), "svg")).toBe(
      path.join("docs.v1", "diagram.svg")
    );
  });

  it("allocates collision-free output directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "xaligo-extension-test-"));
    try {
      const [left, right] = await Promise.all([
        createTemporaryOutputDirectory(root, "same-input"),
        createTemporaryOutputDirectory(root, "same-input")
      ]);
      expect(left).not.toBe(right);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
