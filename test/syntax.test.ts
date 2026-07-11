import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface GrammarPattern {
  name?: string;
  match?: string;
}

interface Grammar {
  repository: Record<string, { patterns: GrammarPattern[] }>;
}

const grammar = JSON.parse(readFileSync(
  new URL("../syntaxes/xal.tmLanguage.json", import.meta.url),
  "utf8"
)) as Grammar;

function isMatchedByNamedPattern(repositoryName: string, scopeName: string, value: string): boolean {
  return grammar.repository[repositoryName].patterns.some((pattern) =>
    pattern.name === scopeName && pattern.match !== undefined && new RegExp(`^(?:${pattern.match})$`).test(value)
  );
}

describe("latest V1 syntax highlighting", () => {
  it.each(["frames", "rectangle", "port", "connections", "bend", "waypoint"])(
    "recognizes the %s tag",
    (tag) => {
      const patterns = grammar.repository["tag-names"].patterns;
      expect(patterns.some((pattern) =>
        pattern.name !== "entity.name.tag.other.xaligo" &&
        pattern.match !== undefined &&
        new RegExp(`^(?:${pattern.match})$`).test(tag)
      )).toBe(true);
    }
  );

  it.each([
    "version",
    "overflow",
    "font-size",
    "src-anchor",
    "dst-side",
    "coordinate-scale",
    "grid"
  ])("recognizes the %s attribute", (attribute) => {
    expect(isMatchedByNamedPattern(
      "attribute-names",
      "entity.other.attribute-name.known.xaligo",
      attribute
    )).toBe(true);
  });
});
