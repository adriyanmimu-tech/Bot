import React, { useState } from "react";
import { Check, Copy, Play, Download, ChevronDown, ChevronRight } from "lucide-react";

interface MessageRendererProps {
  content: string;
  onRunHtml: (htmlCode: string) => void;
}

interface ParsedBlock {
  type: "text" | "code";
  language?: string;
  content: string;
}

function splitThinkingBlock(raw: string): {
  thinkingText: string | null;
  mainContent: string;
  isThinkingOpen: boolean;
} {
  if (!raw.includes("<think>")) {
    return { thinkingText: null, mainContent: raw, isThinkingOpen: false };
  }
  const startIdx = raw.indexOf("<think>");
  const endIdx = raw.indexOf("</think>");
  if (endIdx !== -1 && endIdx > startIdx) {
    const thinking = raw.slice(startIdx + 7, endIdx).trim();
    const rest = (raw.slice(0, startIdx) + raw.slice(endIdx + 8)).trim();
    return { thinkingText: thinking, mainContent: rest, isThinkingOpen: false };
  } else {
    // Still streaming inside <think>
    const thinking = raw.slice(startIdx + 7).trim();
    const before = raw.slice(0, startIdx).trim();
    return { thinkingText: thinking, mainContent: before, isThinkingOpen: true };
  }
}

function parseContentBlocks(raw: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "text",
        content: raw.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: "code",
      language: (match[1] || "text").toLowerCase(),
      content: match[2].replace(/\n$/, ""),
    });
    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < raw.length) {
    blocks.push({
      type: "text",
      content: raw.slice(lastIndex),
    });
  }

  return blocks;
}

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800/90 text-indigo-700 dark:text-indigo-300 font-mono text-[13px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={idx}>
        {boldParts.map((bPart, bIdx) => {
          if (
            bPart.startsWith("**") &&
            bPart.endsWith("**") &&
            bPart.length > 4
          ) {
            return (
              <strong
                key={bIdx}
                className="font-semibold text-slate-900 dark:text-white"
              >
                {bPart.slice(2, -2)}
              </strong>
            );
          }
          return bPart;
        })}
      </React.Fragment>
    );
  });
}

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  content,
  onRunHtml,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const { thinkingText, mainContent, isThinkingOpen } =
    splitThinkingBlock(content);
  const [showThinking, setShowThinking] = useState<boolean>(isThinkingOpen);

  const blocks = parseContentBlocks(mainContent);

  const handleCopyCode = (code: string, idx: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  const handleDownloadCode = (code: string, lang: string) => {
    const extMap: Record<string, string> = {
      html: "html",
      htm: "html",
      javascript: "js",
      js: "js",
      typescript: "ts",
      ts: "ts",
      tsx: "tsx",
      python: "py",
      py: "py",
      json: "json",
      css: "css",
      sql: "sql",
      csv: "csv",
      markdown: "md",
      md: "md",
    };
    const ext = extMap[lang] || "txt";
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snippet_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 break-words">
      {thinkingText !== null && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowThinking((s) => !s)}
            className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-mono text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors cursor-pointer"
          >
            <span>
              {isThinkingOpen
                ? "Reasoning in progress (NoTrack Model A)..."
                : "Internal Chain-of-Thought Reasoning"}
            </span>
            {showThinking || isThinkingOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
          {(showThinking || isThinkingOpen) && (
            <div className="px-3.5 py-2.5 border-t border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
              {thinkingText}
            </div>
          )}
        </div>
      )}

      {blocks.map((block, bIdx) => {
        if (block.type === "code") {
          const lang = block.language || "code";
          const isPreviewable =
            lang === "html" ||
            lang === "htm" ||
            lang === "svg" ||
            block.content.includes("<!DOCTYPE html") ||
            block.content.includes("<html");

          return (
            <div
              key={bIdx}
              className="my-3 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 text-slate-100"
            >
              <div className="flex items-center justify-between px-3.5 py-2 bg-slate-950 border-b border-slate-800 text-xs text-slate-400">
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-slate-300 font-medium">{lang}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {block.content.split("\n").length} lines
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isPreviewable && (
                    <button
                      type="button"
                      onClick={() => onRunHtml(block.content)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Live Preview</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDownloadCode(block.content, lang)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    title="Download snippet"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(block.content, bIdx)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedIndex === bIdx ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-slate-100">
                <code>{block.content}</code>
              </pre>
            </div>
          );
        }

        const lines = block.content.split("\n");
        return (
          <div key={bIdx} className="space-y-2">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={lIdx} className="h-1" />;
              }
              if (trimmed.startsWith("### ")) {
                return (
                  <h4
                    key={lIdx}
                    className="text-base font-semibold text-slate-900 dark:text-white pt-2"
                  >
                    {renderInlineFormatting(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith("## ")) {
                return (
                  <h3
                    key={lIdx}
                    className="text-lg font-semibold text-slate-900 dark:text-white pt-3"
                  >
                    {renderInlineFormatting(trimmed.slice(3))}
                  </h3>
                );
              }
              if (trimmed.startsWith("# ")) {
                return (
                  <h2
                    key={lIdx}
                    className="text-xl font-bold text-slate-900 dark:text-white pt-3"
                  >
                    {renderInlineFormatting(trimmed.slice(2))}
                  </h2>
                );
              }
              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <div key={lIdx} className="flex items-start gap-2.5 pl-1">
                    <span className="text-slate-400 dark:text-slate-500 select-none mt-0.5">
                      •
                    </span>
                    <div className="flex-1">
                      {renderInlineFormatting(trimmed.slice(2))}
                    </div>
                  </div>
                );
              }
              const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
              if (numberedMatch) {
                return (
                  <div key={lIdx} className="flex items-start gap-2.5 pl-1">
                    <span className="text-slate-500 dark:text-slate-400 font-mono text-xs tabular-nums mt-1 select-none">
                      {numberedMatch[1]}.
                    </span>
                    <div className="flex-1">
                      {renderInlineFormatting(numberedMatch[2])}
                    </div>
                  </div>
                );
              }

              return (
                <p key={lIdx} className="leading-relaxed">
                  {renderInlineFormatting(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
