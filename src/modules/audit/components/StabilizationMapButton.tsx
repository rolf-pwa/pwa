import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ChevronDown, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/shared/integrations/supabase/client";
import { cn } from "@/shared/lib/utils";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:application/pdf;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface Props {
  contactId?: string;
  householdId?: string;
  className?: string;
}

export function StabilizationMapButton({ contactId, householdId, className }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file later
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      toast.error("PDF must be under 25 MB");
      return;
    }

    setUploading(true);
    const toastId = toast.loading("Reading audit PDF…");
    try {
      const pdfBase64 = await fileToBase64(file);
      toast.loading("Georgia is drafting the Transition Map…", { id: toastId });

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stabilization-map-from-audit`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ contactId, pdfBase64, pdfName: file.name }),
      });
      const data = await res.json();
      if (!res.ok || !data.mapId) {
        throw new Error(data.error || "Failed to generate map");
      }

      toast.success("Transition Map ready", { id: toastId });
      navigate(`/stabilization-map/${data.mapId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate map", { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFile}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className={cn(className)} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            Transition Map
            <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem
            onClick={() =>
              navigate(
                householdId
                  ? `/stabilization-map/household/${householdId}`
                  : `/stabilization-map/contact/${contactId}`,
              )
            }
          >
            <FileText className="mr-2 h-4 w-4" />
            Open / Generate from intake
          </DropdownMenuItem>
          {contactId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={pickFile} disabled={uploading}>
                <Upload className="mr-2 h-4 w-4" />
                Generate from Transition Survey PDF…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
