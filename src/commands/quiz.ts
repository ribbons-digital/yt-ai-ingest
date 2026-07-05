import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../lib/files.js";
import {
  orderTopicsForTeaching,
  renderQuizInputMd,
  reviewState,
  type Topic
} from "../lib/learning.js";
import { info, success } from "../lib/ui.js";
import { buildTranscriptExcerpt, readProgress, requireValidTopics } from "./learn.js";

type QuizOptions = {
  due?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  quiet?: boolean;
};

export async function quiz(
  videoFolder: string,
  topicId: string | undefined,
  options: QuizOptions = {}
): Promise<void> {
  const { topics: topicList } = await requireValidTopics(videoFolder);
  const ordered = orderTopicsForTeaching(topicList);
  const progress = await readProgress(videoFolder);

  let topic: Topic | undefined;
  if (topicId) {
    topic = topicList.find((candidate) => candidate.id === topicId);
    if (!topic) {
      throw new Error(
        `Unknown topic id "${topicId}". Known ids: ${topicList.map((candidate) => candidate.id).join(", ")}`
      );
    }
    const entry = progress.lessons[topic.id];
    if (!entry || entry.status !== "done") {
      throw new Error(
        `Topic "${topicId}" has no completed lesson to quiz. Run: ytai teach ${videoFolder} ${topicId}, then mark it with: ytai learn ${videoFolder} --done ${topicId} first.`
      );
    }
  } else {
    // No explicit topic behaves like --due: most overdue first, then the
    // first done-but-never-quizzed topic in teaching order.
    const review = reviewState(topicList, progress, new Date());
    const pickId = review.due[0]?.id ?? review.unquizzed[0];
    if (!pickId) {
      throw new Error("Nothing is due for review and every done topic has been quizzed.");
    }
    topic = ordered.find((candidate) => candidate.id === pickId);
    if (!topic) {
      throw new Error(`Review queue referenced unknown topic id "${pickId}".`);
    }
  }

  const lessonNumber = ordered.findIndex((candidate) => candidate.id === topic.id) + 1;
  const paddedNumber = String(lessonNumber).padStart(2, "0");
  const lessonPath = path.join(videoFolder, "learning", "lessons", `${paddedNumber}-${topic.id}.md`);
  const lessonContent = (await pathExists(lessonPath))
    ? await readFile(lessonPath, "utf8")
    : undefined;
  const excerpt = await buildTranscriptExcerpt(videoFolder, topic);

  const outPath = path.join(videoFolder, "learning", "quizzes", `${paddedNumber}-${topic.id}-quiz-input.md`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    renderQuizInputMd(topic, lessonNumber, lessonContent, excerpt, videoFolder),
    "utf8"
  );

  if (!options.quiet) {
    success("Quiz prompt written", outPath);
    info(
      "Next",
      `Have an LLM read learning/quizzes/${paddedNumber}-${topic.id}-quiz-input.md and conduct the quiz in the conversation; it records the result with: ytai score ${videoFolder} ${topic.id} <score>`
    );
  }
}
