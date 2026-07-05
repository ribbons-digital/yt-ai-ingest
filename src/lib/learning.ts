/**
 * Pure logic for the ytai learning workflow.
 *
 * ytai never calls an AI provider. The learning loop is a round-trip file
 * contract: ytai writes self-contained *-input.md prompt files, any LLM agent
 * writes the result artifacts to agreed paths, and ytai validates those
 * artifacts and computes the next step.
 */
import { parseRange } from "./timestamps.js";

export type TopicImportance = "core" | "supporting" | "tangent";

export type Topic = {
  id: string;
  title: string;
  importance: TopicImportance;
  timestamps: string[];
  summary: string;
  claims?: string[];
  prerequisites?: string[];
  visualEvidence?: string[];
};

export type TopicsFile = {
  version: 1;
  topics: Topic[];
};

export type QuizScore = {
  /** ISO date-time when the quiz was scored. */
  date: string;
  /** Overall quiz score from 0 to 100. */
  score: number;
};

export type LessonProgressEntry = {
  status: "pending" | "done";
  lessonFile: string;
  completedAt?: string;
  /** Quiz results in the order they were recorded. Absent means never quizzed. */
  scores?: QuizScore[];
  /** ISO date-time when this topic is next due for a review quiz. */
  nextReviewAt?: string;
};

export type LearningProgress = {
  version: 1;
  lessons: Record<string, LessonProgressEntry>;
};

export type ValidationIssue = {
  severity: "error" | "warning";
  message: string;
};

export type LearnStage =
  | "no-context"
  | "needs-topics-input"
  | "awaiting-topics"
  | "topics-invalid"
  | "needs-plan-input"
  | "awaiting-plan"
  | "teaching"
  | "complete";

export type NextAction = {
  kind: "cli" | "llm";
  detail: string;
};

export type LearnArtifacts = {
  videoFolder: string;
  hasSummaryInput: boolean;
  hasTeachingGuideMd: boolean;
  hasTopicsInput: boolean;
  hasTopicsJson: boolean;
  topicsIssues: ValidationIssue[];
  topics: Topic[];
  lessonIssues: ValidationIssue[];
  hasPlanInput: boolean;
  hasPlanMd: boolean;
  hasResourcesMd: boolean;
  hasConceptsJson: boolean;
  progress: LearningProgress;
  /** Existing files under learning/, as learning-relative paths like "lessons/01-x.md". */
  lessonOutputs: string[];
};

export type LearnStatusJson = {
  stage: LearnStage;
  artifacts: {
    summaryInput: boolean;
    teachingGuideMd: boolean;
    topicsInput: boolean;
    topicsJson: boolean;
    planInput: boolean;
    planMd: boolean;
    resourcesMd: boolean;
    conceptsJson: boolean;
  };
  lessons: { total: number; done: number; pending: number };
  issues: ValidationIssue[];
  review: ReviewState;
  nextAction: NextAction;
};

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IMPORTANCE_VALUES: readonly string[] = ["core", "supporting", "tangent"];
const IMPORTANCE_RANK: Record<TopicImportance, number> = {
  core: 0,
  supporting: 1,
  tangent: 2
};

