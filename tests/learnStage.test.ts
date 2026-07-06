import { describe, expect, it } from "vitest";
import {
  computeLearnStage,
  nextAction,
  type LearnArtifacts,
  type Topic
} from "../src/lib/learning.js";

const FOLDER = "videos/demo";

/** Helper: baseline artifacts with nothing produced yet, overridable per test. */
function artifacts(overrides: Partial<LearnArtifacts> = {}): LearnArtifacts {
  return {
    videoFolder: FOLDER,
    hasSummaryInput: false,
    hasTeachingGuideMd: false,
    hasTopicsInput: false,
    hasTopicsJson: false,
    topicsIssues: [],
    topics: [],
    lessonIssues: [],
    conceptsIssues: [],
    hasPlanInput: false,
    hasPlanMd: false,
    hasResourcesMd: false,
    hasConceptsJson: false,
    progress: { version: 1, lessons: {} },
    lessonOutputs: [],
    ...overrides
  };
}

/** Helper: a minimal topic for stage fixtures. */
function topic(id: string, importance: Topic["importance"], prerequisites?: string[]): Topic {
  return {
    id,
    title: `Title for ${id}`,
    importance,
    timestamps: ["00:00-01:00"],
    summary: `Summary for ${id}.`,
    prerequisites
  };
}

/** Helper: artifacts for a folder that reached the teaching stage. */
function teachingArtifacts(overrides: Partial<LearnArtifacts> = {}): LearnArtifacts {
  return artifacts({
    hasSummaryInput: true,
    hasTopicsInput: true,
    hasTopicsJson: true,
    hasPlanInput: true,
    hasPlanMd: true,
    hasResourcesMd: true,
    hasConceptsJson: true,
    topics: [topic("intro", "core")],
    ...overrides
  });
}

