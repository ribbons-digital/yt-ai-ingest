import { describe, expect, it } from "vitest";
import {
  computeNextReview,
  nextAction,
  renderQuizInputMd,
  reviewState,
  type LearnArtifacts,
  type LearningProgress,
  type QuizScore,
  type ReviewState,
  type Topic
} from "../src/lib/learning.js";

const FOLDER = "videos/demo";
const NOW = new Date("2026-07-05T12:00:00.000Z");
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Helper: ISO date-time exactly `days` days after NOW (negative = before). */
function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * DAY_IN_MS).toISOString();
}

/** Helper: a recorded quiz score; the date is old on purpose so scheduling from `now` is visible. */
function score(value: number, date = "2026-01-01T00:00:00.000Z"): QuizScore {
  return { date, score: value };
}

/** Helper: a minimal topic for review fixtures. */
function topic(id: string, importance: Topic["importance"] = "core", prerequisites?: string[]): Topic {
  return {
    id,
    title: `Title for ${id}`,
    importance,
    timestamps: ["00:00-01:00"],
    summary: `Summary for ${id}.`,
    prerequisites
  };
}

/** Helper: progress with the given lesson entries. */
function progress(lessons: LearningProgress["lessons"]): LearningProgress {
  return { version: 1, lessons };
}

/** Helper: artifacts for a folder where every required lesson is done. */
function completeArtifacts(overrides: Partial<LearnArtifacts> = {}): LearnArtifacts {
  return {
    videoFolder: FOLDER,
    hasSummaryInput: true,
    hasTeachingGuideMd: true,
    hasTopicsInput: true,
    hasTopicsJson: true,
    topicsIssues: [],
    topics: [topic("intro")],
    lessonIssues: [],
    hasPlanInput: true,
    hasPlanMd: true,
    hasResourcesMd: true,
    hasConceptsJson: true,
    progress: progress({ intro: { status: "done", lessonFile: "lessons/01-intro.md" } }),
    lessonOutputs: ["lessons/01-intro.md"],
    ...overrides
  };
}

describe("computeNextReview", () => {
  it("a single pass schedules the review one day out", () => {
    expect(computeNextReview([score(85)], NOW)).toBe(daysFromNow(1));
  });

  it("a fail resets to one day even after a long pass streak", () => {
    const scores = [score(95), score(90), score(85), score(92), score(60)];
    expect(computeNextReview(scores, NOW)).toBe(daysFromNow(1));
  });

  it("doubles the interval per trailing consecutive pass: 2, 3, 4 passes -> 2, 4, 8 days", () => {
    expect(computeNextReview([score(90), score(90)], NOW)).toBe(daysFromNow(2));
    expect(computeNextReview([score(90), score(90), score(90)], NOW)).toBe(daysFromNow(4));
    expect(computeNextReview([score(90), score(90), score(90), score(90)], NOW)).toBe(daysFromNow(8));
  });

  it("only the trailing streak counts: a fail in the middle truncates it", () => {
    const scores = [score(95), score(60), score(85), score(90)];
    expect(computeNextReview(scores, NOW)).toBe(daysFromNow(2));
  });

  it("a score of exactly 80 counts as a pass", () => {
    // If 80 failed, the result would be one day regardless of history.
    expect(computeNextReview([score(85), score(80)], NOW)).toBe(daysFromNow(2));
  });

  it("a score of 79 counts as a fail", () => {
    expect(computeNextReview([score(85), score(79)], NOW)).toBe(daysFromNow(1));
  });

  it("caps the interval at 60 days once the streak would exceed it", () => {
    const seven = Array.from({ length: 7 }, () => score(100));
    const ten = Array.from({ length: 10 }, () => score(100));
    // Streak 7 would be 64 days uncapped; streak 6 stays below the cap.
    expect(computeNextReview(seven.slice(0, 6), NOW)).toBe(daysFromNow(32));
    expect(computeNextReview(seven, NOW)).toBe(daysFromNow(60));
    expect(computeNextReview(ten, NOW)).toBe(daysFromNow(60));
  });

  it("measures the interval from now, not from the last score date", () => {
    const scores = [score(90, "2025-11-01T00:00:00.000Z"), score(95, "2025-12-01T00:00:00.000Z")];
    expect(computeNextReview(scores, NOW)).toBe(daysFromNow(2));
  });

  it("returns an ISO date-time that round-trips through Date", () => {
    const result = computeNextReview([score(90)], NOW);
    expect(Number.isNaN(Date.parse(result))).toBe(false);
    expect(new Date(result).toISOString()).toBe(result);
  });
});