export function validateTopicsFile(
  value: unknown,
  opts: { durationSeconds?: number; existingPaths?: string[] } = {}
): ValidationIssue[] {
  if (!isRecord(value)) {
    return [issueError("topics.json must be a JSON object.")];
  }

  const issues: ValidationIssue[] = [];
  if (value.version !== 1) {
    issues.push(issueError(`"version" must be 1, got ${JSON.stringify(value.version)}.`));
  }
  if (!Array.isArray(value.topics)) {
    issues.push(issueError('"topics" must be an array.'));
    return issues;
  }
  if (value.topics.length === 0) {
    issues.push(issueError('"topics" must contain at least one topic.'));
    return issues;
  }

  const rawTopics = value.topics as unknown[];
  const declaredIds = new Set<string>();
  for (const raw of rawTopics) {
    if (isRecord(raw) && typeof raw.id === "string" && raw.id.length > 0) {
      declaredIds.add(raw.id);
    }
  }

  const seenIds = new Set<string>();
  const structuredTopics: Topic[] = [];

  rawTopics.forEach((raw, index) => {
    const label = `topics[${index}]`;
    if (!isRecord(raw)) {
      issues.push(issueError(`${label} must be an object.`));
      return;
    }

    const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined;
    if (!id) {
      issues.push(issueError(`${label} is missing a non-empty string "id".`));
    } else {
      if (!KEBAB_CASE_RE.test(id)) {
        issues.push(
          issueError(`${label} id "${id}" must be kebab-case (lowercase letters, digits, single dashes).`)
        );
      }
      if (seenIds.has(id)) {
        issues.push(issueError(`${label} id "${id}" is a duplicate.`));
      }
      seenIds.add(id);
    }
    const name = id ? `topic "${id}"` : label;

    if (typeof raw.title !== "string" || raw.title.trim() === "") {
      issues.push(issueError(`${name}: "title" must be a non-empty string.`));
    }
    if (typeof raw.importance !== "string" || !IMPORTANCE_VALUES.includes(raw.importance)) {
      issues.push(issueError(`${name}: "importance" must be one of core, supporting, tangent.`));
    }
    if (typeof raw.summary !== "string" || raw.summary.trim() === "") {
      issues.push(issueError(`${name}: "summary" must be a non-empty string.`));
    }

    if (!isStringArray(raw.timestamps)) {
      issues.push(issueError(`${name}: "timestamps" must be an array of "START-END" strings.`));
    } else {
      for (const rangeInput of raw.timestamps) {
        try {
          const range = parseRange(rangeInput);
          if (opts.durationSeconds !== undefined && range.end > opts.durationSeconds) {
            issues.push(
              issueWarning(
                `${name}: timestamp range "${rangeInput}" ends after the video duration (${Math.round(opts.durationSeconds)}s).`
              )
            );
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          issues.push(issueError(`${name}: invalid timestamp range "${rangeInput}": ${reason}`));
        }
      }
    }

    for (const key of ["claims", "prerequisites", "visualEvidence"] as const) {
      if (raw[key] !== undefined && !isStringArray(raw[key])) {
        issues.push(issueError(`${name}: "${key}" must be an array of strings when present.`));
      }
    }

    if (isStringArray(raw.prerequisites)) {
      for (const prerequisite of raw.prerequisites) {
        if (!declaredIds.has(prerequisite)) {
          issues.push(issueError(`${name}: prerequisite "${prerequisite}" does not match any topic id.`));
        }
      }
    }

    if (isStringArray(raw.visualEvidence) && opts.existingPaths !== undefined) {
      for (const evidencePath of raw.visualEvidence) {
        if (!opts.existingPaths.includes(evidencePath)) {
          issues.push(
            issueWarning(`${name}: visualEvidence path "${evidencePath}" was not found in the video folder.`)
          );
        }
      }
    }

    if (id) {
      structuredTopics.push({
        id,
        title: typeof raw.title === "string" ? raw.title : "",
        importance: IMPORTANCE_VALUES.includes(raw.importance as string)
          ? (raw.importance as TopicImportance)
          : "tangent",
        timestamps: isStringArray(raw.timestamps) ? raw.timestamps : [],
        summary: typeof raw.summary === "string" ? raw.summary : "",
        prerequisites: isStringArray(raw.prerequisites) ? raw.prerequisites : undefined
      });
    }
  });

  for (const cycle of findPrerequisiteCycles(structuredTopics)) {
    issues.push(issueWarning(`Prerequisite cycle detected: ${cycle.join(" -> ")}.`));
  }

  return issues;
}
const REQUIRED_LESSON_HEADINGS = [
  "## Learning goal",
  "## Prerequisites and acronyms",
  "## Mental model",
  "## What the video says",
  "## Teach the concept",
  "## Worked example",
  "## Common confusions",
  "## Suggested learning",
  "## Practice"
] as const;

export function validateLessonMarkdown(content: string, lessonPath = "lesson"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let lastIndex = -1;
  for (const heading of REQUIRED_LESSON_HEADINGS) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^${escapedHeading}\\s*$`, "m").exec(content);
    if (!match || match.index === undefined) {
      issues.push(issueWarning(`${lessonPath}: missing required heading "${heading}".`));
      continue;
    }
    if (match.index < lastIndex) {
      issues.push(issueWarning(`${lessonPath}: heading "${heading}" appears out of order.`));
    }
    lastIndex = Math.max(lastIndex, match.index);
  }

  const detailsCount = (content.match(/<details>/g) ?? []).length;
  if (detailsCount !== 3) {
    issues.push(
      issueWarning(
        `${lessonPath}: Practice should include exactly 3 questions with answers in <details> blocks; found ${detailsCount}.`
      )
    );
  }

  if (/^## What the video says\s*$/m.test(content) && !/\[\d{2}:\d{2}/.test(content)) {
    issues.push(issueWarning(`${lessonPath}: video claims should include timestamp citations like [01:23].`));
  }

  return issues;
}


/**
 * Order topics for teaching: topological by prerequisites, ties broken by
 * importance rank (core, supporting, tangent), then stable by input order.
 * Prerequisite cycles never throw; they are broken by input order.
 */
export function orderTopicsForTeaching(topics: Topic[]): Topic[] {
  const indexById = new Map<string, number>();
  topics.forEach((topic, index) => {
    if (!indexById.has(topic.id)) {
      indexById.set(topic.id, index);
    }
  });

  const dependents: number[][] = topics.map(() => []);
  const inDegree: number[] = topics.map(() => 0);
  topics.forEach((topic, index) => {
    const seen = new Set<string>();
    for (const prerequisite of topic.prerequisites ?? []) {
      const prerequisiteIndex = indexById.get(prerequisite);
      if (prerequisiteIndex === undefined || prerequisiteIndex === index || seen.has(prerequisite)) {
        continue;
      }
      seen.add(prerequisite);
      dependents[prerequisiteIndex]!.push(index);
      inDegree[index]! += 1;
    }
  });

  const remaining = new Set<number>(topics.map((_, index) => index));
  const ordered: Topic[] = [];

  while (remaining.size > 0) {
    let pick = -1;
    for (const index of remaining) {
      if (inDegree[index]! > 0) {
        continue;
      }
      if (pick === -1 || comesFirst(topics, index, pick)) {
        pick = index;
      }
    }
    if (pick === -1) {
      // Cycle: break it by taking the earliest remaining topic in input order.
      pick = Math.min(...remaining);
    }
    remaining.delete(pick);
    ordered.push(topics[pick]!);
    for (const dependent of dependents[pick]!) {
      if (remaining.has(dependent)) {
        inDegree[dependent]! -= 1;
      }
    }
  }

  return ordered;
}

export function computeLearnStage(artifacts: LearnArtifacts): LearnStage {
  if (!artifacts.hasTopicsJson) {
    if (artifacts.hasTopicsInput) {
      return "awaiting-topics";
    }
    return artifacts.hasSummaryInput ? "needs-topics-input" : "no-context";
  }
  if (artifacts.topicsIssues.some((issue) => issue.severity === "error")) {
    return "topics-invalid";
  }
  if (!artifacts.hasPlanInput) {
    return "needs-plan-input";
  }
  const progressHasEntries = Object.keys(artifacts.progress.lessons).length > 0;
  const hasLegacyLearningWork = progressHasEntries || artifacts.lessonOutputs.length > 0;
  if (!artifacts.hasPlanMd || !artifacts.hasResourcesMd) {
    return "awaiting-plan";
  }
  if (!artifacts.hasConceptsJson && !hasLegacyLearningWork) {
    return "awaiting-plan";
  }
  const required = artifacts.topics.filter((topic) => topic.importance !== "tangent");
  const allDone = required.every(
    (topic) => artifacts.progress.lessons[topic.id]?.status === "done"
  );
  return allDone ? "complete" : "teaching";
}

export function nextAction(
  stage: LearnStage,
  artifacts: LearnArtifacts,
  review?: ReviewState
): NextAction {
  const folder = artifacts.videoFolder;
  switch (stage) {
    case "no-context":
    case "needs-topics-input":
      return { kind: "cli", detail: `ytai topics ${folder}` };
    case "awaiting-topics":
      return {
        kind: "llm",
        detail: `Read learning/topics-input.md and write learning/topics.json, then run: ytai learn ${folder}`
      };
    case "topics-invalid":
      return {
        kind: "llm",
        detail: `Fix the reported issues in learning/topics.json, then run: ytai learn ${folder}`
      };
    case "needs-plan-input":
      return { kind: "cli", detail: `ytai plan ${folder}` };
    case "awaiting-plan":
      return {
        kind: "llm",
        detail: `Read learning/plan-input.md and write learning/plan.md, learning/resources.md, and learning/concepts.json, then run: ytai learn ${folder}`
      };
    case "teaching":
      return teachingAction(artifacts);
    case "complete":
      if (review !== undefined && (review.due.length > 0 || review.unquizzed.length > 0)) {
        return { kind: "cli", detail: `ytai quiz ${folder} --due` };
      }
      return {
        kind: "cli",
        detail: `All core and supporting topics are done. Optional: ytai teach ${folder} <topic-id> for any remaining tangent topic.`
      };
  }
}

export type ReviewDueEntry = {
  id: string;
  nextReviewAt: string;
  lastScore: number;
};

export type ReviewState = {
  /** Quizzed topics whose review is due, most overdue first. */
  due: ReviewDueEntry[];
  /** Done topics that were never quizzed, in teaching order. */
  unquizzed: string[];
};

const QUIZ_PASS_SCORE = 80;
const MAX_REVIEW_INTERVAL_DAYS = 60;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Spaced-repetition scheduling. A failed quiz (latest score below 80) comes
 * back tomorrow. Each consecutive pass doubles the interval: 1, 2, 4, ... days
 * for a trailing streak of n passes (2^(n-1)), capped at 60 days.
 */
export function computeNextReview(scores: QuizScore[], now: Date): string {
  const latest = scores[scores.length - 1];
  if (!latest || latest.score < QUIZ_PASS_SCORE) {
    return new Date(now.getTime() + DAY_IN_MS).toISOString();
  }
  let streak = 0;
  for (let index = scores.length - 1; index >= 0 && scores[index]!.score >= QUIZ_PASS_SCORE; index -= 1) {
    streak += 1;
  }
  const intervalDays = Math.min(2 ** (streak - 1), MAX_REVIEW_INTERVAL_DAYS);
  return new Date(now.getTime() + intervalDays * DAY_IN_MS).toISOString();
}

/**
 * Review queue over topics whose lesson is done. `due` lists quizzed topics
 * whose next review is at or before `now`, most overdue first. `unquizzed`
 * lists done topics that were never quizzed, in teaching order.
 */
export function reviewState(topics: Topic[], progress: LearningProgress, now: Date): ReviewState {
  const due: ReviewDueEntry[] = [];
  const unquizzed: string[] = [];
  for (const topic of orderTopicsForTeaching(topics)) {
    const entry = progress.lessons[topic.id];
    if (!entry || entry.status !== "done") {
      continue;
    }
    const scores = entry.scores ?? [];
    const latest = scores[scores.length - 1];
    if (!latest) {
      unquizzed.push(topic.id);
      continue;
    }
    if (entry.nextReviewAt !== undefined && Date.parse(entry.nextReviewAt) <= now.getTime()) {
      due.push({ id: topic.id, nextReviewAt: entry.nextReviewAt, lastScore: latest.score });
    }
  }
  due.sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));
  return { due, unquizzed };
}

export function renderTeachingGuideMd(): string {
  return [
    "# Teaching Guide",
    "",
    "This file is the persistent teaching contract for this video folder.",
    "Future LLM sessions should follow it even when no prior chat history is available.",
    "",
    "## Learner goal",
    "",
    "- Let the learner skip watching the full video while still understanding its important topics deeply.",
    "- Build reusable conceptual understanding, not just a timestamped summary.",
    "- Make acronyms, libraries, methods, metrics, and prerequisite ideas explicit before using them.",
    "",
    "## Required teaching style",
    "",
    "- Teach first principles before summarizing what the speaker said.",
    "- Treat the video as evidence, not as the whole lesson.",
    "- Keep video claims separate from background explanation.",
    "- Integrate relevant resources inline at the point they help.",
    "- Use examples and common confusions to make ideas stick.",
    "",
    "## Avoid",
    "",
    "- Do not write transcript summaries and call them lessons.",
    "- Do not assume the learner knows acronyms such as SFT, TRL, LoRA, RL, eval loss, or masking.",
    "- Do not ask questions that send the learner hunting through the transcript.",
    "- Do not hide essential learning in resources.md.",
    "",
    "## Practice contract",
    "",
    "- Practice questions should reinforce transferable concepts.",
    "- Prefer explain, compare, apply, and diagnose questions.",
    "- Include answers in lesson practice sections.",
    "- For oral quizzes, ask one question at a time and grade against the lesson and video evidence.",
    ""
  ].join("\n");
}

export function renderTopicsInputMd(evidence: string, videoFolder: string): string {
  return [
    "# Topic Extraction Task",
    "",
    "## Role",
    "",
    "You are a careful learning-content analyst.",
    "You extract teachable topics from one specific video using only the evidence embedded at the end of this file.",
    "",
    "## Task",
    "",
    "Read the evidence document below.",
    "Extract between 4 and 12 topics that a learner should study to understand this video.",
    `Write the result as strict JSON to \`learning/topics.json\` inside the video folder \`${videoFolder}\`.`,
    "",
    "## Output schema (topics.json, version 1)",
    "",
    "```",
    "{",
    '  "version": 1,',
    '  "topics": [',
    "    {",
    '      "id": "kebab-case-unique",',
    '      "title": "Human title",',
    '      "importance": "core" | "supporting" | "tangent",',
    '      "timestamps": ["MM:SS-MM:SS" or "HH:MM:SS-HH:MM:SS", ...],',
    '      "summary": "2-4 sentence summary of what the video says",',
    '      "claims": ["specific claims made in the video", ...],',
    '      "prerequisites": ["other-topic-id", ...],',
    '      "visualEvidence": ["frames/scout/frame_0007.jpg", ...]',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Field rules:",
    "",
    "- `id`: unique kebab-case identifier, for example `attention-mechanism`.",
    "- `title`: short human-readable title.",
    "- `importance`: `core`, `supporting`, or `tangent`.",
    "- `timestamps`: one or more ranges in `MM:SS-MM:SS` or `HH:MM:SS-HH:MM:SS` format with end after start.",
    "- `summary`: 2 to 4 sentences describing what the video actually says about this topic.",
    "- `claims` (optional): specific claims made in the video.",
    "- `prerequisites` (optional): ids of other topics in this same file that should be learned first.",
    "- `visualEvidence` (optional): relative paths to frames or contact sheets inside the video folder.",
    "",
    "### Valid example",
    "",
    "```json",
    "{",
    '  "version": 1,',
    '  "topics": [',
    "    {",
    '      "id": "gradient-descent-basics",',
    '      "title": "Gradient descent basics",',
    '      "importance": "core",',
    '      "timestamps": ["02:10-05:40"],',
    '      "summary": "The video walks through gradient descent on a simple loss surface. It shows how the learning rate changes convergence.",',
    '      "claims": ["A smaller learning rate converges more slowly but more reliably."],',
    '      "prerequisites": [],',
    '      "visualEvidence": ["frames/scout/frame_0003.jpg"]',
    "    },",
    "    {",
    '      "id": "learning-rate-schedules",',
    '      "title": "Learning rate schedules",',
    '      "importance": "supporting",',
    '      "timestamps": ["05:40-08:15"],',
    '      "summary": "The video compares constant and decaying learning rates. It recommends cosine decay for the demo task.",',
    '      "prerequisites": ["gradient-descent-basics"]',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "## Quality bar",
    "",
    "- Every timestamp range must come from the transcript or scout evidence below. Never invent times.",
    "- Claims must be faithful to what the video actually says. Do not add outside knowledge to `claims`.",
    "- Prefer fewer well-evidenced topics over many thin ones.",
    "- Mark a topic `core` only when the video treats it as central.",
    "- Ids must be kebab-case and unique. Prerequisites must reference ids that exist in this file.",
    "",
    "## Evidence",
    "",
    "Everything between the horizontal rules below is the evidence document for this video.",
    "",
    "---",
    "",
    evidence.trim(),
    "",
    "---",
    "",
    "## When you are done",
    "",
    `After writing \`learning/topics.json\`, run: \`ytai learn ${videoFolder}\` to validate the file and get the next step.`,
    ""
  ].join("\n");
}

