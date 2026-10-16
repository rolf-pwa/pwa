import React from "react";

const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/;
const TRAILING = /[.,;:!?)'’”]+$/;

/** Splits text into plain pieces and web addresses. A full stop, comma or bracket that ends a sentence is not part of the address. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const plain = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && !last.href) last.text += t; else out.push({ text: t });
  };
  text.split(URL_REGEX).forEach((part, i) => {
    if (i % 2 === 0) { plain(part); return; }
    const trail = part.match(TRAILING)?.[0] ?? "";
    const url = trail ? part.slice(0, -trail.length) : part;
    if (url.length > "https://".length) { out.push({ text: url, href: url }); plain(trail); }
    else plain(part);
  });
  return out;
}

export function LinkifyText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 break-all hover:text-primary/80"
          >
            {p.text}
          </a>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        )
      )}
    </>
  );
}
