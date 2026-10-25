import { ChevronRight } from "lucide-react";

export interface MobileSection { value: string; label: string; icon: React.ComponentType<{ className?: string }>; hint?: string }

/**
 * A page with sections, on a phone: the sections are a list of large rows (like iOS Settings) instead of a strip of tabs. Tapping one opens it as the next screen;
 * the Back arrow returns to this list. The page keeps the open section in its address, so Back and reload work the way an app's do.
 */
export function MobileSectionList({ sections, onOpen, label = "Sections" }: { sections: MobileSection[]; onOpen: (value: string) => void; label?: string }) {
  return (
    <nav aria-label={label} data-testid="mobile-sections">
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {sections.map(({ value, label: text, icon: Icon, hint }) => (
          <li key={value}>
            <button type="button" onClick={() => onOpen(value)} data-testid={`section-${value}`} className="flex min-h-14 w-full items-center gap-3 px-4 text-left active:bg-muted">
              <Icon className="h-5 w-5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{text}</span>{hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
