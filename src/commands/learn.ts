import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listFilesRecursive, pathExists, writeJson } from "../lib/files.js";
import {
  createDefaultLearnerProfile,
  computeLearnStage,
  computeNextReview,
  nextAction,
  orderTopicsForTeaching,
  renderLearnStatus,
  renderLessonInputMd,
  renderPlanInputMd,
  renderTeachingGuideMd,
  renderTopicsInputMd,
  reviewState,
  toStatusJson,
  validateTopicsFile,
  validateConceptsFile,
  validateResourceSections,
  validateLessonMarkdown,
  type LearnArtifacts,
  type LearningProgress,
  type Topic,
  type TopicsFile,
  type ValidationIssue
} from "../lib/learning.js";
import { formatSeconds, parseRange } from "../lib/timestamps.js";
import { parseTranscriptCues } from "../lib/transcriptChunks.js";
import { info, success, warn } from "../lib/ui.js";
import { buildContextDocument } from "./context.js";

type LearnOptions = {
  dryRun?: boolean;
  verbose?: boolean;
};

type TeachOptions = LearnOptions & {
  next?: boolean;
  refresh?: boolean;
};

type LearnStatusOptions = LearnOptions & {
  json?: boolean;
  check?: boolean;
  done?: string;
};

const EXCERPT_PADDING_SECONDS = 15;

export async function topics(videoFolder: string, options: LearnOptions = {}): Promise<void> {
  const evidence = await buildContextDocument(videoFolder, undefined, options);
  const learningDir = path.join(videoFolder, "learning");
  const outPath = path.join(learningDir, "topics-input.md");
  const guidePath = path.join(learningDir, "teaching-guide.md");
  const profilePath = path.join(learningDir, "learner-profile.json");
  if (options.dryRun) {
    info("Dry run", `Would write ${outPath}`);
    for (const wouldWritePath of [guidePath, profilePath]) {
      if (!(await pathExists(wouldWritePath))) {
        info("Dry run", `Would write ${wouldWritePath}`);
      }
    }
    info(
      "Next",
      `Have an LLM read learning/topics-input.md and write learning/topics.json, then run: ytai learn ${videoFolder}`
    );
    return;
  }
  await mkdir(learningDir, { recursive: true });
  await writeFile(outPath, renderTopicsInputMd(evidence, videoFolder), "utf8");
  success("Topic extraction prompt written", outPath);
  if (await pathExists(guidePath)) {
    info("Teaching guide exists", guidePath);
  } else {
    await writeFile(guidePath, renderTeachingGuideMd(), "utf8");
    success("Teaching guide written", guidePath);
  }
  await ensureLearnerProfile(videoFolder);
  info(
    "Next",
    `Have an LLM read learning/topics-input.md and write learning/topics.json, then run: ytai learn ${videoFolder}`
  );
}

export async function plan(videoFolder: string, options: LearnOptions = {}): Promise<void> {
  const { raw } = await requireValidTopics(videoFolder);
  const outPath = path.join(videoFolder, "learning", "plan-input.md");
  if (options.dryRun) {
    info("Dry run", `Would write ${outPath}`);
    await previewLearnerProfileWrite(videoFolder);
  } else {
    await mkdir(path.dirname(outPath), { recursive: true });
    await ensureLearnerProfile(videoFolder);
    await writeFile(outPath, renderPlanInputMd(raw, videoFolder), "utf8");
    success("Plan prompt written", outPath);
  }
  info(
    "Next",
    `Have an LLM read learning/plan-input.md and write learning/plan.md, learning/resources.md, and learning/concepts.json, then run: ytai learn ${videoFolder}`
  );
}

