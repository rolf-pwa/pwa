import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Progress } from "@/shared/components/ui/progress";
import {
  Upload,
  Loader2,
  FileCheck2,
  Clock,
  AlertCircle,
  Inbox,
  CheckCircle2,
  ArrowLeft,
  Circle,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useOnboardingManifest, type IntakeChecklistItem } from "@/shared/hooks/useOnboardingManifest";

interface Props {
  portalToken: string;
  onBack: () => void;
  /** Fired once when the document checklist first reports completion. */
  onComplete?: () => void;
}

const STATUS_META: Record<string, { label: string; icon: typeof Clock }> = {
  pending: { label: "Filing", icon: Clock },
  filed: { label: "Filed", icon: FileCheck2 },
  needs_review: { label: "In review", icon: AlertCircle },
  failed: { label: "Needs attention", icon: AlertCircle },
};

const CHECKLIST_META: Record<string, { label: string; icon: typeof Circle }> = {
  waiting: { label: "Waiting", icon: Circle },
  received: { label: "Received", icon: Clock },
  filed: { label: "Filed", icon: FileCheck2 },
  needs_review: { label: "In review", icon: AlertCircle },
};

function prettyCategory(raw?: string | null) {
  if (!raw) return "Other documents";
  return raw.replace(/^\d+[_\-\s]*/, "").replace(/[_&]+/g, " ").replace(/\s+/g, " ").trim();
}

const sectionLabel = "text-sm font-semibold text-foreground font-serif";

