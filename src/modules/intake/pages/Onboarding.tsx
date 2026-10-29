import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/shared/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { StatementUpload } from "@/modules/crm";
import { supabase } from "@/shared/integrations/supabase/client";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  CheckCircle2,
  Users,
  Anchor,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  TreesIcon,
  Home,
  FileText,
} from "lucide-react";

type Step = "upload" | "processing" | "review" | "complete";

interface ParsedIndividual {
  full_name: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_primary: boolean;
  relationship_hint: string | null;
}

interface ParsedAccount {
  account_name: string;
  account_number: string | null;
  account_type: string;
  account_owner_name: string | null;
  custodian: string | null;
  book_value: number | null;
  current_value: number | null;
  notes: string | null;
}

interface OnboardingResult {
  family: { id: string; name: string };
  household: { id: string };
  contacts: Array<{ id: string; full_name: string }>;
  accountsExtracted: number;
  accountsInserted: number;
  summary: string;
  parsedData: {
    family_name: string;
    individuals: ParsedIndividual[];
    accounts: ParsedAccount[];
    summary: string;
  };
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [familyName, setFamilyName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);

  const fmt = (v: number | null) =>
    v != null ? `$${v.toLocaleString("en-CA", { minimumFractionDigits: 0 })}` : "—";

  async function handleProcess() {
    if (!files.length) {
      toast.error("Please upload at least one statement");
      return;
    }

    setStep("processing");
    setIsProcessing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Upload files to storage
      const filePaths: string[] = [];
      for (const file of files) {
        const path = `onboarding/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("statement-uploads")
          .upload(path, file, { contentType: file.type });
        if (upErr) throw new Error("Upload failed: " + upErr.message);
        filePaths.push(path);
      }

      // Call onboarding edge function
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onboarding-ingest`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ filePaths, familyName: familyName.trim() || undefined }),
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Onboarding failed");

      setResult(data);
      setStep("review");
      toast.success(`Onboarding complete, ${data.contacts?.length || 0} contact(s), ${data.accountsInserted} account(s) staged`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Onboarding failed");
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Client Onboarding</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Upload statements to automatically create family records and stage accounts in the Holding Tank.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/onboarding/bulk")} className="gap-2">
            <Users className="h-4 w-4" />
            Bulk Onboarding
          </Button>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-2">
          {[
            { key: "upload", label: "Upload", icon: Upload },
            { key: "processing", label: "AI Parsing", icon: Sparkles },
            { key: "review", label: "Review", icon: CheckCircle2 },
          ].map(({ key, label, icon: Icon }, i) => {
            const steps: Step[] = ["upload", "processing", "review", "complete"];
            const currentIndex = steps.indexOf(step);
            const stepIndex = steps.indexOf(key as Step);
            const isActive = stepIndex <= currentIndex;

            return (
              <div key={key} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`h-px w-8 ${isActive ? "bg-primary" : "bg-border"}`} />
                )}
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Step: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TreesIcon className="h-5 w-5 text-primary" />
                  Family Name
                  <Badge variant="secondary" className="text-[10px] ml-2">Optional</Badge>
                </CardTitle>
                <CardDescription>
                  Leave blank to auto-detect from statements. You can always edit later.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  placeholder="e.g. The Morrison Family"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                />
              </CardContent>
            </Card>

            <StatementUpload files={files} onFilesChange={setFiles} />

            <div className="flex justify-end">
              <Button
                onClick={handleProcess}
                disabled={!files.length}
                className="gap-2"
                size="lg"
              >
                Begin Onboarding
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step: Processing */}
        {step === "processing" && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-lg font-medium">AI is parsing your statements…</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Extracting contacts, accounts, and financial data from {files.length} file(s).
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step: Review */}
        {(step === "review" || step === "complete") && result && (
          <div className="space-y-4">
            {/* Summary */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Onboarding Complete</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {result.summary || `Created ${result.contacts.length} contact(s) and staged ${result.accountsInserted} account(s).`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Created Hierarchy */}
            <div className="grid gap-3 md:grid-cols-3">
              <Card>
                <CardContent className="py-3 flex items-center gap-2.5">
                  <TreesIcon className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Family</p>
                    <p className="font-semibold">{result.family.name}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3 flex items-center gap-2.5">
                  <Home className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Household</p>
                    <p className="font-semibold">Primary</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-3 flex items-center gap-2.5">
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">Contacts</p>
                    <p className="font-semibold">{result.contacts.length} created</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Contacts */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Contacts Created
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {result.parsedData.individuals?.map((ind, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-medium">{ind.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[ind.email, ind.phone, ind.relationship_hint].filter(Boolean).join(" · ") || "No additional info"}
                        </p>
                      </div>
                      {ind.is_primary && (
                        <Badge variant="secondary" className="text-[10px]">Primary</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Holding Tank Accounts */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Anchor className="h-4 w-4 text-primary" />
                  Accounts Staged in Holding Tank
                  <Badge variant="outline" className="ml-auto">{result.accountsInserted}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {result.parsedData.accounts?.map((acc, i) => (
                    <div key={i} className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{acc.account_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {[acc.account_owner_name, acc.custodian, acc.account_number].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">{acc.account_type}</Badge>
                      </div>
                      <div className="flex gap-6 mt-1.5 text-xs text-muted-foreground">
                        <span>BOY: <span className="font-medium text-foreground">{fmt(acc.book_value)}</span></span>
                        <span>Current: <span className="font-medium text-foreground">{fmt(acc.current_value)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => navigate("/holding-tank")} className="gap-2">
                <Anchor className="h-4 w-4" />
                Go to Holding Tank
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate(`/families`)}>
                  View Family
                </Button>
                <Button onClick={() => { setStep("upload"); setFiles([]); setResult(null); setFamilyName(""); }} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Onboard Another
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