export async function teach(
  videoFolder: string,
  topicId: string | undefined,
  options: TeachOptions = {}
): Promise<void> {
  if (options.refresh && options.next) {
    throw new Error("Use either --refresh with an explicit topic id or --next, not both.");
  }
  if (options.refresh && !topicId) {
    throw new Error("Use --refresh with an explicit topic id.");
  }

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
  } else if (options.next) {
    topic = ordered.find((candidate) => progress.lessons[candidate.id]?.status !== "done");
    if (!topic) {
      success("All topics are already done", `nothing left to teach in ${videoFolder}`);
      return;
    }
  } else {
    throw new Error("Provide a topic id or use --next to pick the next unfinished topic.");
  }

  const lessonNumber = ordered.findIndex((candidate) => candidate.id === topic.id) + 1;
  const paddedNumber = String(lessonNumber).padStart(2, "0");
  const lessonFile = `lessons/${paddedNumber}-${topic.id}.md`;
  const excerpt = await buildTranscriptExcerpt(videoFolder, topic);
  const repairContext = options.refresh
    ? await readLessonRepairContext(videoFolder, progress.lessons[topic.id]?.lessonFile ?? lessonFile)
    : undefined;
  if (options.dryRun) {
    await previewLearnerProfileWrite(videoFolder);
  } else {
    await ensureLearnerProfile(videoFolder);
  }
  const lessonContext = await readLessonPromptContext(videoFolder);

  const inputPath = path.join(videoFolder, "learning", "lessons", `${paddedNumber}-${topic.id}-input.md`);
  if (options.dryRun) {
    info("Dry run", `Would write ${inputPath}`);
  } else {
    await mkdir(path.dirname(inputPath), { recursive: true });
    await writeFile(
      inputPath,
      renderLessonInputMd(topic, lessonNumber, excerpt, videoFolder, lessonContext, repairContext),
      "utf8"
    );
  }

  if (progress.lessons[topic.id]?.status === "done") {
    warn("Topic was marked done", "resetting to pending because a new lesson prompt was generated");
  }
  if (!options.dryRun) {
    progress.lessons[topic.id] = { ...progress.lessons[topic.id], status: "pending", lessonFile };
    await writeProgress(videoFolder, progress);
  }

  if (!options.dryRun) {
    success("Lesson prompt written", inputPath);
  }
  info(
    "Next",
    `Have an LLM read learning/lessons/${paddedNumber}-${topic.id}-input.md and write learning/${lessonFile}, then run: ytai learn ${videoFolder}`
  );
}

export async function learnStatus(
  videoFolder: string,
  options: LearnStatusOptions = {}
): Promise<void> {
  if (!(await pathExists(videoFolder))) {
    throw new Error(`Video folder does not exist: ${videoFolder}`);
  }

  if (options.done) {
    await markLessonDone(videoFolder, options.done, options);
  }

  const artifacts = await collectArtifacts(videoFolder);
  const stage = computeLearnStage(artifacts);
  const review = reviewState(artifacts.topics, artifacts.progress, new Date());
  const next = nextAction(stage, artifacts, review);

  if (options.json) {
    console.log(JSON.stringify(toStatusJson(stage, artifacts, next, review), null, 2));
  }

  if (options.check) {
    if (!options.json) {
      printIssues([...artifacts.topicsIssues, ...artifacts.conceptsIssues, ...artifacts.resourcesIssues]);
      if (!artifacts.hasPlanMd) {
        warn("learning/plan.md", "missing");
      }
      if (!artifacts.hasResourcesMd) {
        warn("learning/resources.md", "missing");
      }
      if (!artifacts.hasConceptsJson) {
        warn("learning/concepts.json", "missing");
      }
    }
    if (!artifacts.hasTopicsJson) {
      throw new Error(`learning/topics.json not found. Run: ytai topics ${videoFolder} first.`);
    }
    const topicsErrorCount = artifacts.topicsIssues.filter((issue) => issue.severity === "error").length;
    if (topicsErrorCount > 0) {
      throw new Error(`learning/topics.json has ${topicsErrorCount} validation error(s).`);
    }
    const conceptsErrorCount = artifacts.conceptsIssues.filter((issue) => issue.severity === "error").length;
    if (conceptsErrorCount > 0) {
      throw new Error(`learning/concepts.json has ${conceptsErrorCount} validation error(s).`);
    }
    if (!options.json) {
      success("Learning artifacts check passed", `stage: ${stage}`);
    }
    return;
  }

  if (!options.json) {
    console.log(renderLearnStatus(stage, artifacts, next, review));
  }
}