export function renderPlanInputMd(topicsJson: string, videoFolder: string): string {
  return [
    "# Learning Plan Task",
    "",
    "## Role",
    "",
    "You are a curriculum designer and teaching architect.",
    "You turn extracted video topics into a persistent study plan, resource list, and concept scaffold that any future LLM can use.",
    "",
    "## Task",
    "",
    "Write three files inside the video folder:",
    "",
    `1. \`learning/plan.md\` inside \`${videoFolder}\``,
    `2. \`learning/resources.md\` inside \`${videoFolder}\``,
    `3. \`learning/concepts.json\` inside \`${videoFolder}\``,
    "",
    "## plan.md requirements",
    "",
    "- Order the topics into stages that respect the `prerequisites` declared in topics.json below.",
    "- For each topic include: why it matters, a depth target (`skim`, `learn`, or `master`), an estimated time, and what to check before moving on.",
    "- Include the prerequisite concepts a learner should understand before each stage.",
    "",
    "## resources.md requirements",
    "",
    "- For each `core` topic list 2 to 4 external resources.",
    "- Each resource needs a URL, one line on why it helps, and one line saying what the learner should focus on.",
    "- Use your own search tools or knowledge to find resources.",
    "- Mark any link you could not verify as `(unverified)`.",
    "",
    "## concepts.json requirements",
    "",
    "Define prerequisite concepts, acronyms, libraries, methods, and background terms that a learner needs before the lessons can teach well.",
    "Write strict JSON with this shape:",
    "",
    "```json",
    "{",
    "  \"version\": 1,",
    "  \"concepts\": [",
    "    {",
    "      \"id\": \"kebab-case-unique\",",
    "      \"term\": \"SFT\",",
    "      \"type\": \"acronym | library | method | metric | tool | background\",",
    "      \"plainDefinition\": \"Beginner-friendly definition in 1-3 sentences.\",",
    "      \"whyItMatters\": \"Why this concept matters for understanding the video.\",",
    "      \"neededForTopics\": [\"topic-id\"],",
    "      \"confusions\": [\"Common misconception to prevent.\"]",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Rules for concepts.json:",
    "- Include every acronym or named tool that a learner may not know.",
    "- Include concepts that are not explicit topics but are prerequisites for understanding the topics.",
    "- `neededForTopics` must only reference topic ids from topics.json.",
    "",
    "## Quality bar",
    "",
    "- The stage order must never place a topic before one of its prerequisites.",
    "- Keep the plan actionable: a learner should know exactly what to do next at every stage.",
    "- Do not hide essential learning in resources.md. Resources are extensions; plan.md and concepts.json must make the path understandable.",
    "",
    "## topics.json",
    "",
    "```json",
    topicsJson.trim(),
    "```",
    "",
    "## When you are done",
    "",
    `After writing all three files, run: \`ytai learn ${videoFolder}\` to validate them and get the next step.`,
    ""
  ].join("\n");
}

