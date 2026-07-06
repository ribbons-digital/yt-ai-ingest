import type { Concept, Topic } from "./learning.js";

export type LessonHtmlVisualEvidence = {
  path: string;
  href: string;
};

export type LessonHtmlInput = {
  topic: Topic;
  lessonMarkdown: string;
  concepts: Concept[];
  visualEvidence: LessonHtmlVisualEvidence[];
};

export function renderLessonHtml(input: LessonHtmlInput): string {
  const body = renderMarkdown(input.lessonMarkdown);
  const conceptCards = renderConceptCards(input.concepts);
  const evidence = renderEvidence(input.topic, input.visualEvidence);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.topic.title)} - ytai lesson</title>`,
    `<style>${LESSON_CSS}</style>`,
    "</head>",
    "<body>",
    '<main class="lesson-shell">',
    '<header class="hero">',
    '<p class="eyebrow">ytai local lesson</p>',
    `<h1>${renderInline(input.topic.title)}</h1>`,
    `<p class="summary">${renderInline(input.topic.summary)}</p>`,
    `<p class="importance">${escapeHtml(input.topic.importance)}</p>`,
    "</header>",
    evidence,
    conceptCards,
    '<article class="lesson-card">',
    body,
    "</article>",
    '<footer class="next-step">Regenerate this page after editing the Markdown lesson: <code>ytai render-lesson &lt;folder&gt; &lt;topic-id&gt;</code>.</footer>',
    "</main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

export function safeLessonHref(rawHref: string): string | undefined {
  const href = rawHref.trim();
  if (!href || /[\u0000-\u001f\u007f]/u.test(href)) {
    return undefined;
  }

  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? href : undefined;
  } catch {
    // Relative hrefs are checked below.
  }

  if (href.startsWith("/") || href.startsWith("#") || href.includes("\\")) {
    return undefined;
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(href)) {
    return undefined;
  }
  if (href.startsWith("../../frames/")) {
    const framePath = href.slice("../../".length);
    return framePath.split("/").some(isUnsafeRelativeSegment) ? undefined : href;
  }
  if (href.split("/").some(isUnsafeRelativeSegment)) {
    return undefined;
  }
  return href;
}

function isUnsafeRelativeSegment(segment: string): boolean {
  if (segment.length === 0) {
    return true;
  }
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Malformed percent-encoding should not make a relative link safer.
    return true;
  }
  return decoded === "." || decoded === "..";
}

function renderConceptCards(concepts: Concept[]): string {
  if (concepts.length === 0) {
    return "";
  }

  return [
    '<section class="concepts" aria-labelledby="concepts-heading">',
    '<h2 id="concepts-heading">Concept cards</h2>',
    '<div class="concept-grid">',
    ...concepts.map((concept) =>
      [
        '<article class="concept-card">',
        `<p class="concept-type">${escapeHtml(concept.type)}</p>`,
        `<h3>${renderInline(concept.term)}</h3>`,
        `<p>${renderInline(concept.plainDefinition)}</p>`,
        `<p class="why"><strong>Why it matters:</strong> ${renderInline(concept.whyItMatters)}</p>`,
        "</article>"
      ].join("\n")
    ),
    "</div>",
    "</section>"
  ].join("\n");
}

function renderEvidence(topic: Topic, visualEvidence: LessonHtmlVisualEvidence[]): string {
  if (topic.timestamps.length === 0 && visualEvidence.length === 0) {
    return "";
  }

  return [
    '<section class="evidence" aria-labelledby="evidence-heading">',
    '<h2 id="evidence-heading">Video evidence</h2>',
    topic.timestamps.length > 0
      ? `<div class="chips">${topic.timestamps.map((stamp) => `<span>${escapeHtml(stamp)}</span>`).join("")}</div>`
      : "",
    visualEvidence.length > 0
      ? `<div class="frame-grid">${visualEvidence
          .map(
            (item) =>
              `<figure><a href="${escapeAttribute(item.href)}"><img src="${escapeAttribute(item.href)}" alt="${escapeAttribute(item.path)}"></a><figcaption>${escapeHtml(item.path)}</figcaption></figure>`
          )
          .join("")}</div>`
      : "",
    "</section>"
  ].join("\n");
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(.*)$/u);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const language = fence[1].trim();
      const className = language ? ` class="language-${escapeAttribute(language)}"` : "";
      output.push(`<pre><code${className}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (line.trim() === "<details>") {
      const details: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== "</details>") {
        details.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      output.push(renderDetails(details));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    if (heading) {
      const level = heading[1].length + 1;
      output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/u, ""));
        index += 1;
      }
      output.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/u, ""));
        index += 1;
      }
      output.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !/^```/u.test(lines[index]) &&
      lines[index].trim() !== "<details>" &&
      !/^(#{1,4})\s+(.+)$/u.test(lines[index]) &&
      !/^\s*[-*]\s+/u.test(lines[index]) &&
      !/^\s*\d+\.\s+/u.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return output.join("\n");
}

function renderDetails(lines: string[]): string {
  const summaryIndex = lines.findIndex((line) => line.trim().startsWith("<summary>") && line.trim().endsWith("</summary>"));
  const summary = summaryIndex >= 0
    ? lines[summaryIndex].trim().replace(/^<summary>/u, "").replace(/<\/summary>$/u, "")
    : "Reveal answer";
  const bodyLines = lines.filter((_, index) => index !== summaryIndex);

  return [
    '<details class="practice-card">',
    `<summary>${renderInline(summary)}</summary>`,
    '<div class="practice-body">',
    renderMarkdown(bodyLines.join("\n")),
    "</div>",
    "</details>"
  ].join("\n");
}

function renderInline(value: string): string {
  let result = "";
  let rest = value;

  while (rest.length > 0) {
    const imageStart = rest.indexOf("![");
    const codeStart = rest.indexOf("`");
    const linkStart = rest.indexOf("[");
    const boldStart = rest.indexOf("**");
    const starts = [imageStart, codeStart, linkStart, boldStart].filter((start) => start >= 0);
    const next = starts.length > 0 ? Math.min(...starts) : -1;

    if (next < 0) {
      result += escapeHtml(rest);
      break;
    }

    result += escapeHtml(rest.slice(0, next));
    rest = rest.slice(next);

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end < 0) {
        result += escapeHtml(rest);
        break;
      }
      result += `<code>${escapeHtml(rest.slice(1, end))}</code>`;
      rest = rest.slice(end + 1);
      continue;
    }

    if (rest.startsWith("**")) {
      const end = rest.indexOf("**", 2);
      if (end < 0) {
        result += escapeHtml(rest);
        break;
      }
      result += `<strong>${renderInline(rest.slice(2, end))}</strong>`;
      rest = rest.slice(end + 2);
      continue;
    }

    const image = rest.match(/^!\[([^\]]*)\]\(([^)]+)\)/u);
    if (image) {
      const href = safeLessonHref(image[2]);
      if (href) {
        result += `<img class="inline-image" src="${escapeAttribute(href)}" alt="${escapeAttribute(image[1])}">`;
      } else {
        result += escapeHtml(image[0]);
      }
      rest = rest.slice(image[0].length);
      continue;
    }

    const link = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/u);
    if (link) {
      const href = safeLessonHref(link[2]);
      if (href) {
        result += `<a href="${escapeAttribute(href)}">${renderInline(link[1])}</a>`;
      } else {
        result += escapeHtml(link[0]);
      }
      rest = rest.slice(link[0].length);
      continue;
    }

    result += escapeHtml(rest[0]);
    rest = rest.slice(1);
  }

  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const LESSON_CSS = `
:root { color-scheme: light; --ink: #172033; --muted: #5d6680; --line: #d8deea; --paper: #f7f8fb; --card: #ffffff; --accent: #3657ff; --soft: #eef2ff; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: radial-gradient(circle at top left, #eef2ff, var(--paper) 34rem); line-height: 1.6; }
a { color: var(--accent); }
code { border-radius: 0.35rem; padding: 0.08rem 0.28rem; background: #eef0f6; font-size: 0.92em; }
pre { overflow-x: auto; border: 1px solid var(--line); border-radius: 1rem; padding: 1rem; background: #101828; color: #f8fafc; }
pre code { padding: 0; background: transparent; color: inherit; }
.lesson-shell { width: min(68rem, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 3rem; }
.hero, .lesson-card, .concepts, .evidence, .next-step { border: 1px solid var(--line); border-radius: 1.4rem; background: rgba(255, 255, 255, 0.88); box-shadow: 0 1rem 2.5rem rgba(23, 32, 51, 0.08); }
.hero { padding: 2rem; }
.eyebrow, .concept-type, .importance { margin: 0 0 0.6rem; color: var(--accent); font-size: 0.78rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
.hero h1 { margin: 0; font-size: clamp(2rem, 5vw, 4rem); line-height: 1; letter-spacing: -0.05em; }
.summary { max-width: 50rem; color: var(--muted); font-size: 1.08rem; }
.importance { display: inline-flex; margin-top: 0.5rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: var(--soft); }
.concepts, .evidence, .lesson-card, .next-step { margin-top: 1rem; padding: 1.25rem; }
.concepts h2, .evidence h2 { margin-top: 0; }
.concept-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; }
.concept-card { border: 1px solid var(--line); border-radius: 1rem; padding: 1rem; background: var(--card); }
.concept-card h3 { margin: 0 0 0.4rem; }
.why { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.chips span { border: 1px solid var(--line); border-radius: 999px; padding: 0.3rem 0.65rem; background: var(--card); font-weight: 700; }
.frame-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.8rem; margin-top: 1rem; }
.frame-grid figure { margin: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 1rem; background: var(--card); }
.frame-grid img, .inline-image { display: block; max-width: 100%; height: auto; }
.frame-grid img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.frame-grid figcaption { padding: 0.55rem 0.7rem; color: var(--muted); font-size: 0.85rem; word-break: break-word; }
.inline-image { margin: 0.75rem 0; border: 1px solid var(--line); border-radius: 0.8rem; }
.lesson-card h2 { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.lesson-card h2:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.practice-card { margin: 1rem 0; border: 1px solid var(--line); border-radius: 1rem; background: var(--card); }
.practice-card summary { cursor: pointer; padding: 1rem; font-weight: 800; color: var(--accent); }
.practice-body { padding: 0 1rem 1rem; }
.next-step { color: var(--muted); }
`;