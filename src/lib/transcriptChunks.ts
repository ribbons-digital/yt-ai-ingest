/**
 * Transcript chunking: split a VTT/SRT transcript into timestamped segments
 * so that `summary-input.md` covers the full video duration instead of just
 * the first N characters.
 */

export type TranscriptChunk = {
  index: number;
  startSec: number;
  endSec: number;
  startLabel: string;
  endLabel: string;
  textPreview: string;
};

export type ChunkedTranscript = {
  chunks: TranscriptChunk[];
  totalSec: number;
  totalChunks: number;
};

const VTT_CUE_RE =
  /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/g;
const SRT_CUE_RE =
  /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/g;

function parseCueTime(
  hours: string | undefined,
  minutes: string,
  seconds: string
): number {
  const h = hours ? Number(hours) : 0;
  return h * 3600 + Number(minutes) * 60 + Number(seconds);
}

function formatLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse a VTT or SRT transcript into an array of cues { startSec, endSec, text }.
 */
function parseCues(transcript: string): { startSec: number; endSec: number; text: string }[] {
  const lines = transcript.split(/\r?\n/);
  const cues: { startSec: number; endSec: number; text: string }[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const match = VTT_CUE_RE.exec(line);
    if (match) {
      const startSec = parseCueTime(match[1], match[2], match[3]);
      const endSec = parseCueTime(match[5], match[6], match[7]);
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "" && !VTT_CUE_RE.test(lines[i]!)) {
        textLines.push(lines[i]!);
        i++;
      }
      VTT_CUE_RE.lastIndex = 0;
      if (textLines.length > 0) {
        cues.push({ startSec, endSec, text: textLines.join("\n") });
      }
    } else {
      i++;
    }
  }

  return cues;
}

/**
 * Group cues into time-based chunks of roughly `chunkSec` each.
 * Returns an array of { startSec, endSec, cues }.
 */
function groupByTime(
  cues: { startSec: number; endSec: number; text: string }[],
  chunkSec: number
): { startSec: number; endSec: number; cues: typeof cues }[] {
  if (cues.length === 0) return [];

  const totalDuration = cues[cues.length - 1]!.endSec;
  const groups: { startSec: number; endSec: number; cues: typeof cues }[] = [];
  let boundary = chunkSec;
  let current: typeof cues = [];

  for (const cue of cues) {
    if (cue.startSec >= boundary && current.length > 0) {
      groups.push({
        startSec: current[0]!.startSec,
        endSec: current[current.length - 1]!.endSec,
        cues: current
      });
      current = [];
      boundary += chunkSec;
    }
    current.push(cue);
  }

  if (current.length > 0) {
    groups.push({
      startSec: current[0]!.startSec,
      endSec: current[current.length - 1]!.endSec,
      cues: current
    });
  }

  return groups;
}

/**
 * Chunk a full transcript into timestamped segments.
 * Each chunk contains a time range and a text preview (truncated to `previewChars`).
 */
export function chunkTranscript(
  transcript: string,
  options: { chunkSec?: number; previewChars?: number } = {}
): ChunkedTranscript {
  const chunkSec = options.chunkSec ?? 300; // default 5-minute chunks
  const previewChars = options.previewChars ?? 2000;

  const cues = parseCues(transcript);
  if (cues.length === 0) {
    return { chunks: [], totalSec: 0, totalChunks: 0 };
  }

  const groups = groupByTime(cues, chunkSec);
  const chunks: TranscriptChunk[] = groups.map((group, idx) => {
    const fullText = group.cues.map((c) => stripTags(c.text)).join(" ").replace(/\s+/g, " ");
    const preview =
      fullText.length > previewChars
        ? fullText.slice(0, previewChars) + "…"
        : fullText;

    return {
      index: idx + 1,
      startSec: group.startSec,
      endSec: group.endSec,
      startLabel: formatLabel(group.startSec),
      endLabel: formatLabel(group.endSec),
      textPreview: preview
    };
  });

  return {
    chunks,
    totalSec: cues[cues.length - 1]!.endSec,
    totalChunks: chunks.length
  };
}

/**
 * Format a chunked transcript as a markdown section for `summary-input.md`.
 */
export function formatChunkIndex(chunked: ChunkedTranscript): string {
  if (chunked.chunks.length === 0) {
    return "_Transcript could not be parsed into timestamped chunks._";
  }

  const totalLabel = formatLabel(chunked.totalSec);
  const lines: string[] = [
    `Full transcript spans **${totalLabel}** across **${chunked.totalChunks} chunk(s)**.`,
    "Each chunk contains the raw transcript text for that time range.",
    "",
    "### Transcript Chunks",
    ""
  ];

  for (const chunk of chunked.chunks) {
    lines.push(`#### Chunk ${chunk.index}: ${chunk.startLabel} → ${chunk.endLabel}`);
    lines.push("");
    lines.push(chunk.textPreview);
    lines.push("");
  }

  return lines.join("\n");
}
