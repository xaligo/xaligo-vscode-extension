const fallbackDimensions = { width: 640, height: 480 };

export function svgDimensions(svg: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  let width = parseSvgLength(/\bwidth=["']([^"']+)/i.exec(root)?.[1]);
  let height = parseSvgLength(/\bheight=["']([^"']+)/i.exec(root)?.[1]);
  const viewBox = parseViewBox(/\bviewBox=["']([^"']+)/i.exec(root)?.[1]);

  if (viewBox) {
    if (width === undefined && height === undefined) {
      width = viewBox.width;
      height = viewBox.height;
    } else if (width === undefined && height !== undefined) {
      width = height * viewBox.width / viewBox.height;
    } else if (height === undefined && width !== undefined) {
      height = width * viewBox.height / viewBox.width;
    }
  }
  return {
    width: width ?? fallbackDimensions.width,
    height: height ?? fallbackDimensions.height
  };
}

function parseSvgLength(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(px|pt|pc|in|cm|mm|q)?\s*$/i.exec(value);
  if (!match) {
    return undefined;
  }
  const amount = Number.parseFloat(match[1]);
  const factors: Record<string, number> = {
    "": 1,
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6
  };
  const result = amount * factors[(match[2] ?? "").toLowerCase()];
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function parseViewBox(value: string | undefined): { width: number; height: number } | undefined {
  if (!value) {
    return undefined;
  }
  const values = value.trim().split(/[\s,]+/).map(Number);
  if (
    values.length !== 4 ||
    values.some((entry) => !Number.isFinite(entry)) ||
    values[2] <= 0 ||
    values[3] <= 0
  ) {
    return undefined;
  }
  return { width: values[2], height: values[3] };
}