export function renderLessonInputMd(
  topic: Topic,
  lessonNumber: number,
  transcriptExcerpt: string,
  videoFolder: string
): string {
  const paddedNumber = String(lessonNumber).padStart(2, "0");
  const outputFile = `learning/lessons/${paddedNumber}-${topic.id}.md`;
  const visualEvidence =
    topic.visualEvidence && topic.visualEvidence.length > 0
      ? topic.visualEvidence.map((evidencePath) => `- \`${evidencePath}\``).join("\n")
      : "_No visual evidence paths recorded for this topic._";

  return [
    `# Lesson Task: ${topic.title}`,
    "",
    "## Role",
    "",
    "You are a patient teacher, not a video summarizer.",
    `You are writing lesson ${paddedNumber} about "${topic.title}" for a learner who may not have watched this video.`,
    "The learner wants to skip the video but still build durable understanding of the topic and its prerequisites.",
    "",
    "## Task",
    "",
    `Write the lesson as Markdown to \`${outputFile}\` inside the video folder \`${videoFolder}\`.`,
    "",
    "Before writing, read these persistent learning files when they exist:",
    "- `learning/teaching-guide.md` for the learner experience contract.",
    "- `learning/concepts.json` for acronyms, tools, methods, metrics, and prerequisite concepts to define.",
    "- `learning/resources.md` for inline suggested learning.",
    "",
    "## Required sections (in this order)",
    "",
    `1. \`# ${topic.title}\``,
    "2. `## Learning goal` - state what the learner should understand or be able to do after the lesson.",
    "3. `## Prerequisites and acronyms` - explain every acronym, library, method, and background term before using it.",
    "4. `## Mental model` - give a simple diagram, analogy, or flow that makes the concept stick.",
    "5. `## What the video says` - short timestamped evidence from the transcript and visual evidence.",
    "6. `## Teach the concept` - the actual lesson. Do not treat the transcript excerpt as the lesson.",
    "7. `## Worked example` - apply the concept to the video's domain or a small concrete scenario.",
    "8. `## Common confusions` - name likely misunderstandings and correct them.",
    "9. `## Suggested learning` - point to specific resources and say what to focus on or ignore for now.",
    "10. `## Practice` - exactly 3 questions with answers in `<details>` blocks.",
    "",
    "## Quality bar",
    "",
    "- Cite a timestamp for every claim about the video.",
    "- Keep the video's claims separate from your own added explanation.",
    "- Explain every acronym, library, method, and background term before using it.",
    "- Teach prerequisite concepts even when the video only mentions them briefly.",
    "- Practice must reinforce concepts, not send the learner hunting through the transcript.",
    "- The lesson must stand alone for a learner in a future session with a different LLM.",
    "",
    "## Topic",
    "",
    "```json",
    JSON.stringify(topic, null, 2),
    "```",
    "",
    "## Visual evidence",
    "",
    visualEvidence,
    "",
    "## Transcript excerpt",
    "",
    transcriptExcerpt.trim(),
    "",
    "## When you are done",
    "",
    `After writing \`${outputFile}\`, run: \`ytai learn ${videoFolder}\` to validate it and get the next step.`,
    ""
  ].join("\n");
}

