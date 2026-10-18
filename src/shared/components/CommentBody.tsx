import { sanitizeCommentHtml } from "@/shared/lib/sanitizeHtml";
import { cn } from "@/shared/lib/utils";

const URL_SPLIT = /(https?:\/\/[^\s]+)/g;

/** A task comment: staff-written HTML is cleaned and shown formatted; plain text keeps its line breaks and gets live links. */
export function CommentBody({ body, format, className }: { body: string; format?: "text" | "html" | null; className?: string }) {
  if (format === "html") {
    return (
      <div
        className={cn("break-words [&_a]:text-accent [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_h4]:mt-2 [&_h4]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2", className)}
        dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(body) }}
      />
    );
  }
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {body.split(URL_SPLIT).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent underline break-all">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}
