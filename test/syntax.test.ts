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

describe("latest V1 and V2 syntax highlighting", () => {
  it.each([
    "xaligo",
    "scene",
    "capture",
    "frames",
    "rectangle",
    "port",
    "table-data",
    "database-schema",
    "uml",
    "class-diagram",
    "activity-diagram",
    "state-machine-diagram",
    "sequence-diagram",
    "create-message",
    "connections",
    "line",
    "route",
    "traffic",
    "label",
    "bend",
    "waypoint"
  ])(
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
    "source",
    "target",
    "routing",
    "weight",
    "fill",
    "stroke",
    "corner-radius",
    "opacity",
    "shape",
    "icon",
    "icon-ref",
    "source-arrow",
    "target-arrow",
    "overflow",
    "font-size",
    "src-anchor",
    "dst-side",
    "coordinate-scale",
    "grid",
    "src-frame-anchor",
    "break-before",
    "key-background-color",
    "interface-width",
    "show-element-names"
  ])("recognizes the %s attribute", (attribute) => {
    expect(isMatchedByNamedPattern(
      "attribute-names",
      "entity.other.attribute-name.known.xaligo",
      attribute
    )).toBe(true);
  });

  it("indents col because it is a structural container", () => {
    const configuration = JSON.parse(readFileSync(
      new URL("../language-configuration.json", import.meta.url),
      "utf8"
    )) as { indentationRules: { increaseIndentPattern: string } };
    expect(new RegExp(configuration.indentationRules.increaseIndentPattern).test("  <col span=\"6\">"))
      .toBe(true);
  });
});