export function renderQuizInputMd(
  topic: Topic,
  lessonNumber: number,
  lessonContent: string | undefined,
  transcriptExcerpt: string,
  videoFolder: string
): string {
  const paddedNumber = String(lessonNumber).padStart(2, "0");
  const lessonSection = lessonContent
    ? [
        "Everything between the horizontal rules below is the lesson the learner studied, verbatim.",
        "",
        "---",
        "",
        lessonContent.trim(),
        "",
        "---"
      ].join("\n")
    : "_No lesson file was found for this topic. Quiz from the topic summary and the transcript excerpt instead._";

  return [
    `# Quiz Task: ${topic.title}`,
    "",
    "## Role",
    "",
    "You are a strict but encouraging oral examiner.",
    `You are quizzing a learner on lesson ${paddedNumber}, "${topic.title}", from a video they studied through ytai.`,
    "",
    "## Task",
    "",
    "Conduct the quiz in this conversation. Do not write any output file: the conversation is the exam, and only the final score gets recorded through the CLI.",
    "",
    "1. Ask 3 to 5 questions about this topic, ONE AT A TIME. After each question, stop and wait for the learner's answer before asking the next one.",
    "2. Test transferable understanding: definitions, distinctions, worked examples, failure modes, and application to new cases.",
    "3. Grade each answer against the lesson and video evidence below, citing timestamps in corrections when the correction depends on the video.",
    "4. Never reveal an answer before the learner has attempted the question.",
    "5. After the last question, compute an overall score from 0 to 100 and state the rubric: concept accuracy, ability to distinguish related ideas, and ability to apply the idea.",
    "",
    "## Quality bar",
    "",
    "- Every question must be answerable from the lesson or the transcript excerpt below.",
    "- Do not ask transcript scavenger-hunt questions or questions about exact wording.",
    "- Prefer questions that require the learner to explain, compare, apply, or diagnose.",
    "- Be encouraging, but never inflate the score.",
    "",
    "## Topic",
    "",
    "```json",
    JSON.stringify(topic, null, 2),
    "```",
    "",
    "## Lesson",
    "",
    lessonSection,
    "",
    "## Transcript excerpt",
    "",
    transcriptExcerpt.trim(),
    "",
    "## When you are done",
    "",
    `After the last answer is graded, announce the overall score, then record it by running: \`ytai score ${videoFolder} ${topic.id} <score>\`.`,
    `Afterwards run: \`ytai learn ${videoFolder} --json\` to get the next step.`,
    ""
  ].join("\n");
}

