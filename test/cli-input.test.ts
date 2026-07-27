import { describe, expect, it } from "vitest";
import { formatCommandArgument, parseCommandArguments } from "../src/cli-input";

describe("CLI terminal argument editing", () => {
  it("preserves Windows paths and escaped spaces", () => {
    expect(parseCommandArguments(
      String.raw`render C:\Users\ryo\diagram.xal -o "C:\\Work Files\\diagram.svg"`
    )).toEqual([
      "render",
      String.raw`C:\Users\ryo\diagram.xal`,
      "-o",
      String.raw`C:\Work Files\diagram.svg`
    ]);
    expect(parseCommandArguments(String.raw`render Work\ Files\diagram.xal`)).toEqual([
      "render",
      String.raw`Work Files\diagram.xal`
    ]);
  });

  it("retains empty quoted arguments and literal single-quoted backslashes", () => {
    expect(parseCommandArguments(String.raw`custom "" '' 'C:\Temp\file.xal'`)).toEqual([
      "custom",
      "",
      "",
      String.raw`C:\Temp\file.xal`
    ]);
  });

  it("round-trips arguments used by the terminal launcher", () => {
    const args = [
      "render",
      String.raw`C:\Work Files\diagram.xal`,
      "",
      `a"b`,
      "trailing\\"
    ];
    expect(parseCommandArguments(args.map(formatCommandArgument).join(" "))).toEqual(args);
  });

  it("rejects unfinished quotes and empty input", () => {
    expect(() => parseCommandArguments(`render "diagram.xal`)).toThrow("unfinished quote");
    expect(() => parseCommandArguments(" \t ")).toThrow("at least one");
  });
});
