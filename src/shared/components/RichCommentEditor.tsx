import { useEffect, useRef } from "react";
import { Bold, Italic, Link as LinkIcon, List, ListOrdered } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { sanitizeCommentHtml } from "@/shared/lib/sanitizeHtml";

interface Props {
  /** Cleaned HTML. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** HTML to start with, for editing an existing comment. */
  initialHtml?: string;
}

/** A small formatting editor for staff comments. Pasted content (for example a recap from another tool) is cleaned as it lands. */
export function RichCommentEditor({ value, onChange, placeholder = "Add a comment…", disabled, initialHtml }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Editing starts from the existing text.
  useEffect(() => {
    if (ref.current && initialHtml) { ref.current.innerHTML = sanitizeCommentHtml(initialHtml); onChange(sanitizeCommentHtml(initialHtml)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clearing the value from outside (after a post) clears the box; typing never rewrites it, and the first render never clears.
  const previous = useRef(value);
  useEffect(() => {
    if (ref.current && previous.current !== "" && value === "" && ref.current.innerHTML !== "") ref.current.innerHTML = "";
    previous.current = value;
  }, [value]);

  const emit = () => onChange(sanitizeCommentHtml(ref.current?.innerHTML ?? ""));
  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <div className="rounded-md border border-input">
      <div className="flex gap-1 border-b border-input px-1 py-1">
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Bold" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => run("bold")}><Bold className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Italic" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => run("italic")}><Italic className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Bulleted list" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertUnorderedList")}><List className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Numbered list" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => run("insertOrderedList")}><ListOrdered className="h-3.5 w-3.5" /></Button>
        <Button
          type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Link" disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { const url = window.prompt("Link address (https://…)"); if (url && /^https?:\/\//i.test(url)) run("createLink", url); }}
        ><LinkIcon className="h-3.5 w-3.5" /></Button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          // Keep formatting from a pasted recap, but only what comments may carry.
          const html = e.clipboardData.getData("text/html");
          if (!html) return;
          e.preventDefault();
          document.execCommand("insertHTML", false, sanitizeCommentHtml(html));
          emit();
        }}
        className="min-h-[3.5rem] max-h-64 overflow-y-auto px-3 py-2 text-sm outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)] [&_a]:text-accent [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
      />
    </div>
  );
}
