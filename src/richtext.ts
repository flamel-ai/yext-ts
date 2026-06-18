/**
 * Rich Text v2 (Lexical) field helpers - hand-written, not generated.
 *
 * Yext "Rich Text v2" fields (for example an FAQ entity's `answerV2`) are stored
 * as a Lexical JSON AST under `{ json: { root: ... } }`, NOT as a markdown or
 * plain string. The Management API is unforgiving about this:
 *
 *   - a bare string is rejected: `Expected BEGIN_OBJECT but was STRING`
 *   - a `{ markdown }` object is accepted but silently dropped (no AST is stored)
 *
 * so callers otherwise have to hand-build (and get exactly right) Lexical nodes
 * for every write. This module provides:
 *
 *   - `richTextV2(input)`   coerce a string (parsed as lightweight markdown) OR
 *                           an AST into the `{ json: { root } }` value Yext wants.
 *   - `lexicalFromMarkdown` markdown string -> Lexical root (bold/italic/code/
 *                           links, headings, and bullet/numbered lists).
 *   - `lexicalFromPlainText` literal text -> Lexical root (no markdown parsing).
 *   - `normalizeLexical`    validate and REPAIR an existing/partial AST, filling
 *                           every required Lexical field so it is accepted.
 *
 * Why no `lexical` dependency: the official `lexical` runtime is a browser editor
 * framework; using it headlessly pulls `lexical` + `@lexical/headless` +
 * `@lexical/markdown` into a published, tree-shakeable SDK whose only runtime dep
 * is `zod`. A focused formatter + normalizer keeps the package lean while
 * emitting the exact node shape the live API accepts and round-trips.
 *
 *   import { updateEntity } from "@flamel-ai/yext-api/knowledge";
 *   import { richTextV2, withYextAuth } from "@flamel-ai/yext-api";
 *
 *   await updateEntity({
 *     path: { accountId: "me", entityId: "my-faq" },
 *     body: { answerV2: richTextV2("**Yes.** Dogs are welcome until 9pm.") },
 *     ...withYextAuth({ credential: { type: "apiKey", value: key } }),
 *   });
 *
 * Docs: https://hitchhikers.yext.com/docs/knowledge-graph/rich-text-markdown-field/
 */

/** Lexical inline text format bitmask (matches the editor's `IS_*` flags). */
export const LEXICAL_FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
} as const;

/** A Lexical text leaf node. */
export interface LexicalTextNode {
  type: "text";
  version: 1;
  text: string;
  detail: number;
  format: number;
  mode: "normal" | "token" | "segmented";
  style: string;
}

/** A Lexical line-break node (a soft break within a block). */
export interface LexicalLineBreakNode {
  type: "linebreak";
  version: 1;
}

/** A Lexical element node (e.g. `root`, `paragraph`, `heading`, `list`, `link`). */
export interface LexicalElementNode {
  type: string;
  version: number;
  direction: "ltr" | "rtl" | null;
  format: string | number;
  indent: number;
  children: LexicalNode[];
  [key: string]: unknown;
}

export type LexicalNode =
  | LexicalTextNode
  | LexicalLineBreakNode
  | LexicalElementNode;

/** The serialized value a Yext Rich Text v2 field accepts and returns. */
export interface RichTextV2Value {
  json: { root: LexicalElementNode };
  /**
   * Yext also derives and stores an `html` representation. It is optional on
   * write (the server derives it from `json`) and present on read.
   */
  html?: string;
}

/** Anything {@link richTextV2} accepts: a string, a wrapped value, or a bare AST. */
export type RichTextV2Input =
  | string
  | RichTextV2Value
  | { root: LexicalElementNode };

// ---- node constructors (every required Lexical field set, so output is valid) ----

const textNode = (text: string, format = 0): LexicalTextNode => ({
  type: "text",
  version: 1,
  text,
  detail: 0,
  format,
  mode: "normal",
  style: "",
});

