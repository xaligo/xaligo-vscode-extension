import { describe, expect, it } from "vitest";
import { svgDimensions } from "../src/webview/svg-dimensions";

describe("SVG preview dimensions", () => {
  it("uses viewBox dimensions when width and height are omitted", () => {
    expect(svgDimensions('<svg viewBox="10 20 960 540"></svg>')).toEqual({
      width: 960,
      height: 540
    });
  });

  it("converts physical units to CSS pixels", () => {
    const dimensions = svgDimensions('<svg width="25.4mm" height="72pt"></svg>');
    expect(dimensions.width).toBeCloseTo(96);
    expect(dimensions.height).toBeCloseTo(96);
  });

  it("infers a missing side from the viewBox aspect ratio", () => {
    expect(svgDimensions('<svg width="400px" viewBox="0 0 16 9"></svg>')).toEqual({
      width: 400,
      height: 225
    });
  });
});
