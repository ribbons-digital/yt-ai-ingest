import { describe, expect, it } from "vitest";
import {
  findTopicResourceSection,
  orderTopicsForTeaching,
  renderLessonInputMd,
  renderPlanInputMd,
  renderTeachingGuideMd,
  renderTopicsInputMd,
  validateTopicsFile,
  validateConceptsFile,
  validateResourceSections,
  validateLessonMarkdown,
  type Topic,
  type ValidationIssue
} from "../src/lib/learning.js";

/** Helper: a structurally valid raw topic object, overridable per test. */
function rawTopic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gradient-descent",
    title: "Gradient descent",
    importance: "core",
    timestamps: ["00:10-01:30"],
    summary: "Explains how gradient descent minimizes the loss.",
    ...overrides
  };
}

/** Helper: wrap raw topics into a version-1 topics.json value. */
function topicsFile(topics: unknown[]): Record<string, unknown> {
  return { version: 1, topics };
}

/** Helper: a structurally valid raw concept object, overridable per test. */
function rawConcept(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "loss-function",
    term: "Loss function",
    type: "method",
    plainDefinition: "A score that says how wrong a model prediction is.",
    whyItMatters: "Gradient descent needs a target to reduce.",
    neededForTopics: ["gradient-descent"],
    ...overrides
  };
}

/** Helper: wrap raw concepts into a version-1 concepts.json value. */
function conceptsFile(concepts: unknown[]): Record<string, unknown> {
  return { version: 1, concepts };
}

function errorMessages(issues: ValidationIssue[]): string[] {
  return issues.filter((issue) => issue.severity === "error").map((issue) => issue.message);
}

function warningMessages(issues: ValidationIssue[]): string[] {
  return issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);
}

/** Helper: a typed Topic for ordering tests. */
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