const lineBreak = (): LexicalLineBreakNode => ({ type: "linebreak", version: 1 });

const element = (
  type: string,
  children: LexicalNode[],
  extra: Record<string, unknown> = {},
): LexicalElementNode => ({
  type,
  version: 1,
  direction: "ltr",
  format: "",
  indent: 0,
  ...extra,
  children,
});

const paragraph = (children: LexicalNode[]): LexicalElementNode =>
  element("paragraph", children);

const linkNode = (url: string, children: LexicalNode[]): LexicalElementNode =>
  element("link", children, { rel: null, target: null, title: null, url });

const rootNode = (children: LexicalNode[]): LexicalElementNode =>
  element("root", children);

// ---- lightweight markdown -> Lexical ----

// Bold (**..** / __..__), italic (*..* / _.._), inline code (`..`), link [t](u).
// Single-level (no nested emphasis) - intentionally lightweight.
const INLINE_RE =
  /(\*\*|__)([\s\S]+?)\1|([*_])([\s\S]+?)\3|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+)\)/g;

/** Parse a single line of inline markdown into Lexical text/link nodes. */
export function parseInlineMarkdown(text: string): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(textNode(text.slice(last, m.index)));
    if (m[1]) nodes.push(textNode(m[2], LEXICAL_FORMAT.bold));
    else if (m[3]) nodes.push(textNode(m[4], LEXICAL_FORMAT.italic));
    else if (m[5] !== undefined) nodes.push(textNode(m[5], LEXICAL_FORMAT.code));
    else if (m[6] !== undefined) nodes.push(linkNode(m[7], [textNode(m[6])]));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(textNode(text.slice(last)));
  return nodes.length ? nodes : [textNode("")];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const ULIST_RE = /^\s*[-*+]\s+(.*)$/;
const OLIST_RE = /^\s*\d+\.\s+(.*)$/;

/**
 * Format a markdown string into a Lexical root. Supports blank-line paragraphs
 * (with soft line breaks), ATX headings (`#`..`######`), and unordered
 * (`- `/`* `/`+ `) and ordered (`1. `) lists, plus inline bold/italic/code/links.
 * Unsupported syntax is emitted as literal text rather than throwing.
 */
export function lexicalFromMarkdown(md: string): { root: LexicalElementNode } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: LexicalNode[] = [];
  let para: string[] = [];

  const flush = (): void => {
    if (!para.length) return;
    const children: LexicalNode[] = [];
    para.forEach((line, i) => {
      if (i > 0) children.push(lineBreak());
      children.push(...parseInlineMarkdown(line));
    });
    blocks.push(paragraph(children));
    para = [];
  };

  const takeList = (
    re: RegExp,
    listType: "bullet" | "number",
    start: number,
  ): number => {
    const items: LexicalNode[] = [];
    let i = start;
    let value = 1;
    while (i < lines.length) {
      const m = re.exec(lines[i]);
      if (!m) break;
      items.push(element("listitem", parseInlineMarkdown(m[1]), { value: value++ }));
      i++;
    }
    blocks.push(
      element("list", items, {
        listType,
        start: 1,
        tag: listType === "number" ? "ol" : "ul",
      }),
    );
    return i;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      flush();
      i++;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      blocks.push(
        element("heading", parseInlineMarkdown(heading[2]), { tag: `h${heading[1].length}` }),
      );
      i++;
      continue;
    }
    if (ULIST_RE.test(line)) {
      flush();
      i = takeList(ULIST_RE, "bullet", i);
      continue;
    }
    if (OLIST_RE.test(line)) {
      flush();
      i = takeList(OLIST_RE, "number", i);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();

  return { root: rootNode(blocks.length ? blocks : [paragraph([textNode("")])]) };
}

/**
 * Format literal text into a Lexical root WITHOUT interpreting markdown. Blank
 * lines split paragraphs; single newlines become soft line breaks. Use this when
 * the text may contain markdown-like characters that should appear verbatim.
 */
