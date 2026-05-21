import { formatSeconds } from "./timestamps.js";

export type ScoutMoment = {
  index: number;
  timestampSeconds: number;
  timestamp: string;
  frame: string;
  reason: "interval" | "end";
};

export type ScoutTimelineOptions = {
  durationSeconds: number;
  intervalSeconds: number;
};

export function buildScoutTimeline(options: ScoutTimelineOptions): ScoutMoment[] {
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds < 0) {
    throw new Error("duration must be a non-negative number.");
  }
  if (!Number.isFinite(options.intervalSeconds) || options.intervalSeconds <= 0) {
    throw new Error("interval must be greater than 0.");
  }

  const duration = Math.floor(options.durationSeconds);
  const endTimestamp = Math.max(0, duration - 1);
  const interval = Math.floor(options.intervalSeconds);
  const timestamps = new Map<number, ScoutMoment["reason"]>();

  for (let timestamp = 0; timestamp <= endTimestamp; timestamp += interval) {
    timestamps.set(timestamp, "interval");
  }

  if (!timestamps.has(endTimestamp)) {
    timestamps.set(endTimestamp, "end");
  }

  return [...timestamps.entries()]
    .sort(([left], [right]) => left - right)
    .map(([timestampSeconds, reason], index) => ({
      index: index + 1,
      timestampSeconds,
      timestamp: formatSeconds(timestampSeconds),
      frame: `frame_${String(index + 1).padStart(4, "0")}.jpg`,
      reason
    }));
}
