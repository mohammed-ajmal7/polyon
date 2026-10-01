import type { ReactNode } from "react";

interface MarkdownContentProps {
  readonly content: string;
  readonly className?: string;
}

const TICK = String.fromCharCode(96);

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  const source = content.replace(/\r\n?/gu, "\n").trim();
  if (source === "") return null;
  return <div className={"polyon-markdown " + className}>{renderBlocks(source)}</div>;
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fencePrefix = line.trimStart();
    if (fencePrefix.startsWith(TICK.repeat(3)) || fencePrefix.startsWith("~~~")) {
      const marker = fencePrefix.startsWith(TICK.repeat(3)) ? TICK : "~";
      const markerLength = fencePrefix.match(new RegExp("^" + escapeRegex(marker) + "+", "u"))?.[0].length ?? 3;
      const language = fencePrefix.slice(markerLength).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith(marker.repeat(markerLength))) {
        code.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={"code-" + blockKey++} className="polyon-code-block">
          {language !== "" ? <div className="polyon-code-language">{language}</div> : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading !== null) {
      const level = Math.min(6, heading[1]!.length);
      const Tag = ("h" + level) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={"heading-" + blockKey++}>{renderInline(heading[2]!)}</Tag>);
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(line)) {
      blocks.push(<hr key={"hr-" + blockKey++} />);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index]!);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      blocks.push(
        <div key={"table-" + blockKey++} className="polyon-table-wrap">
          <table>
            <thead>
              <tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>{renderInline(row[cellIndex] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const list = line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/u);
    if (list !== null) {
      const ordered = /^\d/u.test(list[1]!);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const match = current.match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/u);
        if (match === null || /^\d/u.test(match[1]!) !== ordered) break;
        items.push(match[2]!);
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={"list-" + blockKey++}>
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ListTag>,
      );
      continue;
    }

    if (/^ {0,3}>\s?/u.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^ {0,3}>\s?/u.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^ {0,3}>\s?/u, ""));
        index += 1;
      }
      blocks.push(<blockquote key={"quote-" + blockKey++}>{renderBlocks(quote.join("\n"))}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index]!;
      if (
        next.trim() === "" ||
        /^ {0,3}#{1,6}\s+/u.test(next) ||
        next.trimStart().startsWith(TICK.repeat(3)) ||
        next.trimStart().startsWith("~~~") ||
        /^ {0,3}([-+*]|\d+[.)])\s+/u.test(next) ||
        /^ {0,3}>\s?/u.test(next) ||
        /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/u.test(next) ||
        isTableStart(lines, index)
      ) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push(<p key={"paragraph-" + blockKey++}>{renderInline(paragraph.join("\n"))}</p>);
  }

  return blocks;
}

function renderInline(value: string): ReactNode[] {
  const text = value
    .replace(/\\\*/gu, "*")
    .replace(/\\_/gu, "_")
    .replace(/\\#/gu, "#")
    .replace(/\\-/gu, "-");
  const pattern = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^\s)]+\)|https?:\/\/[^\s<]+|www\.[^\s<]+)/gu;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0]!;
    if (token.startsWith(TICK)) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={key++}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\([^\s)]+\)$/u);
      const href = token.match(/^\[[^\]]+\]\(([^)\s]+)\)$/u)?.[1];
      nodes.push(link !== null && href !== undefined ? safeLink(link[1]!, href, key++) : token);
    } else {
      nodes.push(safeLink(token, token.startsWith("www.") ? "https://" + token : token, key++));
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function safeLink(label: string, href: string, key: number): ReactNode {
  if (!/^https?:\/\//iu.test(href)) return label;
  return <a key={key} href={href} target="_blank" rel="noreferrer">{label}</a>;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index];
  const divider = lines[index + 1];
  if (header === undefined || divider === undefined) return false;
  return (
    header.trim().startsWith("|") &&
    divider.trim().startsWith("|") &&
    splitTableRow(divider).every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))
  );
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^()|[\]\\]/gu, "\\$&");
}