export function renderLearnStatus(
  stage: LearnStage,
  artifacts: LearnArtifacts,
  next: NextAction,
  review: ReviewState
): string {
  const counts = lessonCounts(artifacts);
  const lines: string[] = [
    `Learning status for ${artifacts.videoFolder}`,
    "",
    `Stage: ${stage}`,
    "",
    "Artifacts:",
    `  ${statusMark(artifacts.hasSummaryInput)} analysis/summary-input.md`,
    `  ${statusMark(artifacts.hasTeachingGuideMd)} learning/teaching-guide.md`,
    `  ${statusMark(artifacts.hasTopicsInput)} learning/topics-input.md`,
    `  ${statusMark(artifacts.hasTopicsJson)} learning/topics.json`,
    `  ${statusMark(artifacts.hasPlanInput)} learning/plan-input.md`,
    `  ${statusMark(artifacts.hasPlanMd)} learning/plan.md`,
    `  ${statusMark(artifacts.hasResourcesMd)} learning/resources.md`,
    `  ${statusMark(artifacts.hasConceptsJson)} learning/concepts.json`,
    "",
    `Lessons: ${counts.done}/${counts.total} done, ${counts.pending} pending`,
    `Reviews: ${review.due.length} due, ${review.unquizzed.length} never quizzed`
  ];

  if (review.due.length > 0 || review.unquizzed.length > 0) {
    lines.push("", `Quiz next: ytai quiz ${artifacts.videoFolder} --due`);
  }

  const issues = [...artifacts.topicsIssues, ...artifacts.lessonIssues];
  if (issues.length > 0) {
    lines.push("", "Issues:");
    for (const issue of issues) {
      lines.push(`  - ${issue.severity}: ${issue.message}`);
    }
  }

  lines.push("", `Next [${next.kind}]: ${next.detail}`);
  return lines.join("\n");
}