export function PortalIntakePage({ portalToken, onBack, onComplete }: Props) {
  const {
    manifest,
    loading,
    upload,
    tasks,
    uploading,
    isComplete,
    percent,
    audit,
    processing,
  } = useOnboardingManifest(portalToken, { active: true });

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const completedRef = useRef(false);

  // Tell the onboarding shell the moment the checklist is satisfied.
  useEffect(() => {
    if (!isComplete || completedRef.current || !onComplete) return;
    completedRef.current = true;
    onComplete();
  }, [isComplete, onComplete]);

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as FileList);
    if (!list.length) return;
    const { accepted, rejected } = await upload(list);
    rejected.forEach((r) => toast.error(r));
    if (accepted) {
      toast.success(
        accepted === 1 ? "Document received" : `${accepted} documents received`,
        { description: "We're filing it into your vault now." },
      );
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const backLink = (
    <button
      onClick={onBack}
      className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to portal
    </button>
  );

  const header = (
    <div className="space-y-1.5">
      {backLink}
      <h2 className="font-serif text-lg font-semibold text-foreground">Your documents</h2>
      <p className="text-sm text-muted-foreground">
        {manifest?.householdName
          ? `${manifest.householdName} · secure Canadian infrastructure`
          : "Secure Canadian infrastructure"}
      </p>
    </div>
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-6 p-6">
          {header}
          <div className="py-10 text-center text-sm text-muted-foreground">Loading your checklist…</div>
        </CardContent>
      </Card>
    );
  }

  if (!manifest?.enabled || manifest.ready === false) {
    return (
      <Card>
        <CardContent className="space-y-6 p-6">
          {header}
          <div className="py-10 text-center">
            <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Your vault is still being prepared. We'll let you know as soon as your Sovereignty Survey is
              open.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isComplete) {
    return (
      <Card>
        <CardContent className="space-y-6 p-6">
          {header}
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
            <p className="font-serif text-lg text-foreground">Your vault is complete</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {manifest.completion?.uploadedFiles ?? 0} documents received and filed. Nothing further
              is needed from you right now.
            </p>
            <Button variant="outline" className="mt-5" onClick={onBack}>
              Return to portal
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const c = manifest.completion ?? {};
  const uploads = manifest.uploads ?? [];
  const checklist: IntakeChecklistItem[] = manifest.checklist ?? [];
  const maxMb = Math.round((manifest.limits?.maxBytes ?? 25 * 1024 * 1024) / 1024 / 1024);

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {header}

        {/* Progress */}
        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">
              {audit && typeof audit.criticalTotal === "number" && audit.criticalTotal > 0
                ? `${audit.criticalSatisfied ?? 0} of ${audit.criticalTotal} essential documents confirmed`
                : `${c.uploadedFiles ?? 0} received${c.expectedItems ? ` of ${c.expectedItems} expected` : ""}`}
            </span>
            <span className="text-muted-foreground">{percent}%</span>
          </div>
          <Progress value={percent} className="h-2" />
          <p className="flex items-start gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            Our AI reads each document to build your Survey — send as much as you can now for a more
            precise, personalized result.
          </p>
          <p className="text-xs text-muted-foreground">
            Every document you send is renamed and filed into the right vault folder automatically.
            Our team reviews anything that needs a second look.
            {processing > 0
              ? ` ${processing} document${processing === 1 ? " is" : "s are"} still being processed — this list updates on its own.`
              : ""}
          </p>
        </div>

        <div className="grid gap-6 border-t border-border pt-5 sm:grid-cols-2">
          {/* Dropzone */}
          <div className="space-y-3">
            <h3 className={sectionLabel}>Send documents</h3>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition ${
                dragging
                  ? "border-primary bg-primary/[0.06]"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              {uploading ? (
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-primary" />
              ) : (
                <Upload className="mx-auto mb-2 h-6 w-6 text-primary" />
              )}
              <p className="text-sm text-foreground">
                {uploading ? "Uploading…" : "Drag files here, or click to browse"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Up to {maxMb}MB per file. Statements, tax returns, policies, IDs and legal documents
                all welcome.
              </p>
            </div>

            {tasks.length > 0 && (
              <ul className="space-y-2">
                {tasks.map((t) => (
                  <li key={t.id} className="rounded-md border border-border/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-foreground">{t.name}</span>
                      <span
                        className={
                          t.state === "error" ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        {t.state === "error"
                          ? t.error || "Failed"
                          : t.state === "done"
                            ? "Sent"
                            : `${t.progress}%`}
                      </span>
                    </div>
                    {t.state !== "error" && (
                      <Progress value={t.progress} className="mt-1.5 h-1" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Checklist */}
          <div className="space-y-3">
            <h3 className={sectionLabel}>Your list</h3>
            <p className="text-xs text-muted-foreground">
              Chosen for your situation. Send what you have; anything marked optional can wait, and a missing item never holds you up.
            </p>
            {checklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No specific checklist yet — send whatever you have and we'll sort it. Your advisor
                will follow up if anything is missing.
              </p>
            ) : (
              <div className="rounded-lg border border-border">
                {(
                  [
                    ["required", "Required", checklist.filter((i) => i.requirement === "required")],
                    ["optional", "Optional", checklist.filter((i) => i.requirement !== "required")],
                  ] as const
                ).map(([key, label, group]) =>
                  group.length === 0 ? null : (
                    <div key={key}>
                      <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2">
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          {label}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{group.length}</span>
                      </div>
                      <ul className="divide-y divide-border/60">
                        {group.map((item, i) => {
                          const meta =
                            CHECKLIST_META[item.status ?? "waiting"] ?? CHECKLIST_META.waiting;
                          const Icon = meta.icon;
                          return (
                            <li
                              key={`${key}-${item.name}-${i}`}
                              className="flex items-center justify-between gap-3 px-4 py-2.5"
                            >
                              <div className="min-w-0">
                                <p className="text-sm text-foreground">{item.name}</p>
                                {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                  {item.reason ? `${item.reason} · ` : ""}{prettyCategory(item.category)}
                                  {item.subType ? ` · ${item.subType}` : ""}
                                </p>
                              </div>
                              <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                                <Icon className="h-3 w-3" />
                                {meta.label}
                              </Badge>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        {/* Activity */}
        <div className="space-y-3 border-t border-border pt-5">
          <h3 className={sectionLabel}>Received documents</h3>
          {uploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing received yet.</p>
          ) : (
            <div className="rounded-lg border border-border">
              <ul className="divide-y divide-border/60">
                {uploads.map((u, i) => {
                  const meta =
                    STATUS_META[u.classification?.status ?? "pending"] ?? STATUS_META.pending;
                  const Icon = meta.icon;
                  return (
                    <li
                      key={`${u.fileName}-${i}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{u.fileName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {[u.folderName ? prettyCategory(u.folderName) : null,
                            u.createdAt ? format(new Date(u.createdAt), "PP") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {onComplete && (
          <div className="flex flex-col items-center gap-2 border-t border-border pt-5 text-center">
            <Button onClick={onComplete}>
              <CheckCircle2 className="h-4 w-4" />
              I've sent everything I have — Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
            <p className="text-xs text-muted-foreground">
              Missing something? No problem — send it whenever it's ready, and our team will follow up
              on anything still outstanding.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
