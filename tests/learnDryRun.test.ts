import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { learnStatus, plan, recordScore, teach, topics } from "../src/commands/learn.js";
import { quiz } from "../src/commands/quiz.js";
import { pathExists } from "../src/lib/files.js";

function topicsJson(): string {
  return JSON.stringify({
    version: 1,
    topics: [
      {
        id: "core-topic",
        title: "Core Topic",
        importance: "core",
        timestamps: ["00:01-00:05"],
        summary: "The video introduces the core topic.",
        claims: ["The core topic matters."],
        visualEvidence: ["frames/scout/frame_0001.jpg"]
      }
    ]
  });
}

async function makeVideoFolder(): Promise<string> {
  const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-learn-dry-run-"));
  await mkdir(path.join(videoFolder, "learning"), { recursive: true });
  await writeFile(path.join(videoFolder, "learning", "topics.json"), topicsJson(), "utf8");
  await writeFile(
    path.join(videoFolder, "transcript.srt"),
    "1\n00:00:01,000 --> 00:00:05,000\nThe core topic matters.\n",
    "utf8"
  );
  return videoFolder;
}

async function readProgress(videoFolder: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(videoFolder, "learning", "progress.json"), "utf8"));
}

describe("learning command dry-run behavior", () => {
  it("topics dry-run does not create learning files", async () => {
    const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-learn-dry-run-"));

    await topics(videoFolder, { dryRun: true });

    expect(await pathExists(path.join(videoFolder, "learning"))).toBe(false);
  });

  it("plan dry-run validates topics but does not write plan-input.md", async () => {
    const videoFolder = await makeVideoFolder();

    await plan(videoFolder, { dryRun: true });

    expect(await pathExists(path.join(videoFolder, "learning", "plan-input.md"))).toBe(false);
  });

  it("teach preserves existing lesson review data when regenerating a prompt", async () => {
    const videoFolder = await makeVideoFolder();
    const progress = {
      version: 1,
      lessons: {
        "core-topic": {
          status: "done",
          lessonFile: "lessons/01-core-topic.md",
          completedAt: "2026-01-01T00:00:00.000Z",
          scores: [{ date: "2026-01-02T00:00:00.000Z", score: 90 }],
          nextReviewAt: "2026-01-03T00:00:00.000Z"
        }
      }
    };
    await writeFile(path.join(videoFolder, "learning", "progress.json"), JSON.stringify(progress), "utf8");

    await teach(videoFolder, "core-topic");

    expect(await readProgress(videoFolder)).toEqual({
      version: 1,
      lessons: {
        "core-topic": {
          ...progress.lessons["core-topic"],
          status: "pending",
          lessonFile: "lessons/01-core-topic.md"
        }
      }
    });
  });

  it("teach dry-run does not write a lesson prompt or progress", async () => {
    const videoFolder = await makeVideoFolder();
    const progress = {
      version: 1,
      lessons: {
        "core-topic": {
          status: "done",
          lessonFile: "lessons/01-core-topic.md",
          scores: [{ date: "2026-01-02T00:00:00.000Z", score: 90 }],
          nextReviewAt: "2026-01-03T00:00:00.000Z"
        }
      }
    };
    await writeFile(path.join(videoFolder, "learning", "progress.json"), JSON.stringify(progress), "utf8");

    await teach(videoFolder, "core-topic", { dryRun: true });

    expect(await pathExists(path.join(videoFolder, "learning", "lessons", "01-core-topic-input.md"))).toBe(false);
    expect(await readProgress(videoFolder)).toEqual(progress);
  });

  it("learn --done dry-run validates but does not update progress", async () => {
    const videoFolder = await makeVideoFolder();
    const progress = {
      version: 1,
      lessons: {
        "core-topic": { status: "pending", lessonFile: "lessons/01-core-topic.md" }
      }
    };
    await writeFile(path.join(videoFolder, "learning", "progress.json"), JSON.stringify(progress), "utf8");

    await learnStatus(videoFolder, { dryRun: true, done: "core-topic", json: true });

    expect(await readProgress(videoFolder)).toEqual(progress);
  });

  it("recordScore dry-run validates but does not update progress", async () => {
    const videoFolder = await makeVideoFolder();
    const progress = {
      version: 1,
      lessons: {
        "core-topic": { status: "done", lessonFile: "lessons/01-core-topic.md" }
      }
    };
    await writeFile(path.join(videoFolder, "learning", "progress.json"), JSON.stringify(progress), "utf8");

    await recordScore(videoFolder, "core-topic", "85", { dryRun: true });

    expect(await readProgress(videoFolder)).toEqual(progress);
  });

  it("quiz dry-run does not write a quiz prompt", async () => {
    const videoFolder = await makeVideoFolder();
    await writeFile(
      path.join(videoFolder, "learning", "progress.json"),
      JSON.stringify({
        version: 1,
        lessons: {
          "core-topic": { status: "done", lessonFile: "lessons/01-core-topic.md" }
        }
      }),
      "utf8"
    );

    await quiz(videoFolder, "core-topic", { dryRun: true });

    expect(await pathExists(path.join(videoFolder, "learning", "quizzes", "01-core-topic-quiz-input.md"))).toBe(false);
  });
});