describe("validateTopicsFile", () => {
  it("accepts a fully populated valid file with no issues at all", () => {
    const value = topicsFile([
      rawTopic({
        claims: ["A smaller learning rate converges more reliably."],
        prerequisites: [],
        visualEvidence: ["frames/scout/frame_0003.jpg"]
      }),
      rawTopic({
        id: "learning-rate-schedules",
        title: "Learning rate schedules",
        importance: "supporting",
        timestamps: ["01:30-02:45", "03:00-03:30"],
        prerequisites: ["gradient-descent"]
      })
    ]);
    const issues = validateTopicsFile(value, {
      durationSeconds: 600,
      existingPaths: ["frames/scout/frame_0003.jpg"]
    });
    expect(issues).toEqual([]);
  });

  it("rejects non-object roots with a single error", () => {
    for (const value of [null, undefined, "text", 42, [topicsFile([rawTopic()])]]) {
      expect(validateTopicsFile(value)).toEqual([
        { severity: "error", message: "topics.json must be a JSON object." }
      ]);
    }
  });

  it("rejects a wrong or missing version", () => {
    expect(errorMessages(validateTopicsFile({ version: 2, topics: [rawTopic()] }))).toContain(
      '"version" must be 1, got 2.'
    );
    expect(errorMessages(validateTopicsFile({ topics: [rawTopic()] }))).toContain(
      '"version" must be 1, got undefined.'
    );
  });

  it("rejects a non-array topics field and stops validating deeper", () => {
    const issues = validateTopicsFile({ version: 1, topics: "not-an-array" });
    expect(issues).toEqual([{ severity: "error", message: '"topics" must be an array.' }]);
  });

  it("rejects an empty topics array", () => {
    const issues = validateTopicsFile(topicsFile([]));
    expect(issues).toEqual([
      { severity: "error", message: '"topics" must contain at least one topic.' }
    ]);
  });

  it("rejects a non-object topic entry", () => {
    const issues = validateTopicsFile(topicsFile([rawTopic(), 42]));
    expect(errorMessages(issues)).toContain("topics[1] must be an object.");
  });

  it("rejects a missing or empty id", () => {
    const missing = validateTopicsFile(topicsFile([rawTopic({ id: undefined })]));
    expect(errorMessages(missing)).toContain('topics[0] is missing a non-empty string "id".');
    const empty = validateTopicsFile(topicsFile([rawTopic({ id: "" })]));
    expect(errorMessages(empty)).toContain('topics[0] is missing a non-empty string "id".');
  });

  it("rejects non-kebab-case ids", () => {
    for (const badId of ["Bad_ID", "camelCase", "double--dash", "-leading", "trailing-"]) {
      const issues = validateTopicsFile(topicsFile([rawTopic({ id: badId })]));
      expect(errorMessages(issues)).toContain(
        `topics[0] id "${badId}" must be kebab-case (lowercase letters, digits, single dashes).`
      );
    }
  });

  it("rejects duplicate ids", () => {
    const issues = validateTopicsFile(topicsFile([rawTopic(), rawTopic()]));
    expect(errorMessages(issues)).toContain('topics[1] id "gradient-descent" is a duplicate.');
  });

  it("rejects a missing or blank title", () => {
    for (const title of [undefined, "", "   "]) {
      const issues = validateTopicsFile(topicsFile([rawTopic({ title })]));
      expect(errorMessages(issues)).toContain(
        'topic "gradient-descent": "title" must be a non-empty string.'
      );
    }
  });

  it("rejects an unknown importance", () => {
    const issues = validateTopicsFile(topicsFile([rawTopic({ importance: "critical" })]));
    expect(errorMessages(issues)).toContain(
      'topic "gradient-descent": "importance" must be one of core, supporting, tangent.'
    );
  });

  it("rejects a missing or blank summary", () => {
    for (const summary of [undefined, "", "  "]) {
      const issues = validateTopicsFile(topicsFile([rawTopic({ summary })]));
      expect(errorMessages(issues)).toContain(
        'topic "gradient-descent": "summary" must be a non-empty string.'
      );
    }
  });

  it("rejects timestamps that are not an array of strings", () => {
    for (const timestamps of ["00:10-01:30", [42], undefined]) {
      const issues = validateTopicsFile(topicsFile([rawTopic({ timestamps })]));
      expect(errorMessages(issues)).toContain(
        'topic "gradient-descent": "timestamps" must be an array of "START-END" strings.'
      );
    }
  });

  it("rejects a malformed timestamp range with the parser reason", () => {
    const issues = validateTopicsFile(topicsFile([rawTopic({ timestamps: ["banana"] })]));
    expect(errorMessages(issues)).toContain(
      'topic "gradient-descent": invalid timestamp range "banana": Expected range in START-END format, got "banana".'
    );
  });

  it("rejects a range whose end is not after its start", () => {
    for (const range of ["02:00-01:00", "01:00-01:00"]) {
      const issues = validateTopicsFile(topicsFile([rawTopic({ timestamps: [range] })]));
      expect(errorMessages(issues)).toContain(
        `topic "gradient-descent": invalid timestamp range "${range}": Range end must be after start, got "${range}".`
      );
    }
  });

  it("rejects non-string-array optional fields when present", () => {
    for (const key of ["claims", "prerequisites", "visualEvidence"] as const) {
      const issues = validateTopicsFile(topicsFile([rawTopic({ [key]: [1] })]));
      expect(errorMessages(issues)).toContain(
        `topic "gradient-descent": "${key}" must be an array of strings when present.`
      );
    }
  });

  it("rejects prerequisites that reference unknown topic ids", () => {
    const issues = validateTopicsFile(
      topicsFile([rawTopic({ prerequisites: ["missing-topic"] })])
    );
    expect(errorMessages(issues)).toContain(
      'topic "gradient-descent": prerequisite "missing-topic" does not match any topic id.'
    );
  });

  it("warns when a range ends after the video duration", () => {
    const issues = validateTopicsFile(topicsFile([rawTopic({ timestamps: ["00:10-02:00"] })]), {
      durationSeconds: 90.4
    });
    expect(errorMessages(issues)).toEqual([]);
    expect(warningMessages(issues)).toContain(
      'topic "gradient-descent": timestamp range "00:10-02:00" ends after the video duration (90s).'
    );
  });

  it("does not warn about duration when durationSeconds is omitted", () => {
    const issues = validateTopicsFile(topicsFile([rawTopic({ timestamps: ["00:10-02:00"] })]));
    expect(issues).toEqual([]);
  });

  it("warns on prerequisite cycles without erroring", () => {
    const issues = validateTopicsFile(
      topicsFile([
        rawTopic({ id: "topic-a", prerequisites: ["topic-b"] }),
        rawTopic({ id: "topic-b", prerequisites: ["topic-a"] })
      ])
    );
    expect(errorMessages(issues)).toEqual([]);
    expect(warningMessages(issues)).toContain(
      "Prerequisite cycle detected: topic-a -> topic-b -> topic-a."
    );
  });

  it("warns when visualEvidence is missing from existingPaths", () => {
    const issues = validateTopicsFile(
      topicsFile([rawTopic({ visualEvidence: ["frames/scout/missing.jpg"] })]),
      { existingPaths: ["frames/scout/other.jpg"] }
    );
    expect(errorMessages(issues)).toEqual([]);
    expect(warningMessages(issues)).toContain(
      'topic "gradient-descent": visualEvidence path "frames/scout/missing.jpg" was not found in the video folder.'
    );
  });

  it("does not warn about visualEvidence when existingPaths is omitted", () => {
    const issues = validateTopicsFile(
      topicsFile([rawTopic({ visualEvidence: ["frames/scout/missing.jpg"] })])
    );
    expect(issues).toEqual([]);
  });
});

