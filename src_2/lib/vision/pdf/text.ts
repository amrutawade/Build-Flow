import type { Vec2 } from "@/lib/models";

export interface PdfTextItem {
  text: string;
  position: Vec2;
  width: number;
  height: number;
}

export interface PdfSemanticText {
  text: string;
  position: Vec2;
  width: number;
  height: number;
  type: "door" | "window" | "unknown";
  confidence: number;
}

export function extractPdfTextItems(
  textContent: {
    items?: unknown[];
  },
): PdfTextItem[] {
  const items =
    Array.isArray(textContent.items)
      ? textContent.items
      : [];

  const result: PdfTextItem[] = [];

  for (const raw of items) {
    if (
      typeof raw !== "object" ||
      raw === null
    ) {
      continue;
    }

    const item =
      raw as {
        str?: unknown;
        transform?: unknown;
        width?: unknown;
        height?: unknown;
      };

    const value =
      typeof item.str === "string"
        ? item.str.trim()
        : "";

    if (!value) {
      continue;
    }

    const transform =
      Array.isArray(item.transform)
        ? item.transform
        : [];

    const x =
      typeof transform[4] === "number"
        ? transform[4]
        : 0;

    const y =
      typeof transform[5] === "number"
        ? transform[5]
        : 0;

    const width =
      typeof item.width === "number"
        ? Math.abs(item.width)
        : 0;

    const height =
      typeof item.height === "number"
        ? Math.abs(item.height)
        : Math.abs(
            typeof transform[3] === "number"
              ? transform[3]
              : 0,
          );

    result.push({
      text: value,
      position: [x, y],
      width,
      height,
    });
  }

  return result;
}