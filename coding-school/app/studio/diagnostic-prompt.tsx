"use client";

import { Fragment, type ReactNode } from "react";
import styles from "./diagnostic-prompt.module.css";

type Segment =
  | { kind: "prose"; text: string }
  | { kind: "inline"; code: string }
  | { kind: "fenced"; code: string };

type SyntaxKind = "keyword" | "function" | "string" | "number" | "comment";
type Token = { kind: SyntaxKind | "plain"; text: string };

const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield",
]);

/** Prompt text is split into prose and code fragments. Only fenced and inline
 *  fragments are lexed; unmatched backticks stay literal in the prose. */
function parsePrompt(prompt: string): Segment[] {
  const segments: Segment[] = [];
  let prose = "";
  let i = 0;

  const flush = () => {
    if (prose) segments.push({ kind: "prose", text: prose });
    prose = "";
  };

  while (i < prompt.length) {
    if (prompt.startsWith("```", i)) {
      const close = prompt.indexOf("```", i + 3);
      if (close === -1) {
        prose += "```";
        i += 3;
        continue;
      }
      let code = prompt.slice(i + 3, close);
      const infoEnd = code.indexOf("\n");
      // A bare language tag on the opening fence line is notation, not code,
      // including a CRLF fence whose tag line ends in \r.
      if (infoEnd !== -1) {
        const tag = code.slice(0, infoEnd).replace(/\r$/, "");
        if (/^[A-Za-z0-9_+#.-]*$/.test(tag)) code = code.slice(infoEnd + 1);
      }
      flush();
      segments.push({ kind: "fenced", code });
      i = close + 3;
      continue;
    }

    if (prompt[i] === "`") {
      const close = prompt.indexOf("`", i + 1);
      // A backtick that only opens a fenced block is not an inline terminator.
      if (close === -1 || prompt.startsWith("```", close)) {
        prose += "`";
        i += 1;
        continue;
      }
      flush();
      segments.push({ kind: "inline", code: prompt.slice(i + 1, close) });
      i = close + 1;
      continue;
    }

    prose += prompt[i];
    i += 1;
  }

  flush();
  return segments;
}

/** Minimal Python lexer: keywords, calls and def/class names, strings,
 *  numbers, and comments get a token span; everything else stays plain. */
function tokenizePython(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let previousWord = "";

  const push = (kind: Token["kind"], text: string) => {
    if (!text) return;
    const tail = tokens[tokens.length - 1];
    if (tail && tail.kind === kind) tail.text += text;
    else tokens.push({ kind, text });
  };

  while (i < code.length) {
    const char = code[i];

    if (char === "#") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push("comment", code.slice(i, stop));
      i = stop;
      previousWord = "";
      continue;
    }

    if (char === '"' || char === "'") {
      const triple = char.repeat(3);
      if (code.startsWith(triple, i)) {
        const end = code.indexOf(triple, i + 3);
        const stop = end === -1 ? code.length : end + 3;
        push("string", code.slice(i, stop));
        i = stop;
        previousWord = "";
        continue;
      }
      let j = i + 1;
      while (j < code.length && code[j] !== char && code[j] !== "\n") {
        if (code[j] === "\\" && j + 1 < code.length) j += 1;
        j += 1;
      }
      const stop = code[j] === char ? j + 1 : j;
      push("string", code.slice(i, stop));
      i = stop;
      previousWord = "";
      continue;
    }

    if (char >= "0" && char <= "9") {
      const match = /^(?:0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?)/.exec(code.slice(i));
      const text = match ? match[0] : char;
      push("number", text);
      i += text.length;
      previousWord = "";
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let j = i;
      while (j < code.length && /[A-Za-z0-9_]/.test(code[j])) j += 1;
      const word = code.slice(i, j);
      if (PYTHON_KEYWORDS.has(word)) {
        push("keyword", word);
      } else {
        let k = j;
        while (k < code.length && (code[k] === " " || code[k] === "\t")) k += 1;
        const isCall = code[k] === "(";
        const isName = previousWord === "def" || previousWord === "class";
        push(isCall || isName ? "function" : "plain", word);
      }
      previousWord = word;
      i = j;
      continue;
    }

    push("plain", char);
    if (!/\s/.test(char)) previousWord = "";
    i += 1;
  }

  return tokens;
}

const TOKEN_CLASS: Record<SyntaxKind, string> = {
  keyword: styles.keyword,
  function: styles.function,
  string: styles.string,
  number: styles.number,
  comment: styles.comment,
};

function renderTokens(code: string, keyPrefix: string): ReactNode[] {
  return tokenizePython(code).map((token, index) => (
    <Fragment key={`${keyPrefix}-${index}`}>
      {token.kind === "plain"
        ? token.text
        : <span className={TOKEN_CLASS[token.kind]}>{token.text}</span>}
    </Fragment>
  ));
}

export function DiagnosticPrompt({ prompt }: { prompt: string }): ReactNode {
  return <div className="diagnostic-prompt">
    {parsePrompt(prompt).map((segment, index) => {
      if (segment.kind === "prose") return <Fragment key={index}>{segment.text}</Fragment>;
      if (segment.kind === "inline") {
        return <code key={index} className={styles.inlineCode}>{renderTokens(segment.code, `i${index}`)}</code>;
      }
      return <pre key={index} className={styles.fenced}>
        <code>{renderTokens(segment.code, `f${index}`)}</code>
      </pre>;
    })}
  </div>;
}