export function lexicalFromPlainText(text: string): { root: LexicalElementNode } {
  const blocks = text.split(/\n{2,}/).map((block) => {
    const children: LexicalNode[] = [];
    block.split("\n").forEach((segment, i) => {
      if (i > 0) children.push(lineBreak());
      children.push(textNode(segment));
    });
    return paragraph(children);
  });
  return { root: rootNode(blocks.length ? blocks : [paragraph([textNode("")])]) };
}

// ---- validate / repair an existing AST ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/**
 * Repair a single node: fill every required Lexical field, coercing/defaulting
 * anything missing or malformed. Unknown extra fields (e.g. `tag`, `listType`,
 * `url`) are preserved so headings, lists, and links keep their meaning.
 */
function normalizeNode(node: unknown): LexicalNode {
  if (!isRecord(node)) return textNode(node == null ? "" : String(node));

  if (node.type === "linebreak") return lineBreak();

  if (node.type === "text" || typeof node.text === "string") {
    return {
      type: "text",
      version: 1,
      text: typeof node.text === "string" ? node.text : String(node.text ?? ""),
      detail: typeof node.detail === "number" ? node.detail : 0,
      format: typeof node.format === "number" ? node.format : 0,
      mode:
        node.mode === "token" || node.mode === "segmented" ? node.mode : "normal",
      style: typeof node.style === "string" ? node.style : "",
    };
  }

  const { children, ...rest } = node;
  return {
    ...rest,
    type: typeof node.type === "string" ? node.type : "paragraph",
    version: typeof node.version === "number" ? node.version : 1,
    direction:
      node.direction === "rtl" || node.direction === null ? node.direction : "ltr",
    format: typeof node.format === "string" || typeof node.format === "number" ? node.format : "",
    indent: typeof node.indent === "number" ? node.indent : 0,
    children: Array.isArray(children) ? children.map(normalizeNode) : [],
  };
}

/**
 * Validate and REPAIR a Lexical value into a Yext-acceptable `{ json: { root } }`.
 * Accepts a string (formatted as markdown), a wrapped `{ json }` value, a bare
 * `{ root }` AST, or a loose/partial AST, and returns a value with every required
 * Lexical field present. A non-root top node is wrapped in a root; a preexisting
 * `html` string is preserved. Idempotent.
 */
export function normalizeLexical(input: RichTextV2Input): RichTextV2Value {
  if (typeof input === "string") return { json: lexicalFromMarkdown(input) };

  const rec = input as Record<string, unknown>;
  let rawRoot: unknown = input;
  if (isRecord(rec.json)) rawRoot = (rec.json as Record<string, unknown>).root;
  else if ("root" in rec) rawRoot = rec.root;

  const normalized = normalizeNode(rawRoot ?? rootNode([]));
  const root: LexicalElementNode =
    normalized.type === "root"
      ? (normalized as LexicalElementNode)
      : rootNode([normalized]);

  const value: RichTextV2Value = { json: { root } };
  if (typeof rec.html === "string") value.html = rec.html;
  return value;
}

/**
 * Coerce a string OR a Lexical AST into the `{ json: { root } }` value a Yext
 * Rich Text v2 field accepts on write:
 *
 *   - a `string` is parsed as lightweight markdown (see {@link lexicalFromMarkdown});
 *     pass the result of {@link lexicalFromPlainText} to keep text verbatim.
 *   - an already-wrapped `{ json, html? }` value is validated/repaired
 *   - a bare `{ root }` AST is validated/repaired and wrapped
 *
 * Idempotent: `richTextV2(richTextV2(x))` deep-equals `richTextV2(x)`.
 */
export function richTextV2(input: RichTextV2Input): RichTextV2Value {
  if (typeof input === "string") return { json: lexicalFromMarkdown(input) };
  return normalizeLexical(input);
}
