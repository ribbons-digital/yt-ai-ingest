import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { learnStatus, renderLesson } from "../src/commands/learn.js";
import { renderLessonHtml, safeLessonHref } from "../src/lib/lessonHtml.js";
import type { Concept, Topic } from "../src/lib/learning.js";

const topic: Topic = {
  id: "core-topic",
  title: "Core Topic",
  importance: "core",
  timestamps: ["00:01-00:05"],
  summary: "Learn a durable concept.",
  visualEvidence: ["frames/scout/frame_0001.jpg"]
};

const lessonMarkdown = [
  "# Core Topic",
  "",
  "## Learning goal",
  "",
  "Understand `tokens` and **labels** without unsafe HTML <img src=x onerror=alert(1)>.",
  "",
  "See [safe docs](https://example.com/docs) and [bad docs](javascript:alert(1)).",
  "",
  "## Practice",
  "",
  "1. Explain the labels.",
  "",
  "<details>",
  "<summary>Answer</summary>",
  "Use the completion labels, not the user tokens.",
  "</details>"
].join("\n");

const concepts: Concept[] = [
  {
    id: "token",
    term: "Token",
    type: "term",
    plainDefinition: "A small text unit.",
    whyItMatters: "Loss is computed over token predictions.",
    neededForTopics: ["core-topic"]
  }
];

describe("lesson HTML renderer", () => {
  it("renders a self-contained lesson without scripts or unescaped lesson HTML", () => {
    const html = renderLessonHtml({
      topic,
      lessonMarkdown,
      concepts,
      visualEvidence: [{ path: "frames/scout/frame_0001.jpg", href: "../../frames/scout/frame_0001.jpg" }]
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain('<a href="https://example.com/docs">safe docs</a>');
    expect(html).toContain("[bad docs](javascript:alert(1))");
    expect(html).toContain('<details class="practice-card">');
    expect(html).toContain('<img src="../../frames/scout/frame_0001.jpg" alt="frames/scout/frame_0001.jpg">');
  });

  it("rejects unsafe hrefs", () => {
    expect(safeLessonHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeLessonHref("lesson-notes/page.html")).toBe("lesson-notes/page.html");
    expect(safeLessonHref("../../frames/scout/frame_0001.jpg")).toBe("../../frames/scout/frame_0001.jpg");
    expect(safeLessonHref("../../frames/../../etc/passwd")).toBeUndefined();
    expect(safeLessonHref("../../frames/%2e%2e/secret.jpg")).toBeUndefined();
    expect(safeLessonHref("notes/%zz/file.html")).toBeUndefined();
    expect(safeLessonHref("javascript:alert(1)")).toBeUndefined();
    expect(safeLessonHref("data:text/html,hi")).toBeUndefined();
    expect(safeLessonHref("../secret.txt")).toBeUndefined();
    expect(safeLessonHref("/absolute/path")).toBeUndefined();
  });
});

describe("renderLesson command", () => {
  it("writes HTML next to an existing Markdown lesson", async () => {
    const videoFolder = await makeVideoFolder();
    await renderLesson(videoFolder, "core-topic");

    const html = await readFile(path.join(videoFolder, "learning", "lessons", "01-core-topic.html"), "utf8");
    expect(html).toContain("Core Topic");
    expect(html).toContain("Concept cards");
    expect(html).not.toContain("missing.jpg");
  });

  it("rejects encoded dot-segment visual evidence paths", async () => {
    const videoFolder = await makeVideoFolder({ visualEvidence: ["frames/%2e%2e/secret.jpg"] });
    await mkdir(path.join(videoFolder, "frames", "%2e%2e"), { recursive: true });
    await writeFile(path.join(videoFolder, "frames", "%2e%2e", "secret.jpg"), "fake", "utf8");

    await renderLesson(videoFolder, "core-topic");

    const html = await readFile(path.join(videoFolder, "learning", "lessons", "01-core-topic.html"), "utf8");
    expect(html).not.toContain("%2e%2e");
    expect(html).not.toContain("secret.jpg");
  });

  it("honors dry-run without writing HTML", async () => {
    const videoFolder = await makeVideoFolder();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await renderLesson(videoFolder, "core-topic", { dryRun: true });
    } finally {
      log.mockRestore();
    }

    await expect(readFile(path.join(videoFolder, "learning", "lessons", "01-core-topic.html"), "utf8")).rejects.toThrow();
  });

  it("errors when the Markdown lesson is missing", async () => {
    const videoFolder = await makeVideoFolder({ lesson: false });
    await expect(renderLesson(videoFolder, "core-topic")).rejects.toThrow(
      /Existing lesson not found at learning\/lessons\/01-core-topic\.md/
    );
  });

  it("does not let HTML files satisfy pending Markdown lessons", async () => {
    const videoFolder = await makeVideoFolder({ lesson: false });
    await writeFile(path.join(videoFolder, "learning", "lessons", "01-core-topic.html"), "<!doctype html>", "utf8");
    await writeFile(
      path.join(videoFolder, "learning", "progress.json"),
      JSON.stringify({ version: 1, lessons: { "core-topic": { status: "pending", lessonFile: "lessons/01-core-topic.md" } } }),
      "utf8"
    );
    await writeFile(path.join(videoFolder, "learning", "plan.md"), "# Plan\n", "utf8");
    await writeFile(path.join(videoFolder, "learning", "plan-input.md"), "# Plan input\n", "utf8");
    await writeFile(
      path.join(videoFolder, "learning", "resources.md"),
      [
        "# Resources",
        "",
        "## Core Topic (`core-topic`)",
        "",
        "- URL: https://example.com/core",
        "- Why it helps: It explains the core topic.",
        "- Focus on: The main explanation.",
        "- Skip for now: Advanced details.",
        "- Use after: The lesson."
      ].join("\n"),
      "utf8"
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await learnStatus(videoFolder, { json: true });
      const status = JSON.parse(String(log.mock.calls[0][0])) as { nextAction: { detail: string } };
      expect(status.nextAction.detail).toContain("write learning/lessons/01-core-topic.md");
    } finally {
      log.mockRestore();
    }
  });
});

async function makeVideoFolder(options: { lesson?: boolean; visualEvidence?: string[] } = {}): Promise<string> {
  const videoFolder = await mkdtemp(path.join(os.tmpdir(), "ytai-lesson-html-"));
  await mkdir(path.join(videoFolder, "learning", "lessons"), { recursive: true });
  await mkdir(path.join(videoFolder, "frames", "scout"), { recursive: true });
  await writeFile(path.join(videoFolder, "frames", "scout", "frame_0001.jpg"), "fake", "utf8");

  await writeFile(
    path.join(videoFolder, "learning", "topics.json"),
    JSON.stringify({
      version: 1,
      topics: [
        { ...topic, visualEvidence: options.visualEvidence ?? ["frames/scout/frame_0001.jpg", "frames/scout/missing.jpg"] }
      ]
    }),
    "utf8"
  );
  await writeFile(path.join(videoFolder, "learning", "concepts.json"), JSON.stringify({ version: 1, concepts }), "utf8");
  if (options.lesson !== false) {
    await writeFile(path.join(videoFolder, "learning", "lessons", "01-core-topic.md"), lessonMarkdown, "utf8");
  }
  return videoFolder;
}
