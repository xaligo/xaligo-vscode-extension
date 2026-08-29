export interface XalTagCompletionContext {
  closing: boolean;
  wordStartCharacter: number;
  cursorCharacter: number;
  hasAutoClosingBracket: boolean;
}

/**
 * Lexical tag names used to supplement the native LSP's intentionally small
 * snippet set. Semantic completion, diagnostics, hover, and navigation remain
 * owned by the native language server.
 */
export const xalTagNames = [
  "xaligo",
  "scene",
  "metadata",
  "entry",
  "imports",
  "import",
  "styles",
  "style",
  "data",
  "frames",
  "frame",
  "capture",
  "container",
  "row",
  "col",
  "table-data",
  "table",
  "header",
  "cell",
  "database-schema",
  "database",
  "entity",
  "column",
  "primary-key",
  "foreign-key",
  "aws-account",
  "aws-cloud",
  "aws-cloud-alt",
  "region",
  "availability-zone",
  "vpc",
  "public-subnet",
  "private-subnet",
  "security-group",
  "auto-scaling-group",
  "server-contents",
  "corporate-data-center",
  "ec2-instance-contents",
  "spot-fleet",
  "aws-iot-greengrass-deployment",
  "aws-iot-greengrass",
  "elastic-beanstalk-container",
  "aws-step-functions-workflow",
  "generic-group",
  "item",
  "spacer",
  "blank",
  "rectangle",
  "port",
  "card",
  "panel",
  "text",
  "label",
  "uml-model",
  "uml",
  "class-diagram",
  "component-diagram",
  "activity-diagram",
  "state-machine-diagram",
  "sequence-diagram",
  "partition",
  "class",
  "interface",
  "enumeration",
  "component",
  "artifact",
  "initial",
  "final",
  "activity",
  "action",
  "decision",
  "merge",
  "fork",
  "join",
  "object-node",
  "state",
  "history",
  "choice",
  "participant",
  "lifeline",
  "compartment",
  "attribute",
  "operation",
  "constraint",
  "note",
  "literal",
  "slot",
  "responsibility",
  "provided-interface",
  "required-interface",
  "property",
  "do",
  "exit",
  "association",
  "aggregation",
  "composition",
  "generalization",
  "realization",
  "dependency",
  "assembly",
  "delegation",
  "control-flow",
  "object-flow",
  "transition",
  "message",
  "return-message",
  "create-message",
  "destroy-message",
  "relation",
  "connections",
  "connection",
  "line",
  "route",
  "traffic",
  "src",
  "dst",
  "bends",
  "points",
  "path",
  "bend",
  "point",
  "via",
  "waypoint"
] as const;

export function xalTagCompletionContext(
  lineText: string,
  cursorCharacter: number
): XalTagCompletionContext | undefined {
  if (cursorCharacter < 0 || cursorCharacter > lineText.length) {
    return undefined;
  }
  const match = /<(\/?)([A-Za-z0-9-]*)$/.exec(lineText.slice(0, cursorCharacter));
  if (!match) {
    return undefined;
  }
  return {
    closing: match[1] === "/",
    wordStartCharacter: cursorCharacter - match[2].length,
    cursorCharacter,
    hasAutoClosingBracket: lineText[cursorCharacter] === ">"
  };
}

export function missingXalTagNames(existingLabels: Iterable<string>): string[] {
  const existing = new Set(existingLabels);
  return xalTagNames.filter((tagName) => !existing.has(tagName));
}

export function withoutOpeningBracket(value: string): string {
  return value.startsWith("<") ? value.slice(1) : value;
}