export function toStatusJson(
  stage: LearnStage,
  artifacts: LearnArtifacts,
  next: NextAction,
  review: ReviewState
): LearnStatusJson {
  return {
    stage,
    artifacts: {
      summaryInput: artifacts.hasSummaryInput,
      teachingGuideMd: artifacts.hasTeachingGuideMd,
      topicsInput: artifacts.hasTopicsInput,
      topicsJson: artifacts.hasTopicsJson,
      planInput: artifacts.hasPlanInput,
      planMd: artifacts.hasPlanMd,
      resourcesMd: artifacts.hasResourcesMd,
      conceptsJson: artifacts.hasConceptsJson
    },
    lessons: lessonCounts(artifacts),
    issues: [...artifacts.topicsIssues, ...artifacts.lessonIssues],
    review,
    nextAction: next
  };
}

function teachingAction(artifacts: LearnArtifacts): NextAction {
  const folder = artifacts.videoFolder;
  for (const topic of orderTopicsForTeaching(artifacts.topics)) {
    const entry = artifacts.progress.lessons[topic.id];
    if (!entry || entry.status === "done") {
      continue;
    }
    if (artifacts.lessonOutputs.includes(entry.lessonFile)) {
      return { kind: "cli", detail: `ytai learn ${folder} --done ${topic.id}` };
    }
    const inputFile = entry.lessonFile.replace(/\.md$/, "-input.md");
    return {
      kind: "llm",
      detail: `Read learning/${inputFile} and write learning/${entry.lessonFile}, then run: ytai learn ${folder}`
    };
  }
  return { kind: "cli", detail: `ytai teach ${folder} --next` };
}

