import type { TimeRange } from "./timestamps.js";

export type RequestedFrameMode = "select" | "seek" | "auto";
export type ResolvedFrameMode = "select" | "seek";

type ChooseFrameExtractionModeInput = {
  requestedMode: RequestedFrameMode;
  durationSeconds?: number;
  ranges: TimeRange[];
};

export function chooseFrameExtractionMode({
  requestedMode,
  durationSeconds,
  ranges
}: ChooseFrameExtractionModeInput): ResolvedFrameMode {
  if (requestedMode === "select" || requestedMode === "seek") {
    return requestedMode;
  }

  if (ranges.length <= 1) {
    return "seek";
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const span = sorted[sorted.length - 1].end - sorted[0].start;
  const totalRequested = sorted.reduce((sum, range) => sum + range.end - range.start, 0);
  const largestGap = sorted.slice(1).reduce((maxGap, range, index) => {
    const previous = sorted[index];
    return Math.max(maxGap, range.start - previous.end);
  }, 0);

  const isLongVideo = typeof durationSeconds === "number" && durationSeconds >= 3600;
  const rangesAreFarApart = largestGap >= 900 || span > totalRequested * 12;

  if (isLongVideo && rangesAreFarApart) {
    return "seek";
  }

  return "select";
}
