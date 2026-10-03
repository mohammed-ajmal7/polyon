import type { ReactNode } from "react";

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(<ul key={blocks.length} className="my-3 list-disc space-y-1 pl-6 text-slate-200">{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  lines.forEach((line, index) => {
    if (/^\s*[-*]\s+/.test(line)) { list.push(line.replace(/^\s*[-*]\s+/, "")); return; }
    flushList();
    if (!line.trim()) return;
    if (/^###\s+/.test(line)) blocks.push(<h3 key={index} className="mt-5 text-base font-semibold text-white">{inline(line.replace(/^###\s+/, ""))}</h3>);
    else if (/^##\s+/.test(line)) blocks.push(<h2 key={index} className="mt-5 text-lg font-semibold text-white">{inline(line.replace(/^##\s+/, ""))}</h2>);
    else if (/^#\s+/.test(line)) blocks.push(<h1 key={index} className="mt-5 text-xl font-semibold text-white">{inline(line.replace(/^#\s+/, ""))}</h1>);
    else if (/^>\s?/.test(line)) blocks.push(<blockquote key={index} className="my-3 border-l-2 border-violet-300/30 pl-4 text-slate-300">{inline(line.replace(/^>\s?/, ""))}</blockquote>);
    else blocks.push(<p key={index} className="my-3 whitespace-pre-wrap leading-7 text-slate-100">{inline(line)}</p>);
  });
  flushList();
  return <div className="text-[15px]">{blocks}</div>;
}
function inline(value: string): ReactNode {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>
      : part
  );
}
