export type PdfSemanticType =
  | "door"
  | "window"
  | "unknown";

export interface SemanticClassification {
  type: PdfSemanticType;
  confidence: number;
}

const DOOR_PATTERNS = [
  /^D$/i,
  /^D\d+$/i,
  /^D[-_ ]?\d+$/i,

  /^DR$/i,
  /^DR\d+$/i,
  /^DR[-_ ]?\d+$/i,

  /^DOOR$/i,
  /^DOOR\d+$/i,
  /^DOOR[-_ ]?\d+$/i,

  /^ENTRANCE$/i,
  /^ENTRY$/i,
];

const WINDOW_PATTERNS = [
  /^W$/i,
  /^W\d+$/i,
  /^W[-_ ]?\d+$/i,

  /^WIN$/i,
  /^WIN\d+$/i,
  /^WIN[-_ ]?\d+$/i,

  /^WINDOW$/i,
  /^WINDOW\d+$/i,
  /^WINDOW[-_ ]?\d+$/i,
];

function cleanText(
  text: string,
): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[|]/g, "")
    .trim();
}

export function classifyPdfText(
  text: string,
): SemanticClassification {
  const value =
    cleanText(text);

  if (!value) {
    return {
      type: "unknown",
      confidence: 0,
    };
  }

  const upper =
    value.toUpperCase();

  /*
   * Strong explicit door words.
   */
  if (
    upper.includes("DOOR") ||
    upper === "ENTRY" ||
    upper === "ENTRANCE"
  ) {
    return {
      type: "door",
      confidence: 0.97,
    };
  }

  /*
   * Strong explicit window words.
   */
  if (
    upper.includes("WINDOW")
  ) {
    return {
      type: "window",
      confidence: 0.97,
    };
  }

  /*
   * Door schedule identifiers.
   */
  if (
    DOOR_PATTERNS.some(
      (pattern) =>
        pattern.test(value),
    )
  ) {
    return {
      type: "door",
      confidence: 0.88,
    };
  }

  /*
   * Window schedule identifiers.
   */
  if (
    WINDOW_PATTERNS.some(
      (pattern) =>
        pattern.test(value),
    )
  ) {
    return {
      type: "window",
      confidence: 0.88,
    };
  }

  return {
    type: "unknown",
    confidence: 0,
  };
}