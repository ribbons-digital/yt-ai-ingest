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

export type TemporalBlock = {
  index: number;
  centerTimestampSeconds: number;
  centerTimestamp: string;
  startSeconds: number;
  endSeconds: number;
  frameTimestamps: number[];
  frameTimestampLabels: string[];
  scoutFrame: string;
  reason: ScoutMoment["reason"];
};

export type TemporalPlanOptions = {
  moments: ScoutMoment[];
  durationSeconds: number;
  blockFrameCount: number;
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

export function buildTemporalPlan(options: TemporalPlanOptions): TemporalBlock[] {
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds < 0) {
    throw new Error("duration must be a non-negative number.");
  }
  if (!Number.isInteger(options.blockFrameCount) || options.blockFrameCount <= 0) {
    throw new Error("blockFrameCount must be an integer greater than 0.");
  }

  const duration = Math.floor(options.durationSeconds);
  if (duration === 0) {
    return [];
  }

  return options.moments.map((moment, index) => {
    const frameTimestamps = buildBlockTimestamps({
      centerTimestampSeconds: moment.timestampSeconds,
      durationSeconds: duration,
      blockFrameCount: options.blockFrameCount
    });

    return {
      index: index + 1,
      centerTimestampSeconds: moment.timestampSeconds,
      centerTimestamp: formatSeconds(moment.timestampSeconds),
      startSeconds: frameTimestamps[0],
      endSeconds: frameTimestamps[frameTimestamps.length - 1],
      frameTimestamps,
      frameTimestampLabels: frameTimestamps.map(formatSeconds),
      scoutFrame: moment.frame,
      reason: moment.reason
    };
  });
}

function buildBlockTimestamps(options: {
  centerTimestampSeconds: number;
  durationSeconds: number;
  blockFrameCount: number;
}): number[] {
  const center = Math.floor(options.centerTimestampSeconds);
  const endTimestamp = options.durationSeconds - 1;
  const count = Math.min(options.blockFrameCount, options.durationSeconds);
  const preferredStart = center - 1;
  const maxStart = Math.max(0, options.durationSeconds - count);
  const start = Math.min(Math.max(0, preferredStart), maxStart);

  return Array.from({ length: count }, (_, index) => {
    const timestamp = start + index;
    return Math.min(Math.max(0, timestamp), endTimestamp);
  });
}
