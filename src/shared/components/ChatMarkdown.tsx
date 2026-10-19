import React from "react";
import ReactMarkdown from "react-markdown";
import { LinkifyText } from "@/shared/components/LinkifyText";

/** Plain addresses inside text become links; text that markdown already links is left alone. */
const linkify = (children: React.ReactNode): React.ReactNode =>
  React.Children.map(children, (c) => (typeof c === "string" ? <LinkifyText text={c} /> : c));

/** An assistant's message with its **bold**, lists and links shown as formatting, not as asterisks. No raw HTML is ever rendered. */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-foreground [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{linkify(children)}</p>,
          li: ({ children }) => <li>{linkify(children)}</li>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