describe("validateConceptsFile", () => {
  const topics = [topic("gradient-descent", "core"), topic("optimization", "supporting")];

  it("accepts a fully populated valid file with no issues at all", () => {
    const issues = validateConceptsFile(
      conceptsFile([
        rawConcept({ neededForTopics: ["gradient-descent"] }),
        rawConcept({ id: "learning-rate", term: "Learning rate", neededForTopics: ["optimization"] })
      ]),
      { topics }
    );

    expect(issues).toEqual([]);
  });

  it("rejects non-object roots with a single error", () => {
    for (const value of [null, undefined, "text", 42, [conceptsFile([rawConcept()])]]) {
      expect(validateConceptsFile(value)).toEqual([
        { severity: "error", message: "concepts.json must be a JSON object." }
      ]);
    }
  });

  it("rejects a wrong or missing version", () => {
    expect(errorMessages(validateConceptsFile({ version: 2, concepts: [rawConcept()] }))).toContain(
      '"version" must be 1, got 2.'
    );
    expect(errorMessages(validateConceptsFile({ concepts: [rawConcept()] }))).toContain(
      '"version" must be 1, got undefined.'
    );
  });

  it("rejects a non-array concepts field and stops validating deeper", () => {
    const issues = validateConceptsFile({ version: 1, concepts: "not-an-array" });
    expect(issues).toEqual([{ severity: "error", message: '"concepts" must be an array.' }]);
  });

  it("rejects a non-object concept entry", () => {
    const issues = validateConceptsFile(conceptsFile([rawConcept(), 42]));
    expect(errorMessages(issues)).toContain("concepts[1] must be an object.");
  });

  it("rejects missing, non-kebab-case, and duplicate ids", () => {
    expect(errorMessages(validateConceptsFile(conceptsFile([rawConcept({ id: undefined })])))).toContain(
      'concepts[0] is missing a non-empty string "id".'
    );
    expect(errorMessages(validateConceptsFile(conceptsFile([rawConcept({ id: "Bad_ID" })])))).toContain(
      'concepts[0] id "Bad_ID" must be kebab-case (lowercase letters, digits, single dashes).'
    );
    expect(errorMessages(validateConceptsFile(conceptsFile([rawConcept(), rawConcept()])))).toContain(
      'concepts[1] id "loss-function" is a duplicate.'
    );
  });

  it("rejects missing or blank required string fields", () => {
    for (const key of ["term", "type", "plainDefinition", "whyItMatters"] as const) {
      const issues = validateConceptsFile(conceptsFile([rawConcept({ [key]: "   " })]));
      expect(errorMessages(issues)).toContain(`concept "loss-function": "${key}" must be a non-empty string.`);
    }
  });

  it("rejects neededForTopics that are not an array of strings", () => {
    for (const neededForTopics of ["gradient-descent", [42], undefined]) {
      const issues = validateConceptsFile(conceptsFile([rawConcept({ neededForTopics })]));
      expect(errorMessages(issues)).toContain(
        'concept "loss-function": "neededForTopics" must be an array of topic id strings.'
      );
    }
  });

  it("rejects neededForTopics entries that reference unknown topic ids", () => {
    const issues = validateConceptsFile(conceptsFile([rawConcept({ neededForTopics: ["missing-topic"] })]), {
      topics
    });
    expect(errorMessages(issues)).toContain(
      'concept "loss-function": neededForTopics entry "missing-topic" does not match any topic id.'
    );
  });

  it("warns when a core topic has no concept coverage", () => {
    const issues = validateConceptsFile(conceptsFile([rawConcept({ neededForTopics: ["optimization"] })]), {
      topics
    });

    expect(errorMessages(issues)).toEqual([]);
    expect(warningMessages(issues)).toContain(
      'core topic "gradient-descent" has no concept coverage in concepts.json.'
    );
  });
});

