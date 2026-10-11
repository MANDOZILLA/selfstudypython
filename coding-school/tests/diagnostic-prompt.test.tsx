import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosticPrompt } from "../app/studio/diagnostic-prompt";

const render = (prompt: string) => renderToStaticMarkup(<DiagnosticPrompt prompt={prompt} />);

const decode = (text: string) => text
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&#x27;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, "&");

/** Visible text of a markup fragment: tags removed, entities decoded. */
const visibleText = (markup: string) => decode(markup.replace(/<[^>]*>/g, ""));

/** Text carried by every token `<span>` in a markup fragment, in order. */
const spanTexts = (markup: string) => [...markup.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(match => decode(match[1]));

/** Raw inner markup of the single-backtick code fragments (spans intact). */
const inlineCodeMarkup = (html: string) => [...html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, "").matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map(match => match[1]);

const inlineCodeText = (html: string) => inlineCodeMarkup(html).map(visibleText);
const fencedCodeText = (html: string) => [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(match => visibleText(match[1]));

describe("DiagnosticPrompt", () => {
  it("renders question prose exactly as written", () => {
    const prompt = "What does a  for loop do, and what does a return give back?";
    expect(visibleText(render(prompt))).toBe(prompt);
  });

  it("keeps the prompt container and never nests code inside a paragraph", () => {
    const html = render("Question about `code` and blocks.");
    expect(html).toContain('<div class="diagnostic-prompt">');
    expect(html).not.toContain("<p");
  });

  it("renders single-backtick fragments as inline code with the source text intact", () => {
    const html = render("Run `print('hello')` to see it.");
    expect(inlineCodeText(html)).toEqual(["print('hello')"]);
    expect(visibleText(html)).toBe("Run print('hello') to see it.");
  });

  it("keeps code source text and indentation exactly inside fenced blocks", () => {
    const prompt = "```python\ndef move():\n    if x > 1:\n        return x\n```";
    expect(fencedCodeText(render(prompt))).toEqual(["def move():\n    if x > 1:\n        return x\n"]);
  });

  it("preserves CRLF line endings through a fenced block", () => {
    const prompt = "```python\r\ndef move():\r\n    return 1\r\n```";
    expect(fencedCodeText(render(prompt))).toEqual(["def move():\r\n    return 1\r\n"]);
  });

  it("marks up python keywords, calls, strings, numbers and comments only inside code", () => {
    const html = render("Study `def double(n):  # double it\n    return n * 2` closely.");
    const spans = spanTexts(inlineCodeMarkup(html)[0]);
    expect(spans).toEqual(expect.arrayContaining(["def", "double", "return", "# double it", "2"]));
  });

  it("leaves the same words untouched in question prose", () => {
    const prompt = "Explain what def, class, return, strings, numbers and # mean.";
    const html = render(prompt);
    expect(html).not.toContain("<span");
    expect(visibleText(html)).toBe(prompt);
  });

  it("treats a hash inside a string as string content, not a comment", () => {
    const html = render("`tag = \"# not a comment\"`");
    expect(inlineCodeText(html)).toEqual(["tag = \"# not a comment\""]);
    const spans = spanTexts(inlineCodeMarkup(html)[0]);
    expect(spans).toContain("\"# not a comment\"");
    expect(spans).toEqual(["\"# not a comment\""]);
  });

  it("never invents a closing quote for an unfinished string", () => {
    const prompt = "`msg = \"unterminated`";
    expect(inlineCodeText(render(prompt))).toEqual(["msg = \"unterminated"]);
  });

  it("keeps an apostrophe in prose as ordinary text", () => {
    const prompt = "What does a string like \"abc need in order to be closed?";
    expect(visibleText(render(prompt))).toBe(prompt);
  });

  it("escapes literal html and angle brackets instead of emitting them raw", () => {
    const prompt = "Is 2 < 3 & 4 > 1? What does `<div>` do?";
    const html = render(prompt);
    expect(html).not.toContain("<div>");
    expect(html).not.toContain("2 < 3");
    expect(html).toContain("&lt;div&gt;");
    expect(visibleText(html)).toBe(prompt.replace(/`/g, ""));
  });

  it("keeps unmatched backticks and unterminated fences as literal text", () => {
    const prompt = "A stray ` backtick, then an unterminated ```\nfence here.";
    const html = render(prompt);
    expect(visibleText(html)).toBe(prompt);
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("<code");
  });

  it("renders several code fragments in order with the right kind each", () => {
    const html = render("First `one()` then:\n```\nb = 2\n```\nfinally `three()`.");
    const visible = visibleText(html);
    expect(inlineCodeText(html)).toEqual(["one()", "three()"]);
    expect(fencedCodeText(html)).toEqual(["b = 2\n"]);
    expect(visible.indexOf("one()")).toBeLessThan(visible.indexOf("b = 2"));
    expect(visible.indexOf("b = 2")).toBeLessThan(visible.indexOf("three()"));
    expect(visible).toBe("First one() then:\nb = 2\n\nfinally three().");
  });
});