function lessonCounts(artifacts: LearnArtifacts): { total: number; done: number; pending: number } {
  const total = artifacts.topics.length;
  const done = artifacts.topics.filter(
    (topic) => artifacts.progress.lessons[topic.id]?.status === "done"
  ).length;
  return { total, done, pending: total - done };
}

function comesFirst(topics: Topic[], a: number, b: number): boolean {
  const rankA = IMPORTANCE_RANK[topics[a]!.importance];
  const rankB = IMPORTANCE_RANK[topics[b]!.importance];
  return rankA !== rankB ? rankA < rankB : a < b;
}

function findPrerequisiteCycles(topics: Topic[]): string[][] {
  const byId = new Map<string, Topic>();
  for (const topic of topics) {
    if (!byId.has(topic.id)) {
      byId.set(topic.id, topic);
    }
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "done") {
      return;
    }
    if (current === "visiting") {
      const start = stack.indexOf(id);
      if (start !== -1) {
        cycles.push([...stack.slice(start), id]);
      }
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) {
      if (byId.has(prerequisite)) {
        visit(prerequisite);
      }
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const topic of topics) {
    visit(topic.id);
  }
  return cycles;
}

function statusMark(present: boolean): string {
  return present ? "[x]" : "[ ]";
}

function issueError(message: string): ValidationIssue {
  return { severity: "error", message };
}

function issueWarning(message: string): ValidationIssue {
  return { severity: "warning", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
