import { Fragment, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import type { QuestionAsset } from "@/domain/exam";
import { cn } from "@/lib/utils";

interface RichContentProps {
  text: string;
  assets?: QuestionAsset[];
  className?: string;
  id?: string;
}

/** Render acotado: texto plano, LaTeX con $...$/$$...$$ y bloques ```...```. */
export function RichContent({ text, assets = [], className, id }: RichContentProps) {
  return (
    <div id={id} className={cn("rich-content", className)}>
      {renderBlocks(text)}
      {assets.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {assets.map((asset) => (
            <figure key={asset.id} className="overflow-hidden rounded-lg border bg-white">
              <img
                src={`/api/question-assets/${encodeURIComponent(asset.id)}`}
                alt={asset.name}
                width={asset.width}
                height={asset.height}
                className="max-h-[32rem] w-full object-contain"
                loading="lazy"
              />
              <figcaption className="border-t px-3 py-2 text-xs text-muted">{asset.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderBlocks(source: string): ReactNode[] {
  const blocks = source.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g);
  return blocks.filter(Boolean).map((block, index) => {
    if (block.startsWith("```") && block.endsWith("```")) {
      const raw = block.slice(3, -3);
      const newline = raw.indexOf("\n");
      const language = newline > -1 ? raw.slice(0, newline).trim() : "";
      const code = newline > -1 ? raw.slice(newline + 1) : raw;
      return <pre key={index} className="my-3 overflow-x-auto rounded-md bg-ink px-4 py-3 text-sm text-white"><code data-language={language || undefined}>{code}</code></pre>;
    }
    if (block.startsWith("$$") && block.endsWith("$$")) {
      return <Math key={index} expression={block.slice(2, -2)} display />;
    }
    return <Fragment key={index}>{renderInline(block, index)}</Fragment>;
  });
}

function renderInline(source: string, blockIndex: number): ReactNode[] {
  return source.split(/(\$[^$\n]+\$)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("$") && part.endsWith("$")) {
      return <Math key={`${blockIndex}-${index}`} expression={part.slice(1, -1)} />;
    }
    return <Fragment key={`${blockIndex}-${index}`}>{part}</Fragment>;
  });
}

function Math({ expression, display = false }: { expression: string; display?: boolean }) {
  const html = katex.renderToString(expression, {
    displayMode: display,
    throwOnError: false,
    strict: "warn",
    trust: false,
    output: "htmlAndMathml",
  });
  const Tag = display ? "div" : "span";
  return <Tag className={display ? "my-3 overflow-x-auto py-1" : "inline-math"} dangerouslySetInnerHTML={{ __html: html }} />;
}
