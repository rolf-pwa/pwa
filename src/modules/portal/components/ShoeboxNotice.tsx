import { Users } from "lucide-react";

/** Said wherever a client can put a document in the household Shoebox: everyone in the household can see it. */
export function shoeboxNoticeText(hasPersonal: boolean) {
  return hasPersonal
    ? "Files you add here are shared with everyone in your household. For private files, upload to Personal Docs instead."
    : "Files you add here are shared with everyone in your household.";
}

export function ShoeboxNotice({ hasPersonal, className = "" }: { hasPersonal: boolean; className?: string }) {
  return (
    <p className={`flex items-start gap-1.5 text-[11px] leading-snug text-amber-800 ${className}`} role="note">
      <Users className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{shoeboxNoticeText(hasPersonal)}</span>
    </p>
  );
}
