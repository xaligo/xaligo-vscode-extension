import { describe, expect, it } from "vitest";
import {
  clampZoom,
  cliFeatures,
  defaultMarkdownPreviewSettings,
  markdownOrientations,
  markdownPageDimensionsMm,
  markdownPaperSizes,
  normalizeViewTransform,
  parseMarkdownPreviewSettings,
  previewContentChanged,
  zoomAtPoint
} from "../src/preview-contract";

describe("preview CLI features", () => {
  it("exposes every command, render format, service mode, and completion shell", () => {
    expect(cliFeatures).toEqual([
      "validate",
      "export-svg",
      "export-pptx",
      "export-excalidraw",
      "export-pdf",
      "export-excel",
      "export-xyflow",
      "export-isoflow",
      "preview-markdown",
      "serve",
      "render-markdown",
      "generate-xal",
      "add-service",
      "add-services",
      "init",
      "version",
      "help",
      "completion-bash",
      "completion-fish",
      "completion-powershell",
      "completion-zsh",
      "custom"
    ]);
  });
});

describe("Markdown preview settings", () => {
  it("defaults to A4 portrait and exposes every CLI page option", () => {
    expect(defaultMarkdownPreviewSettings).toEqual({
      paper: "A4",
      orientation: "portrait"
    });
    expect(markdownPaperSizes).toEqual([
      "auto",
      "A5",
      "A4",
      "A3",
      "A2",
      "A1",
      "Letter",
      "Legal",
      "Tabloid"
    ]);
    expect(markdownOrientations).toEqual(["auto", "portrait", "landscape"]);
  });

  it("accepts supported menu settings and rejects malformed messages", () => {
    expect(parseMarkdownPreviewSettings({
      paper: "A3",
      orientation: "landscape"
    })).toEqual({
      paper: "A3",
      orientation: "landscape"
    });
    expect(parseMarkdownPreviewSettings({
      paper: "A0",
      orientation: "landscape"
    })).toBeUndefined();
    expect(parseMarkdownPreviewSettings({
      paper: "A4",
      orientation: "sideways"
    })).toBeUndefined();
  });

  it("sizes the Markdown page independently from embedded SVG dimensions", () => {
    expect(markdownPageDimensionsMm({
      paper: "A4",
      orientation: "portrait"
    })).toEqual({ width: 210, height: 297 });
    expect(markdownPageDimensionsMm({
      paper: "A4",
      orientation: "landscape"
    })).toEqual({ width: 297, height: 210 });
    expect(markdownPageDimensionsMm({
      paper: "auto",
      orientation: "portrait"
    })).toBeUndefined();
  });
});

describe("preview zoom", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0)).toBe(0.05);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(20)).toBe(8);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("keeps the diagram point below the pointer fixed", () => {
    const before = { zoom: 1.25, panX: 40, panY: -20 };
    const pointer = { x: 360, y: 240 };
    const worldBefore = {
      x: (pointer.x - before.panX) / before.zoom,
      y: (pointer.y - before.panY) / before.zoom
    };

    const after = zoomAtPoint(before, 2.5, pointer.x, pointer.y);
    expect((pointer.x - after.panX) / after.zoom).toBeCloseTo(worldBefore.x);
    expect((pointer.y - after.panY) / after.zoom).toBeCloseTo(worldBefore.y);
  });
});

describe("persisted preview transforms", () => {
  it("accepts finite transforms and clamps their zoom", () => {
    expect(normalizeViewTransform({ zoom: 20, panX: 10, panY: -5 })).toEqual({
      zoom: 8,
      panX: 10,
      panY: -5
    });
  });

  it("rejects malformed or non-finite state", () => {
    expect(normalizeViewTransform(null)).toBeUndefined();
    expect(normalizeViewTransform({ zoom: 1, panX: Number.NaN, panY: 0 })).toBeUndefined();
  });
});

describe("preview content revisions", () => {
  it("preserves image resources for status-only updates", () => {
    expect(previewContentChanged("preview", 3, "preview", 3)).toBe(false);
  });

  it("replaces image resources when the mode or revision changes", () => {
    expect(previewContentChanged("preview", 3, "diff", 3)).toBe(true);
    expect(previewContentChanged("diff", 3, "diff", 4)).toBe(true);
  });
});