describe("reviewState", () => {
  it("excludes pending topics even when they carry scores and an overdue review", () => {
    const state = reviewState(
      [topic("a")],
      progress({
        a: {
          status: "pending",
          lessonFile: "lessons/01-a.md",
          scores: [score(90)],
          nextReviewAt: daysFromNow(-2)
        }
      }),
      NOW
    );
    expect(state).toEqual({ due: [], unquizzed: [] });
  });

  it("excludes topics with no progress entry", () => {
    const state = reviewState([topic("a")], progress({}), NOW);
    expect(state).toEqual({ due: [], unquizzed: [] });
  });

  it("sorts due reviews most overdue first with the latest score as lastScore", () => {
    const done = (scores: QuizScore[], nextReviewAt: string) => ({
      status: "done" as const,
      lessonFile: "lessons/x.md",
      scores,
      nextReviewAt
    });
    const state = reviewState(
      [topic("a"), topic("b"), topic("c")],
      progress({
        a: done([score(90)], daysFromNow(-1)),
        b: done([score(95), score(70)], daysFromNow(-3)),
        c: done([score(85)], daysFromNow(-2))
      }),
      NOW
    );
    expect(state.due).toEqual([
      { id: "b", nextReviewAt: daysFromNow(-3), lastScore: 70 },
      { id: "c", nextReviewAt: daysFromNow(-2), lastScore: 85 },
      { id: "a", nextReviewAt: daysFromNow(-1), lastScore: 90 }
    ]);
    expect(state.unquizzed).toEqual([]);
  });

  it("treats nextReviewAt exactly equal to now as due, and a future one as not due", () => {
    const done = (nextReviewAt: string) => ({
      status: "done" as const,
      lessonFile: "lessons/x.md",
      scores: [score(90)],
      nextReviewAt
    });
    const state = reviewState(
      [topic("at-now"), topic("future")],
      progress({
        "at-now": done(NOW.toISOString()),
        future: done(daysFromNow(1))
      }),
      NOW
    );
    expect(state.due).toEqual([{ id: "at-now", nextReviewAt: NOW.toISOString(), lastScore: 90 }]);
    expect(state.unquizzed).toEqual([]);
  });

  it("a quizzed topic with a future review appears in neither list", () => {
    const state = reviewState(
      [topic("a")],
      progress({
        a: {
          status: "done",
          lessonFile: "lessons/01-a.md",
          scores: [score(90)],
          nextReviewAt: daysFromNow(5)
        }
      }),
      NOW
    );
    expect(state).toEqual({ due: [], unquizzed: [] });
  });

  it("lists unquizzed done topics in teaching order, not input order", () => {
    // Input order is deliberately scrambled: prerequisites and importance
    // put the teaching order at [basics, advanced, aside].
    const topics = [
      topic("aside", "tangent"),
      topic("advanced", "core", ["basics"]),
      topic("basics", "core")
    ];
    const done = { status: "done" as const, lessonFile: "lessons/x.md" };
    const state = reviewState(
      topics,
      progress({ aside: done, advanced: done, basics: done }),
      NOW
    );
    expect(state.due).toEqual([]);
    expect(state.unquizzed).toEqual(["basics", "advanced", "aside"]);
  });

  it("splits a mixed progress file into due and unquizzed correctly", () => {
    const state = reviewState(
      [topic("quizzed"), topic("fresh"), topic("resting")],
      progress({
        quizzed: {
          status: "done",
          lessonFile: "lessons/01-quizzed.md",
          scores: [score(75)],
          nextReviewAt: daysFromNow(-1)
        },
        fresh: { status: "done", lessonFile: "lessons/02-fresh.md" },
        resting: {
          status: "done",
          lessonFile: "lessons/03-resting.md",
          scores: [score(95)],
          nextReviewAt: daysFromNow(4)
        }
      }),
      NOW
    );
    expect(state.due).toEqual([{ id: "quizzed", nextReviewAt: daysFromNow(-1), lastScore: 75 }]);
    expect(state.unquizzed).toEqual(["fresh"]);
  });
});

