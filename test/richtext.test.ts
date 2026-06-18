import { describe, expect, it } from "vitest";

import {
  LEXICAL_FORMAT,
  lexicalFromMarkdown,
  lexicalFromPlainText,
  normalizeLexical,
  richTextV2,
  type LexicalElementNode,
  type LexicalTextNode,
  type RichTextV2Value,
} from "../src/index.js";

const firstChild = (root: LexicalElementNode) => root.children[0] as LexicalElementNode;
const leaves = (el: LexicalElementNode) => el.children as Array<Record<string, unknown>>;

describe("richTextV2 - plain prose (the proven live shape)", () => {
  it("formats markerless text into one paragraph with one text node", () => {
    expect(richTextV2("Yes. Dogs are welcome until 9pm.")).toEqual({
      json: {
        root: {
          type: "root",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          children: [
            {
              type: "paragraph",
              version: 1,
              direction: "ltr",
              format: "",
              indent: 0,
              children: [
                { type: "text", version: 1, text: "Yes. Dogs are welcome until 9pm.", detail: 0, format: 0, mode: "normal", style: "" },
              ],
            },
          ],
        },
      },
    });
  });
});

describe("lexicalFromMarkdown - inline + block formatting", () => {
  it("parses bold, italic, and inline code into format bitmasks", () => {
    const { root } = lexicalFromMarkdown("a **b** _c_ `d`");
    const nodes = leaves(firstChild(root));
    expect(nodes.find((n) => n.text === "b")?.format).toBe(LEXICAL_FORMAT.bold);
    expect(nodes.find((n) => n.text === "c")?.format).toBe(LEXICAL_FORMAT.italic);
    expect(nodes.find((n) => n.text === "d")?.format).toBe(LEXICAL_FORMAT.code);
  });

  it("parses a link into a link element with url", () => {
    const { root } = lexicalFromMarkdown("see [our site](https://braxtonbrewing.com)");
    const link = leaves(firstChild(root)).find((n) => n.type === "link") as unknown as LexicalElementNode;
    expect(link.type).toBe("link");
    expect(link.url).toBe("https://braxtonbrewing.com");
    expect((link.children[0] as LexicalTextNode).text).toBe("our site");
  });

  it("parses ATX headings", () => {
    const { root } = lexicalFromMarkdown("## Hours");
    expect(firstChild(root).type).toBe("heading");
    expect(firstChild(root).tag).toBe("h2");
  });

  it("parses unordered and numbered lists", () => {
    const ul = lexicalFromMarkdown("- one\n- two").root;
    expect(firstChild(ul).type).toBe("list");
    expect(firstChild(ul).listType).toBe("bullet");
    expect(firstChild(ul).children).toHaveLength(2);

    const ol = lexicalFromMarkdown("1. first\n2. second").root;
    expect(firstChild(ol).listType).toBe("number");
  });
});

describe("lexicalFromPlainText - literal (no markdown)", () => {
  it("keeps markdown characters verbatim", () => {
    const { root } = lexicalFromPlainText("a *b* c");
    const nodes = leaves(firstChild(root));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].text).toBe("a *b* c");
    expect(nodes[0].format).toBe(0);
  });

  it("splits blank lines into paragraphs and soft newlines into linebreaks", () => {
    expect(lexicalFromPlainText("p1\n\np2").root.children).toHaveLength(2);
    const para = firstChild(lexicalFromPlainText("l1\nl2").root);
    expect(para.children.map((c) => c.type)).toEqual(["text", "linebreak", "text"]);
  });
});

describe("normalizeLexical - validate / repair a partial AST", () => {
  it("fills every required field on a loose AST", () => {
    const partial = { root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "hi" }] }] } };
    const out = normalizeLexical(partial as never);
    const root = out.json.root;
    expect(root).toMatchObject({ type: "root", version: 1, direction: "ltr", format: "", indent: 0 });
    const para = firstChild(root);
    expect(para).toMatchObject({ type: "paragraph", version: 1, direction: "ltr", format: "", indent: 0 });
    expect(para.children[0]).toEqual({ type: "text", version: 1, text: "hi", detail: 0, format: 0, mode: "normal", style: "" });
  });

  it("wraps a non-root top node in a root and preserves html", () => {
    const wrapped: RichTextV2Value = {
      json: { root: { type: "root", version: 1, direction: "ltr", format: "", indent: 0, children: [] } },
      html: "<p>hi</p>",
    };
    const out = normalizeLexical(wrapped);
    expect(out.json.root.type).toBe("root");
    expect(out.html).toBe("<p>hi</p>");
  });

  it("is idempotent for strings and ASTs", () => {
    const s = richTextV2("**hello** world");
    expect(richTextV2(s)).toEqual(s);
    const md = richTextV2("# Title\n\n- a\n- b");
    expect(richTextV2(md)).toEqual(md);
  });
});