export async function recordScore(
  videoFolder: string,
  topicId: string,
  scoreRaw: string,
  options: LearnOptions = {}
): Promise<void> {
  const { topics: topicList } = await requireValidTopics(videoFolder);
  const topic = topicList.find((candidate) => candidate.id === topicId);
  if (!topic) {
    throw new Error(
      `Unknown topic id "${topicId}". Known ids: ${topicList.map((candidate) => candidate.id).join(", ")}`
    );
  }

  const progress = await readProgress(videoFolder);
  const entry = progress.lessons[topicId];
  if (!entry || entry.status !== "done") {
    throw new Error(
      `Topic "${topicId}" has no completed lesson. Run: ytai teach ${videoFolder} ${topicId}, then mark it with: ytai learn ${videoFolder} --done ${topicId} first.`
    );
  }

  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`Score must be an integer between 0 and 100, got "${scoreRaw}".`);
  }

  const now = new Date();
  const scores = [...(entry.scores ?? []), { date: now.toISOString(), score }];
  const nextReviewAt = computeNextReview(scores, now);
  if (!options.dryRun) {
    progress.lessons[topicId] = { ...entry, scores, nextReviewAt };
    await writeProgress(videoFolder, progress);
  }

  if (options.dryRun) {
    info("Dry run", `Would record quiz score ${topicId}: ${score}/100`);
  } else {
    success("Recorded quiz score", `${topicId}: ${score}/100`);
  }
  info("Next review", nextReviewAt);

  const artifacts = await collectArtifacts(videoFolder);
  const stage = computeLearnStage(artifacts);
  const review = reviewState(artifacts.topics, artifacts.progress, now);
  const next = nextAction(stage, artifacts, review);
  info("Next", next.detail);
}

async function markLessonDone(
  videoFolder: string,
  topicId: string,
  options: LearnStatusOptions
): Promise<void> {
  const result = await readTopics(videoFolder);
  if (!result.exists) {
    throw new Error(`learning/topics.json not found. Run: ytai topics ${videoFolder} first.`);
  }
  if (result.issues.some((issue) => issue.severity === "error")) {
    printIssues(result.issues);
    throw new Error("learning/topics.json has validation errors. Fix them before marking lessons done.");
  }

  const topic = result.topics.find((candidate) => candidate.id === topicId);
  if (!topic) {
    throw new Error(
      `Unknown topic id "${topicId}". Known ids: ${result.topics.map((candidate) => candidate.id).join(", ")}`
    );
  }

  const progress = await readProgress(videoFolder);
  let entry = progress.lessons[topicId];
  if (!entry) {
    warn("No lesson was registered for this topic", "marking it done anyway");
    const ordered = orderTopicsForTeaching(result.topics);
    const lessonNumber = ordered.findIndex((candidate) => candidate.id === topicId) + 1;
    entry = {
      status: "pending",
      lessonFile: `lessons/${String(lessonNumber).padStart(2, "0")}-${topicId}.md`
    };
  }
  if (options.dryRun) {
    if (!options.json) {
      info("Dry run", `Would mark lesson done: ${topicId}`);
    }
    return;
  }
  progress.lessons[topicId] = {
    ...entry,
    status: "done",
    completedAt: new Date().toISOString()
  };
  await writeProgress(videoFolder, progress);
  if (!options.json) {
    success("Marked lesson done", topicId);
  }
}

type TopicsReadResult = {
  exists: boolean;
  raw?: string;
  topics: Topic[];
  issues: ValidationIssue[];
};

async function readTopics(videoFolder: string): Promise<TopicsReadResult> {
  const topicsPath = path.join(videoFolder, "learning", "topics.json");
  if (!(await pathExists(topicsPath))) {
    return { exists: false, topics: [], issues: [] };
  }

  const raw = await readFile(topicsPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      exists: true,
      raw,
      topics: [],
      issues: [{ severity: "error", message: `learning/topics.json is not valid JSON: ${reason}` }]
    };
  }

  const issues = validateTopicsFile(parsed, await validationContext(videoFolder));
  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    exists: true,
    raw,
    topics: hasErrors ? [] : (parsed as TopicsFile).topics,
    issues
  };
}

type ConceptsReadResult = {
  exists: boolean;
  issues: ValidationIssue[];
};

async function readConcepts(videoFolder: string, topics: Topic[]): Promise<ConceptsReadResult> {
  const conceptsPath = path.join(videoFolder, "learning", "concepts.json");
  if (!(await pathExists(conceptsPath))) {
    return { exists: false, issues: [] };
  }

  const raw = await readFile(conceptsPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      exists: true,
      issues: [{ severity: "error", message: `learning/concepts.json is not valid JSON: ${reason}` }]
    };
  }

  return {
    exists: true,
    issues: validateConceptsFile(parsed, { topics })
  };
}

type ResourcesReadResult = {
  exists: boolean;
  issues: ValidationIssue[];
};

