import { describe, expect, it } from "vitest";
import {
  missingXalTagNames,
  withoutOpeningBracket,
  xalTagCompletionContext,
  xalTagNames
} from "../src/language-server-completion";

describe("xaligo language-server completion support", () => {
  it("recognizes opening and closing tag prefixes without consuming the bracket", () => {
    expect(xalTagCompletionContext("  <pri>", 6)).toEqual({
      closing: false,
      wordStartCharacter: 3,
      cursorCharacter: 6,
      hasAutoClosingBracket: true
    });
    expect(xalTagCompletionContext("  </pri>", 7)).toEqual({
      closing: true,
      wordStartCharacter: 4,
      cursorCharacter: 7,
      hasAutoClosingBracket: true
    });
    expect(xalTagCompletionContext("  text", 6)).toBeUndefined();
  });

  it("supplements the native snippet set with V1 and AWS tags", () => {
    expect(xalTagNames).toEqual(expect.arrayContaining([
      "aws-cloud",
      "availability-zone",
      "public-subnet",
      "private-subnet"
    ]));
    const missing = missingXalTagNames(["frame", "row", "item"]);
    expect(missing).toContain("private-subnet");
    expect(missing).not.toContain("frame");
  });

  it("normalizes native snippets for a trigger character already in the editor", () => {
    expect(withoutOpeningBracket('<frame id="${1:main}">$0</frame>')).toBe(
      'frame id="${1:main}">$0</frame>'
    );
    expect(withoutOpeningBracket("private-subnet")).toBe("private-subnet");
  });
});
