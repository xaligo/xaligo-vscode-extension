import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDiffArguments,
  buildRenderArguments,
  diffOutputPaths,
  parseDiffSummary,
  replaceExtension
} from "../src/xaligo-command";

describe("xaligo command contracts", () => {
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

  it("derives the two structural diff image paths", () => {
    expect(diffOutputPaths(path.join("tmp", "architecture.SVG"))).toEqual([
      path.join("tmp", "architecture-removed.svg"),
      path.join("tmp", "architecture-added.svg")
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

  it("replaces only the final file extension", () => {
    expect(replaceExtension(path.join("docs.v1", "diagram.xal"), "svg")).toBe(
      path.join("docs.v1", "diagram.svg")
    );
  });
});
