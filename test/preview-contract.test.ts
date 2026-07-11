import { describe, expect, it } from "vitest";
import { clampZoom, previewContentChanged, zoomAtPoint } from "../src/preview-contract";

describe("preview zoom", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0)).toBe(0.05);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(20)).toBe(8);
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

describe("preview content revisions", () => {
  it("preserves image resources for status-only updates", () => {
    expect(previewContentChanged("preview", 3, "preview", 3)).toBe(false);
  });

  it("replaces image resources when the mode or revision changes", () => {
    expect(previewContentChanged("preview", 3, "diff", 3)).toBe(true);
    expect(previewContentChanged("diff", 3, "diff", 4)).toBe(true);
  });
});