describe("orderTopicsForTeaching", () => {
  it("places prerequisites before dependents regardless of input order", () => {
    const ordered = orderTopicsForTeaching([
      topic("dependent", "core", ["base"]),
      topic("base", "core")
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["base", "dependent"]);
  });

  it("orders ready topics by importance rank", () => {
    const ordered = orderTopicsForTeaching([
      topic("tangent-topic", "tangent"),
      topic("core-topic", "core"),
      topic("supporting-topic", "supporting")
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([
      "core-topic",
      "supporting-topic",
      "tangent-topic"
    ]);
  });

  it("is stable for topics with equal importance", () => {
    const ordered = orderTopicsForTeaching([
      topic("supp-1", "supporting"),
      topic("core-1", "core"),
      topic("supp-2", "supporting"),
      topic("core-2", "core")
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["core-1", "core-2", "supp-1", "supp-2"]);
  });

  it("breaks cycles by earliest input index without throwing", () => {
    const ordered = orderTopicsForTeaching([
      topic("cycle-a", "tangent", ["cycle-b"]),
      topic("cycle-b", "core", ["cycle-a"]),
      topic("free", "supporting")
    ]);
    // "free" is the only ready topic; the cycle then breaks at index 0
    // even though cycle-b outranks cycle-a on importance.
    expect(ordered.map((entry) => entry.id)).toEqual(["free", "cycle-a", "cycle-b"]);
  });

  it("ignores unknown prerequisites", () => {
    const ordered = orderTopicsForTeaching([
      topic("with-ghost", "supporting", ["ghost"]),
      topic("plain", "core")
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["plain", "with-ghost"]);
  });

  it("ignores self prerequisites", () => {
    const ordered = orderTopicsForTeaching([
      topic("self-loop", "core", ["self-loop"]),
      topic("other", "supporting")
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["self-loop", "other"]);
  });
});

describe("renderTopicsInputMd", () => {
  const folder = "videos/demo";
  const evidence = "  EVIDENCE BODY with **markdown** and [00:12] cites  ";
  const output = renderTopicsInputMd(evidence, folder);

  it("names the output path inside the video folder", () => {
    expect(output).toContain(
      "Write the result as strict JSON to `learning/topics.json` inside the video folder `videos/demo`."
    );
  });

  it("documents the version-1 schema", () => {
    expect(output).toContain('"version": 1,');
    expect(output).toContain('"importance": "core" | "supporting" | "tangent",');
    expect(output).toContain('"timestamps": ["MM:SS-MM:SS" or "HH:MM:SS-HH:MM:SS", ...],');
  });

  it("embeds the trimmed evidence verbatim between horizontal rules", () => {
    expect(output).toContain(
      "---\n\nEVIDENCE BODY with **markdown** and [00:12] cites\n\n---"
    );
  });

  it("ends with the ytai learn verification instruction", () => {
    expect(output).toContain(
      "After writing `learning/topics.json`, run: `ytai learn videos/demo` to validate the file and get the next step."
    );
  });
});

describe("renderTeachingGuideMd", () => {
  const output = renderTeachingGuideMd();

  it("persists the durable teaching contract", () => {
    expect(output).toContain("# Teaching Guide");
    expect(output).toContain("Future LLM sessions should follow it");
    expect(output).toContain("Do not write transcript summaries and call them lessons.");
    expect(output).toContain("Do not assume the learner knows acronyms");
  });
});

describe("renderPlanInputMd", () => {
  const folder = "videos/demo";
  const topicsJson = JSON.stringify(
    { version: 1, topics: [{ id: "gradient-descent" }] },
    null,
    2
  );
  const output = renderPlanInputMd(`\n${topicsJson}\n`, folder);

  it("names all persistent planning output paths inside the video folder", () => {
    expect(output).toContain("1. `learning/plan.md` inside `videos/demo`");
    expect(output).toContain("2. `learning/resources.md` inside `videos/demo`");
    expect(output).toContain("3. `learning/concepts.json` inside `videos/demo`");
  });

  it("requires concepts that make prerequisites and acronyms teachable", () => {
    expect(output).toContain("## concepts.json requirements");
    expect(output).toContain("Define prerequisite concepts, acronyms, libraries, methods, and background terms");
    expect(output).toContain("neededForTopics");
  });

  it("requires resource guidance for focus, skip, and use-after timing", () => {
    expect(output).toContain("`Focus on`");
    expect(output).toContain("`Skip for now`");
    expect(output).toContain("`Use after`");
    expect(output).toContain("- Focus on: The specific section, chapter, timestamp, or concept to study.");
    expect(output).toContain("- Skip for now: The part that is distracting, too advanced, or not needed yet.");
    expect(output).toContain("- Use after: The lesson, prerequisite, or confidence level that should come before this resource.");
  });

  it("embeds the trimmed topics.json verbatim in a json fence", () => {
    expect(output).toContain("```json\n" + topicsJson + "\n```");
  });

  it("ends with the ytai learn verification instruction", () => {
    expect(output).toContain(
      "After writing all three files, run: `ytai learn videos/demo` to validate them and get the next step."
    );
  });
});

describe("learning resource sections", () => {
  const topics: Topic[] = [
    {
      id: "attention",
      title: "Attention mechanisms",
      importance: "core",
      timestamps: ["01:00-02:00"],
      summary: "The video explains attention over tokens."
    },
    {
      id: "spectrograms",
      title: "Spectrograms",
      importance: "core",
      timestamps: ["03:00-04:00"],
      summary: "The video shows spectrograms."
    }
  ];
  const resourcesMd = [
    "# Learning resources",
    "",
    "## Attention mechanisms (`attention`)",
    "",
    "### Illustrated attention guide",
    "- URL: https://example.com/attention",
    "- Why it helps: It visualizes query-key-value weighting.",
    "- Focus on: The diagrams for attention weights.",
    "- Skip for now: Multi-head implementation details.",
    "- Use after: The attention lesson's mental model.",
    "",
    "## Spectrograms (`spectrograms`)",
    "",
    "### Spectrogram primer",
    "- URL: https://example.com/spectrograms",
    "- Why it helps: It links audio windows to frequency bins.",
    "- Focus on: Windowing examples.",
    "- Skip for now: Advanced DSP proofs.",
    "- Use after: The first audio preprocessing lesson."
  ].join("\n");

  it("extracts only the matching resource section for a topic", () => {
    const section = findTopicResourceSection(resourcesMd, topics[0]);
    expect(section).toContain("## Attention mechanisms (`attention`)");
    expect(section).toContain("https://example.com/attention");
    expect(section).toContain("Focus on: The diagrams for attention weights.");
    expect(section).not.toContain("https://example.com/spectrograms");
  });

  it("prefers exact backticked ids when topic titles overlap", () => {
    const overlappingResources = [
      "# Learning resources",
      "",
      "## Self attention (`self-attention`)",
      "",
      "- URL: https://example.com/self-attention",
      "- Why it helps: It explains self attention.",
      "- Focus on: Token-to-token attention.",
      "- Skip for now: Kernel details.",
      "- Use after: Basic sequence modeling.",
      "",
      "## Attention mechanisms (`attention`)",
      "",
      "- URL: https://example.com/attention",
      "- Why it helps: It covers the broader mechanism.",
      "- Focus on: Query-key-value weighting.",
      "- Skip for now: Optimized implementations.",
      "- Use after: The attention lesson."
    ].join("\n");

    const section = findTopicResourceSection(overlappingResources, topics[0]);
    expect(section).toContain("## Attention mechanisms (`attention`)");
    expect(section).toContain("https://example.com/attention");
    expect(section).not.toContain("https://example.com/self-attention");
  });

  it("does not match topic ids as in-between heading substrings", () => {
    const section = findTopicResourceSection(
      [
        "# Learning resources",
        "",
        "## Self attention",
        "",
        "- URL: https://example.com/self-attention"
      ].join("\n"),
      topics[0]
    );

    expect(section).toBeUndefined();
  });

  it("warns when a core topic has no resource section", () => {
    const issues = validateResourceSections(resourcesMd.replace("## Spectrograms (`spectrograms`)", "## Audio pictures"), topics);
    expect(issues).toContainEqual({
      severity: "warning",
      message: 'core topic "spectrograms" has no resource section in learning/resources.md.'
    });
  });

  it("warns when a core topic resource section is missing required guidance labels", () => {
    const issues = validateResourceSections(
      ["# Learning resources", "", "## Attention mechanisms (`attention`)", "", "- https://example.com/attention"].join("\n"),
      [topics[0]]
    );
    expect(issues[0]?.message).toContain("missing required guidance");
    expect(issues[0]?.message).toContain("URL");
    expect(issues[0]?.message).toContain("Use after");
  });
});

describe("renderLessonInputMd", () => {
  const folder = "videos/demo";
  const lessonTopic: Topic = {
    id: "attention",
    title: "Attention mechanisms",
    importance: "core",
    timestamps: ["01:00-02:00"],
    summary: "The video explains attention over tokens.",
    visualEvidence: ["frames/scout/frame_0007.jpg"]
  };
  const excerpt = "[01:00] the model attends to every token\n[01:30] weights sum to one";
  const output = renderLessonInputMd(lessonTopic, 3, `\n${excerpt}\n`, folder);
  const contextualOutput = renderLessonInputMd(lessonTopic, 3, excerpt, folder, {
    learnerProfileJson: JSON.stringify({
      version: 1,
      audienceLevel: "hands-on beginner",
      goals: ["Skip the video while learning systematically."],
      knownConcepts: ["vectors"],
      doNotAssumeTerms: ["QKV"],
      preferredDepth: "learn",
      teachingPreferences: ["Use analogies before equations."]
    }),
    teachingGuideMd: "Teach with analogies before equations.",
    conceptsJson: JSON.stringify({
      version: 1,
      concepts: [
        {
          id: "softmax",
          term: "Softmax",
          type: "method",
          plainDefinition: "Turns scores into probabilities.",
          whyItMatters: "Attention weights use softmax.",
          neededForTopics: ["attention"],
          confusions: ["Softmax does not pick exactly one token."]
        },
        {
          id: "fft",
          term: "FFT",
          type: "method",
          plainDefinition: "Computes frequency components.",
          whyItMatters: "Useful elsewhere.",
          neededForTopics: ["spectrograms"],
          confusions: []
        }
      ]
    }),
    resourcesMd: [
      "# Learning resources",
      "",
      "## Attention mechanisms (`attention`)",
      "",
      "### Illustrated attention guide",
      "- URL: https://example.com/attention",
      "- Why it helps: It visualizes query-key-value weighting.",
      "- Focus on: The diagrams for attention weights.",
      "- Skip for now: Multi-head implementation details.",
      "- Use after: The attention lesson's mental model.",
      "",
      "## Spectrograms (`spectrograms`)",
      "",
      "### Spectrogram primer",
      "- URL: https://example.com/spectrograms",
      "- Why it helps: It links audio windows to frequency bins.",
      "- Focus on: Windowing examples.",
      "- Skip for now: Advanced DSP proofs.",
      "- Use after: The first audio preprocessing lesson."
    ].join("\n")
  });

  it("names the zero-padded lesson output path inside the video folder", () => {
    expect(output).toContain("# Lesson Task: Attention mechanisms");
    expect(output).toContain(
      "Write the lesson as Markdown to `learning/lessons/03-attention.md` inside the video folder `videos/demo`."
    );
  });

  it("lists the durable teaching section headings in order", () => {
    expect(output).toContain("1. `# Attention mechanisms`");
    expect(output).toContain("## Learning goal");
    expect(output).toContain("## Prerequisites and acronyms");
    expect(output).toContain("## Mental model");
    expect(output).toContain("## What the video says");
    expect(output).toContain("## Teach the concept");
    expect(output).toContain("## Worked example");
    expect(output).toContain("## Common confusions");
    expect(output).toContain("## Suggested learning");
    expect(output).toContain("## Practice");
  });

  it("embeds the topic JSON and visual evidence paths", () => {
    expect(output).toContain(JSON.stringify(lessonTopic, null, 2));
    expect(output).toContain("- `frames/scout/frame_0007.jpg`");
  });

  it("embeds the trimmed transcript excerpt verbatim", () => {
    expect(output).toContain(excerpt);
  });

  it("embeds the teaching guide content when provided", () => {
    expect(contextualOutput).toContain("## Teaching guide");
    expect(contextualOutput).toContain("Teach with analogies before equations.");
  });

  it("embeds the learner profile when provided", () => {
    expect(contextualOutput).toContain("## Learner profile");
    expect(contextualOutput).toContain('"audienceLevel":"hands-on beginner"');
    expect(contextualOutput).toContain("Skip the video while learning systematically.");
    expect(contextualOutput).toContain("Use analogies before equations.");
  });

  it("embeds only concept cards needed for the current topic", () => {
    expect(contextualOutput).toContain('"term": "Softmax"');
    expect(contextualOutput).toContain('"neededForTopics": [');
    expect(contextualOutput).toContain('"attention"');
    expect(contextualOutput).not.toContain('"term": "FFT"');
    expect(contextualOutput).not.toContain('"spectrograms"');
  });

  it("embeds the matching resource section for the current topic", () => {
    expect(contextualOutput).toContain("## Resource section for this topic");
    expect(contextualOutput).toContain("## Attention mechanisms");
    expect(contextualOutput).toContain("https://example.com/attention");
    expect(contextualOutput).not.toContain("https://example.com/spectrograms");
    expect(contextualOutput).toContain("Focus on: The diagrams for attention weights.");
    expect(contextualOutput).toContain("Skip for now: Multi-head implementation details.");
    expect(contextualOutput).toContain("Use after: The attention lesson's mental model.");
  });

  it("calls out missing persistent teaching artifacts", () => {
    expect(output).toContain("learning/teaching-guide.md is absent");
    expect(output).toContain("learning/concepts.json is absent");
    expect(output).toContain("learning/resources.md is absent");
    expect(output).toContain("Proceed cautiously");
  });

  it("steers the LLM away from summary-only lessons", () => {
    expect(output).toContain("Do not treat the transcript excerpt as the lesson.");
    expect(output).toContain("Explain every acronym, library, method, and background term before using it.");
    expect(output).toContain("Practice must reinforce concepts, not send the learner hunting through the transcript.");
  });

  it("ends with the ytai learn verification instruction", () => {
    expect(output).toContain(
      "After writing `learning/lessons/03-attention.md`, run: `ytai learn videos/demo` to validate it and get the next step."
    );
  });

  it("notes when a topic has no visual evidence", () => {
    const bare = renderLessonInputMd({ ...lessonTopic, visualEvidence: undefined }, 12, excerpt, folder);
    expect(bare).toContain("_No visual evidence paths recorded for this topic._");
    expect(bare).toContain("`learning/lessons/12-attention.md`");
  });
});

describe("validateLessonMarkdown", () => {
  const validLesson = [
    "# Attention mechanisms",
    "",
    "## Learning goal",
    "Understand attention.",
    "",
    "## Prerequisites and acronyms",
    "Define tokens.",
    "",
    "## Mental model",
    "Tokens look at each other.",
    "",
    "## What the video says",
    "The video says attention weights sum to one [01:30].",
    "",
    "## Teach the concept",
    "Attention scores token relevance.",
    "",
    "## Worked example",
    "A query attends to keys.",
    "",
    "## Common confusions",
    "Attention is not memory by itself.",
    "",
    "## Suggested learning",
    "Read the resources.",
    "",
    "## Practice",
    "1. What is attention?",
    "<details><summary>Answer</summary>A relevance weighting mechanism.</details>",
    "2. What is a token?",
    "<details><summary>Answer</summary>A model input unit.</details>",
    "3. Why cite timestamps?",
    "<details><summary>Answer</summary>To ground video claims.</details>"
  ].join("\n");

  it("accepts a lesson with required teaching sections and practice answers", () => {
    expect(validateLessonMarkdown(validLesson, "lessons/01-attention.md")).toEqual([]);
  });

  it("warns for missing durable teaching sections", () => {
    const issues = validateLessonMarkdown("# Old lesson\n\n## What the video says\nSummary [01:00].", "old.md");
    expect(issues.map((issue) => issue.message)).toContain(
      'old.md: missing required heading "## Prerequisites and acronyms".'
    );
    expect(issues.map((issue) => issue.message)).toContain('old.md: missing required heading "## Practice".');
  });

  it("does not accept body text as a required heading", () => {
    const spoofed = validLesson.replace("## Mental model", "This paragraph mentions ## Mental model inline.");
    expect(validateLessonMarkdown(spoofed, "lesson.md").map((issue) => issue.message)).toContain(
      'lesson.md: missing required heading "## Mental model".'
    );
  });

  it("warns unless practice has exactly three answer details", () => {
    const fourAnswers = `${validLesson}\n<details><summary>Answer</summary>Extra.</details>`;
    expect(validateLessonMarkdown(fourAnswers, "lesson.md").map((issue) => issue.message)).toContain(
      "lesson.md: Practice should include exactly 3 questions with answers in <details> blocks; found 4."
    );
  });
});