describe("renderQuizInputMd", () => {
  const quizTopic: Topic = {
    id: "attention-heads",
    title: "Attention Heads",
    importance: "core",
    timestamps: ["02:00-05:30"],
    summary: "How attention heads split the residual stream.",
    claims: ["Each head attends independently."]
  };
  const transcript = "[02:10] each head has its own query and key projections";

  it("embeds the topic JSON, lesson content, and transcript excerpt verbatim", () => {
    const lesson = "## Attention Heads\n\nHeads project queries and keys separately.";
    const md = renderQuizInputMd(quizTopic, 3, lesson, transcript, FOLDER);
    expect(md).toContain(JSON.stringify(quizTopic, null, 2));
    expect(md).toContain(lesson);
    expect(md).toContain(transcript);
    expect(md).not.toContain("_No lesson file was found for this topic.");
  });

  it("notes the missing lesson when no lesson content is provided", () => {
    const md = renderQuizInputMd(quizTopic, 3, undefined, transcript, FOLDER);
    expect(md).toContain(
      "_No lesson file was found for this topic. Quiz from the topic summary and the transcript excerpt instead._"
    );
    expect(md).toContain(transcript);
  });

  it("instructs one-at-a-time questioning with no reveal before an attempt and no output file", () => {
    const md = renderQuizInputMd(quizTopic, 3, undefined, transcript, FOLDER);
    expect(md).toContain("ONE AT A TIME");
    expect(md).toContain("stop and wait for the learner's answer before asking the next one");
    expect(md).toContain("Never reveal an answer before the learner has attempted the question.");
    expect(md).toContain("Do not write any output file");
  });

  it("ends by recording the score, then asking for the next step", () => {
    const md = renderQuizInputMd(quizTopic, 3, undefined, transcript, FOLDER);
    expect(md).toContain("`ytai score videos/demo attention-heads <score>`");
    const lines = md.split("\n");
    const lastNonEmpty = lines.filter((line) => line.trim() !== "").at(-1);
    expect(lastNonEmpty).toBe("Afterwards run: `ytai learn videos/demo --json` to get the next step.");
  });

  it("zero-pads the lesson number it references", () => {
    const md = renderQuizInputMd(quizTopic, 3, undefined, transcript, FOLDER);
    expect(md).toContain('lesson 03, "Attention Heads"');
    expect(md).not.toContain("lesson 3,");
  });
});

describe("nextAction with review state", () => {
  const RESTING_DETAIL =
    "All core and supporting topics are done. Optional: ytai teach videos/demo <topic-id> for any remaining tangent topic.";

  it("complete with due reviews steers into ytai quiz --due", () => {
    const review: ReviewState = {
      due: [{ id: "intro", nextReviewAt: daysFromNow(-1), lastScore: 70 }],
      unquizzed: []
    };
    expect(nextAction("complete", completeArtifacts(), review)).toEqual({
      kind: "cli",
      detail: "ytai quiz videos/demo --due"
    });
  });

  it("complete with only unquizzed topics also steers into ytai quiz --due", () => {
    const review: ReviewState = { due: [], unquizzed: ["intro"] };
    expect(nextAction("complete", completeArtifacts(), review)).toEqual({
      kind: "cli",
      detail: "ytai quiz videos/demo --due"
    });
  });

  it("complete with nothing due and nothing unquizzed rests on the complete action", () => {
    const review: ReviewState = { due: [], unquizzed: [] };
    expect(nextAction("complete", completeArtifacts(), review)).toEqual({
      kind: "cli",
      detail: RESTING_DETAIL
    });
  });

  it("complete without review state rests on the complete action", () => {
    expect(nextAction("complete", completeArtifacts())).toEqual({
      kind: "cli",
      detail: RESTING_DETAIL
    });
  });

  it("teaching keeps the curriculum action even when reviews are due", () => {
    const artifacts = completeArtifacts({
      progress: progress({ intro: { status: "pending", lessonFile: "lessons/01-intro.md" } }),
      lessonOutputs: []
    });
    const review: ReviewState = {
      due: [{ id: "intro", nextReviewAt: daysFromNow(-1), lastScore: 70 }],
      unquizzed: []
    };
    expect(nextAction("teaching", artifacts, review)).toEqual({
      kind: "llm",
      detail: "Read learning/lessons/01-intro-input.md and write learning/lessons/01-intro.md, then run: ytai learn videos/demo"
    });
  });
});
