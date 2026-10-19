import { useState, useRef } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Upload, X, FileText, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/shared/integrations/supabase/client";
import { toast } from "sonner";

const REQUEST_TYPES = [
  { value: "banking_withdrawal", label: "Banking & Withdrawals", description: "Update banking info, request withdrawals, PAC/SWP changes" },
  { value: "personal_info", label: "Personal Info Changes", description: "Address, name, phone, email, beneficiary updates" },
  { value: "document_request", label: "Document Requests", description: "Tax slips, account statements, confirmation letters" },
  { value: "data_access", label: "My Data — Access Request", description: "Request a summary/export of the personal information we hold about you" },
  { value: "general_inquiry", label: "General Inquiry", description: "Anything else you need help with" },
];

interface Props {
  contactId: string;
  contactName: string;
  portalToken: string;
  /** The acknowledgement Georgia wrote for this request, when the server made a task for it. */
  onSubmitted: (acknowledgement?: string) => void;
  onCancel: () => void;
  prefillType?: string;
  prefillDescription?: string;
  chatTranscript?: { role: string; content: string }[];
}

type Phase = "form" | "uploading" | "submitted";

export function PortalAdminRequestForm({
  contactId,
  contactName,
  portalToken,
  onSubmitted,
  onCancel,
  prefillType,
  prefillDescription,
  chatTranscript,
}: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [requestType, setRequestType] = useState(prefillType || "");
  const [description, setDescription] = useState(prefillDescription || "");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    // Max 5 files, 10MB each
    const valid = newFiles.filter((f) => {
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`${f.name} exceeds 10MB limit`);
        return false;
      }
      return true;
    });
    setFiles((prev) => [...prev, ...valid].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!requestType || !description.trim()) {
      setError("Please select a request type and provide a description.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setPhase("uploading");

    try {
      // Upload files first
      const fileUrls: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("contact_id", contactId);
        formData.append("portal_token", portalToken);
        formData.append("file", file);
        const resp = await supabase.functions.invoke("portal-upload", {
          body: formData,
        });
        if (resp.error || resp.data?.error) {
          throw new Error(`Failed to upload ${file.name}`);
        }
        fileUrls.push(resp.data.path);
      }

      // Submit request via edge function
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/portal-assistant`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "submit_request",
            requestData: {
              contact_id: contactId,
              portal_token: portalToken,
              request_type: requestType,
              request_description: description.trim(),
              file_urls: fileUrls,
              request_details: {
                contact_name: contactName,
                submitted_from: "portal_georgia_chat",
                chat_transcript: chatTranscript || [],
              },
            },
          }),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit request");
      }

      const result = await res.json().catch(() => ({}));
      const ack = typeof result?.acknowledgement === "string" && result.acknowledgement ? result.acknowledgement : undefined;
      setAcknowledgement(ack ?? null);
      setPhase("submitted");
      setTimeout(() => onSubmitted(ack), 2000);
    } catch (e) {
      console.error("Submit error:", e);
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("form");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (phase === "submitted") {
    return (
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-center space-y-3">
        <CheckCircle className="h-8 w-8 text-accent mx-auto" />
        <h3 className="font-serif font-semibold text-foreground">Request Submitted</h3>
        <p className="text-sm text-muted-foreground">
          {acknowledgement ?? "Your Personal CFO will review this and follow up with you shortly."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-serif font-semibold text-foreground text-sm">Admin Request</h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Request Type</Label>
          <Select value={requestType} onValueChange={setRequestType} disabled={isSubmitting}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Select a category..." />
            </SelectTrigger>
            <SelectContent>
              {REQUEST_TYPES.map((rt) => (
                <SelectItem key={rt.value} value={rt.value}>
                  <div>
                    <span className="font-medium">{rt.label}</span>
                    <span className="text-muted-foreground ml-1 text-xs">— {rt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Textarea
            placeholder="Please describe your request in detail..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
            className="text-sm min-h-[80px] resize-none"
            maxLength={2000}
          />
          <p className="text-[10px] text-muted-foreground text-right">{description.length}/2000</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Attach Documents (optional)</Label>
          <div className="rounded-md border border-dashed border-border p-3 text-center">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
              onChange={handleFileAdd}
              className="hidden"
              disabled={isSubmitting || files.length >= 5}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting || files.length >= 5}
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" />
              {files.length >= 5 ? "Max 5 files" : "Choose files"}
            </button>
            <p className="text-[10px] text-muted-foreground mt-1">
              PDF, images, Word, Excel · Max 10MB each
            </p>
          </div>

          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1 text-foreground">{file.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {(file.size / 1024).toFixed(0)}KB
                  </span>
                  <button
                    onClick={() => removeFile(i)}
                    disabled={isSubmitting}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting || !requestType || !description.trim()}
          className="flex-1"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              {phase === "uploading" && files.length > 0 ? "Uploading..." : "Submitting..."}
            </>
          ) : (
            "Submit Request"
          )}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        🔒 Your files are encrypted and stored securely. Only your advisory team can access them.
      </p>
    </div>
  );
}