describe("computeLearnStage and nextAction", () => {
  it("no-context: nothing exists, next step is ytai topics", () => {
    const state = artifacts();
    const stage = computeLearnStage(state);
    expect(stage).toBe("no-context");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("cli");
    expect(action.detail).toBe(`ytai topics ${FOLDER}`);
  });

  it("needs-topics-input: summary exists, next step is still ytai topics", () => {
    const state = artifacts({ hasSummaryInput: true });
    const stage = computeLearnStage(state);
    expect(stage).toBe("needs-topics-input");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("cli");
    expect(action.detail).toBe(`ytai topics ${FOLDER}`);
  });

  it("awaiting-topics: topics-input exists, LLM must write topics.json", () => {
    const state = artifacts({ hasSummaryInput: true, hasTopicsInput: true });
    const stage = computeLearnStage(state);
    expect(stage).toBe("awaiting-topics");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("llm");
    expect(action.detail).toContain("learning/topics-input.md");
    expect(action.detail).toContain("learning/topics.json");
    expect(action.detail).toContain(`ytai learn ${FOLDER}`);
  });

  it("awaiting-topics does not require the summary input", () => {
    const state = artifacts({ hasTopicsInput: true });
    expect(computeLearnStage(state)).toBe("awaiting-topics");
  });

  it("topics-invalid: validation errors send the LLM back to topics.json", () => {
    const state = artifacts({
      hasTopicsInput: true,
      hasTopicsJson: true,
      topicsIssues: [{ severity: "error", message: '"topics" must contain at least one topic.' }]
    });
    const stage = computeLearnStage(state);
    expect(stage).toBe("topics-invalid");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("llm");
    expect(action.detail).toContain("learning/topics.json");
    expect(action.detail).toContain(`ytai learn ${FOLDER}`);
  });

  it("warnings alone do not make topics invalid", () => {
    const state = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      topicsIssues: [{ severity: "warning", message: "Prerequisite cycle detected: a -> a." }]
    });
    expect(computeLearnStage(state)).toBe("needs-plan-input");
  });

  it("needs-plan-input: valid topics.json, next step is ytai plan", () => {
    const state = artifacts({ hasTopicsJson: true, topics: [topic("intro", "core")] });
    const stage = computeLearnStage(state);
    expect(stage).toBe("needs-plan-input");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("cli");
    expect(action.detail).toBe(`ytai plan ${FOLDER}`);
  });

  it("awaiting-plan: plan-input exists, LLM must write plan.md, resources.md, and concepts.json", () => {
    const state = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true
    });
    const stage = computeLearnStage(state);
    expect(stage).toBe("awaiting-plan");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("llm");
    expect(action.detail).toContain("learning/plan-input.md");
    expect(action.detail).toContain("learning/plan.md");
    expect(action.detail).toContain("learning/resources.md");
    expect(action.detail).toContain("learning/concepts.json");
    expect(action.detail).toContain(`ytai learn ${FOLDER}`);
  });

  it("awaiting-plan persists until plan.md, resources.md, and concepts.json exist for new folders", () => {
    const planOnly = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true,
      hasPlanMd: true
    });
    expect(computeLearnStage(planOnly)).toBe("awaiting-plan");
    const resourcesOnly = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true,
      hasResourcesMd: true
    });
    expect(computeLearnStage(resourcesOnly)).toBe("awaiting-plan");
    const missingConcepts = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true,
      hasPlanMd: true,
      hasResourcesMd: true
    });
    expect(computeLearnStage(missingConcepts)).toBe("awaiting-plan");
  });

  it("does not move legacy learning folders with lessons backwards when concepts.json is absent", () => {
    const legacy = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true,
      hasPlanMd: true,
      hasResourcesMd: true,
      progress: {
        version: 1,
        lessons: { intro: { status: "pending", lessonFile: "lessons/01-intro.md" } }
      }
    });
    expect(computeLearnStage(legacy)).toBe("teaching");
  });

  it("keeps new folders awaiting-plan while concepts.json has validation errors", () => {
    const state = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true,
      hasPlanMd: true,
      hasResourcesMd: true,
      hasConceptsJson: true,
      conceptsIssues: [{ severity: "error", message: 'concept "bad": neededForTopics entry "missing" does not match any topic id.' }]
    });

    expect(computeLearnStage(state)).toBe("awaiting-plan");
  });

  it("does not move legacy learning folders backwards when concepts.json has validation errors", () => {
    const legacy = artifacts({
      hasTopicsJson: true,
      topics: [topic("intro", "core")],
      hasPlanInput: true,
      hasPlanMd: true,
      hasResourcesMd: true,
      hasConceptsJson: true,
      conceptsIssues: [{ severity: "error", message: 'concept "bad": neededForTopics entry "missing" does not match any topic id.' }],
      progress: {
        version: 1,
        lessons: { intro: { status: "pending", lessonFile: "lessons/01-intro.md" } }
      }
    });

    expect(computeLearnStage(legacy)).toBe("teaching");
  });

  it("teaching with a pending lesson whose output exists: next step is --done", () => {
    const state = teachingArtifacts({
      progress: {
        version: 1,
        lessons: { intro: { status: "pending", lessonFile: "lessons/01-intro.md" } }
      },
      lessonOutputs: ["lessons/01-intro.md"]
    });
    const stage = computeLearnStage(state);
    expect(stage).toBe("teaching");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("cli");
    expect(action.detail).toBe(`ytai learn ${FOLDER} --done intro`);
  });

  it("teaching with a pending lesson and no output: LLM must write the lesson", () => {
    const state = teachingArtifacts({
      progress: {
        version: 1,
        lessons: { intro: { status: "pending", lessonFile: "lessons/01-intro.md" } }
      }
    });
    const stage = computeLearnStage(state);
    expect(stage).toBe("teaching");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("llm");
    expect(action.detail).toContain("learning/lessons/01-intro-input.md");
    expect(action.detail).toContain("learning/lessons/01-intro.md");
    expect(action.detail).toContain(`ytai learn ${FOLDER}`);
  });

  it("teaching with no pending lesson: next step is ytai teach --next", () => {
    const noEntries = teachingArtifacts();
    const stage = computeLearnStage(noEntries);
    expect(stage).toBe("teaching");
    const action = nextAction(stage, noEntries);
    expect(action.kind).toBe("cli");
    expect(action.detail).toBe(`ytai teach ${FOLDER} --next`);
  });

  it("teaching skips done lessons and targets required topics without entries", () => {
    const state = teachingArtifacts({
      topics: [topic("intro", "core"), topic("depths", "supporting")],
      progress: {
        version: 1,
        lessons: {
          intro: { status: "done", lessonFile: "lessons/01-intro.md", completedAt: "2026-07-05" }
        }
      },
      lessonOutputs: ["lessons/01-intro.md"]
    });
    const stage = computeLearnStage(state);
    expect(stage).toBe("teaching");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("cli");
    expect(action.detail).toBe(`ytai teach ${FOLDER} --next`);
  });

  it("teaching targets the pending prerequisite before its dependent", () => {
    const state = teachingArtifacts({
      topics: [topic("advanced", "core", ["basics"]), topic("basics", "core")],
      progress: {
        version: 1,
        lessons: {
          advanced: { status: "pending", lessonFile: "lessons/02-advanced.md" },
          basics: { status: "pending", lessonFile: "lessons/01-basics.md" }
        }
      }
    });
    const action = nextAction("teaching", state);
    expect(action.kind).toBe("llm");
    expect(action.detail).toContain("learning/lessons/01-basics-input.md");
    expect(action.detail).not.toContain("02-advanced");
  });

  it("complete requires all core and supporting topics done", () => {
    const state = teachingArtifacts({
      topics: [topic("intro", "core"), topic("depths", "supporting")],
      progress: {
        version: 1,
        lessons: {
          intro: { status: "done", lessonFile: "lessons/01-intro.md" },
          depths: { status: "pending", lessonFile: "lessons/02-depths.md" }
        }
      }
    });
    expect(computeLearnStage(state)).toBe("teaching");
  });

  it("complete: pending tangent topics do not block completion", () => {
    const state = teachingArtifacts({
      topics: [topic("intro", "core"), topic("depths", "supporting"), topic("aside", "tangent")],
      progress: {
        version: 1,
        lessons: {
          intro: { status: "done", lessonFile: "lessons/01-intro.md" },
          depths: { status: "done", lessonFile: "lessons/02-depths.md" },
          aside: { status: "pending", lessonFile: "lessons/03-aside.md" }
        }
      }
    });
    const stage = computeLearnStage(state);
    expect(stage).toBe("complete");
    const action = nextAction(stage, state);
    expect(action.kind).toBe("cli");
    expect(action.detail).toContain(`ytai teach ${FOLDER} <topic-id>`);
    expect(action.detail).toContain("tangent");
  });
});