async function readResources(videoFolder: string, topics: Topic[]): Promise<ResourcesReadResult> {
  const resourcesPath = path.join(videoFolder, "learning", "resources.md");
  if (!(await pathExists(resourcesPath))) {
    return { exists: false, issues: [] };
  }

  try {
    return {
      exists: true,
      issues: validateResourceSections(await readFile(resourcesPath, "utf8"), topics)
    };
  } catch {
    return {
      exists: true,
      issues: [{ severity: "warning", message: "learning/resources.md could not be read for resource validation." }]
    };
  }
}

export async function requireValidTopics(
  videoFolder: string
): Promise<{ raw: string; topics: Topic[] }> {
  const result = await readTopics(videoFolder);
  if (!result.exists) {
    throw new Error(`learning/topics.json not found. Run: ytai topics ${videoFolder} first.`);
  }
  printIssues(result.issues);
  const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
  if (errorCount > 0 || result.raw === undefined) {
    throw new Error(`learning/topics.json has ${errorCount} validation error(s). Fix them and re-run.`);
  }
  return { raw: result.raw, topics: result.topics };
}

async function validationContext(
  videoFolder: string
): Promise<{ durationSeconds?: number; existingPaths: string[] }> {
  const files = await listFilesRecursive(videoFolder);
  return {
    durationSeconds: await readDurationSeconds(videoFolder),
    existingPaths: files.map((file) => path.relative(videoFolder, file).split(path.sep).join("/"))
  };
}

async function readDurationSeconds(videoFolder: string): Promise<number | undefined> {
  try {
    const raw = await readFile(path.join(videoFolder, "metadata.info.json"), "utf8");
    const parsed = JSON.parse(raw) as { duration?: unknown; format?: { duration?: unknown } };
    if (typeof parsed.duration === "number" && Number.isFinite(parsed.duration)) {
      return parsed.duration;
    }
    const nested = parsed.format?.duration;
    const nestedSeconds =
      typeof nested === "number" ? nested : typeof nested === "string" ? Number.parseFloat(nested) : Number.NaN;
    return Number.isFinite(nestedSeconds) ? nestedSeconds : undefined;
  } catch {
    return undefined;
  }
}

async function collectArtifacts(videoFolder: string): Promise<LearnArtifacts> {
  const learningDir = path.join(videoFolder, "learning");
  const topicsResult = await readTopics(videoFolder);
  const conceptsResult = await readConcepts(videoFolder, topicsResult.topics);
  const resourcesResult = await readResources(videoFolder, topicsResult.topics);
  const progress = await readProgress(videoFolder);
  const learningFiles = await listFilesRecursive(learningDir);
  const learningRelative = learningFiles.map((file) =>
    path.relative(learningDir, file).split(path.sep).join("/")
  );

  const lessonOutputs = learningRelative.filter(
    (file) => file.startsWith("lessons/") && file.endsWith(".md") && !file.endsWith("-input.md")
  );

  return {
    videoFolder,
    hasSummaryInput: await pathExists(path.join(videoFolder, "analysis", "summary-input.md")),
    hasTeachingGuideMd: learningRelative.includes("teaching-guide.md"),
    hasTopicsInput: learningRelative.includes("topics-input.md"),
    hasTopicsJson: topicsResult.exists,
    topicsIssues: topicsResult.issues,
    topics: topicsResult.topics,
    lessonIssues: await collectLessonIssues(learningDir, lessonOutputs),
    conceptsIssues: conceptsResult.issues,
    resourcesIssues: resourcesResult.issues,
    hasPlanInput: learningRelative.includes("plan-input.md"),
    hasPlanMd: learningRelative.includes("plan.md"),
    hasResourcesMd: learningRelative.includes("resources.md"),
    hasConceptsJson: conceptsResult.exists,
    progress,
    lessonOutputs
  };
}

export async function readProgress(videoFolder: string): Promise<LearningProgress> {
  try {
    const raw = await readFile(path.join(videoFolder, "learning", "progress.json"), "utf8");
    const parsed = JSON.parse(raw) as LearningProgress;
    if (parsed && typeof parsed === "object" && parsed.lessons && typeof parsed.lessons === "object") {
      return { version: 1, lessons: parsed.lessons };
    }
  } catch {
    // Fall through to an empty progress file.
  }
  return { version: 1, lessons: {} };
}

