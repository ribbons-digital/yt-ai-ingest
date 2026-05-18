export type TimeRange = {
  start: number;
  end: number;
  input: string;
};

export function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Timestamp is required.");
  }

  const parts = trimmed.split(":");
  if (parts.length > 3) {
    throw new Error(`Expected SS, MM:SS, or HH:MM:SS timestamp, got "${value}".`);
  }

  const numbers = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`Timestamp parts must be numeric, got "${value}".`);
    }
    return Number(part);
  });

  const [hours, minutes, seconds] =
    numbers.length === 1
      ? [0, 0, numbers[0]]
      : numbers.length === 2
        ? [0, numbers[0], numbers[1]]
        : numbers;

  if (minutes < 0 || minutes > 59) {
    throw new Error(`Timestamp minutes must be between 0 and 59, got "${value}".`);
  }
  if (seconds < 0 || seconds > 59) {
    throw new Error(`Timestamp seconds must be between 0 and 59, got "${value}".`);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function parseRange(value: string): TimeRange {
  const parts = value.split("-");
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new Error(`Expected range in START-END format, got "${value}".`);
  }

  const start = parseTimestamp(parts[0]);
  const end = parseTimestamp(parts[1]);
  if (end <= start) {
    throw new Error(`Range end must be after start, got "${value}".`);
  }

  return { start, end, input: value };
}

export function rangeAround(value: string, windowSeconds: number): TimeRange {
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0) {
    throw new Error("--window must be a non-negative number of seconds.");
  }

  const center = parseTimestamp(value);
  const start = Math.max(0, center - windowSeconds);
  const end = center + windowSeconds;

  return {
    start,
    end,
    input: `${formatSeconds(start)}-${formatSeconds(end)}`
  };
}

export function formatSeconds(totalSeconds: number): string {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 0) {
    throw new Error(`Cannot format invalid second value: ${totalSeconds}.`);
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

export function assertPositiveFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("--fps must be greater than 0.");
  }
}