async function writeProgress(videoFolder: string, progress: LearningProgress): Promise<void> {
  await mkdir(path.join(videoFolder, "learning"), { recursive: true });
  await writeJson(path.join(videoFolder, "learning", "progress.json"), progress);
}

async function collectLessonIssues(learningDir: string, lessonOutputs: string[]): Promise<ValidationIssue[]> {
  const issueGroups = await Promise.all(
    lessonOutputs.map(async (lessonPath) => {
      const fullPath = path.join(learningDir, lessonPath);
      try {
        return validateLessonMarkdown(await readFile(fullPath, "utf8"), lessonPath);
      } catch {
        return [{ severity: "warning" as const, message: `${lessonPath}: could not be read for lesson quality validation.` }];
      }
    })
  );
  return issueGroups.flat();
}

export async function buildTranscriptExcerpt(videoFolder: string, topic: Topic): Promise<string> {
  const transcript =
    (await readOptional(path.join(videoFolder, "transcript.srt"))) ??
    (await readOptional(path.join(videoFolder, "transcript.vtt")));
  if (!transcript) {
    return "_No transcript.srt or transcript.vtt found._";
  }

  const cues = parseTranscriptCues(transcript);
  if (cues.length === 0) {
    return "_Transcript could not be parsed into cues._";
  }

  const sections: string[] = [];
  for (const rangeInput of topic.timestamps) {
    let range;
    try {
      range = parseRange(rangeInput);
    } catch {
      continue;
    }
    const paddedStart = Math.max(0, range.start - EXCERPT_PADDING_SECONDS);
    const paddedEnd = range.end + EXCERPT_PADDING_SECONDS;
    const lines = cues
      .filter((cue) => cue.endSec >= paddedStart && cue.startSec <= paddedEnd)
      .map((cue) => `[${formatSeconds(Math.max(0, Math.floor(cue.startSec)))}] ${cue.text.replace(/\s+/g, " ").trim()}`);
    sections.push(
      [
        `### Range ${rangeInput} (padded ${EXCERPT_PADDING_SECONDS}s each side)`,
        "",
        lines.length > 0 ? lines.join("\n") : "_No transcript cues fall inside this range._"
      ].join("\n")
    );
  }

  return sections.length > 0
    ? sections.join("\n\n")
    : "_This topic declares no timestamp ranges._";
}

async function readLessonRepairContext(
  videoFolder: string,
  lessonFile: string
): Promise<{ existingLessonFile: string; existingLessonMd: string; validationIssues: ValidationIssue[] }> {
  const lessonPath = path.join(videoFolder, "learning", lessonFile);
  let existingLessonMd: string;
  try {
    existingLessonMd = await readFile(lessonPath, "utf8");
  } catch {
    throw new Error(`Existing lesson not found at learning/${lessonFile}. Run ytai teach without --refresh first.`);
  }

  return {
    existingLessonFile: lessonFile,
    existingLessonMd,
    validationIssues: validateLessonMarkdown(existingLessonMd, lessonFile)
  };
}

async function readLessonPromptContext(videoFolder: string) {
  const learningDir = path.join(videoFolder, "learning");
  const [learnerProfileJson, teachingGuideMd, conceptsJson, resourcesMd] = await Promise.all([
    readOptional(path.join(learningDir, "learner-profile.json")),
    readOptional(path.join(learningDir, "teaching-guide.md")),
    readOptional(path.join(learningDir, "concepts.json")),
    readOptional(path.join(learningDir, "resources.md"))
  ]);

  return { learnerProfileJson, teachingGuideMd, conceptsJson, resourcesMd };
}

async function ensureLearnerProfile(videoFolder: string): Promise<void> {
  const profilePath = path.join(videoFolder, "learning", "learner-profile.json");
  if (await pathExists(profilePath)) {
    return;
  }

  await mkdir(path.dirname(profilePath), { recursive: true });
  await writeJson(profilePath, createDefaultLearnerProfile());
}

async function previewLearnerProfileWrite(videoFolder: string): Promise<void> {
  const profilePath = path.join(videoFolder, "learning", "learner-profile.json");
  if (!(await pathExists(profilePath))) {
    info("Dry run", `Would write ${profilePath}`);
  }
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function printIssues(issues: ValidationIssue[]): void {
  for (const issue of issues) {
    warn(issue.severity, issue.message);
  }
}
