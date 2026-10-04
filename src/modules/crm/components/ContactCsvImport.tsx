import { useState, useRef } from "react";
import { supabase } from "@/shared/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { toast } from "sonner";
import { Upload, FileUp, AlertCircle } from "lucide-react";

const CONTACT_FIELDS = [
  { value: "__skip__", label: "— Skip —" },
  { value: "full_name", label: "Full Name" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "address", label: "Address" },
  { value: "lawyer_name", label: "Lawyer Name" },
  { value: "lawyer_firm", label: "Lawyer Firm" },
  { value: "accountant_name", label: "Accountant Name" },
  { value: "accountant_firm", label: "Accountant Firm" },
  { value: "executor_name", label: "Executor Name" },
  { value: "executor_firm", label: "Executor Firm" },
  { value: "poa_name", label: "POA Name" },
  { value: "poa_firm", label: "POA Firm" },
  
  { value: "google_drive_url", label: "Google Drive URL" },
  { value: "ia_financial_url", label: "IA Financial URL" },
];

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ",") {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function guessMapping(header: string): string {
  const h = header.toLowerCase().replace(/[_\-\s]+/g, "");
  if (h.includes("fullname") || h === "name" || h === "contactname") return "full_name";
  if (h === "firstname" || h === "first" || h === "fname") return "first_name";
  if (h === "lastname" || h === "last" || h === "surname" || h === "lname") return "last_name";
  // Only match "email" exactly or "emailaddress" — not "emailstatus", "emailsubscriber", etc.
  if (h === "email" || h === "emailaddress" || h === "e-mail") return "email";
  if (h.includes("phone") || h.includes("tel") || h.includes("mobile")) return "phone";
  if (h.includes("address") || h.includes("addr")) return "address";
  if (h.includes("lawyername")) return "lawyer_name";
  if (h.includes("lawyerfirm")) return "lawyer_firm";
  if (h.includes("accountantname")) return "accountant_name";
  if (h.includes("accountantfirm")) return "accountant_firm";
  if (h.includes("executorname")) return "executor_name";
  if (h.includes("executorfirm")) return "executor_firm";
  if (h.includes("poaname") || h.includes("powerofattorneyname")) return "poa_name";
  if (h.includes("poafirm") || h.includes("powerofattorneyfirm")) return "poa_firm";
  
  if (h.includes("googledrive") || h.includes("gdrive")) return "google_drive_url";
  if (h.includes("iafinancial")) return "ia_financial_url";
  return "__skip__";
}

interface ContactCsvImportProps {
  onImported: () => void;
}

export function ContactCsvImport({ onImported }: ContactCsvImportProps) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"upload" | "map" | "importing">("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers: h, rows: r } = parseCSV(text);
      if (h.length === 0) {
        toast.error("Could not parse CSV file.");
        return;
      }
      setHeaders(h);
      setRows(r);
      // Auto-guess mappings
      const map: Record<number, string> = {};
      h.forEach((header, i) => {
        map[i] = guessMapping(header);
      });
      setMapping(map);
      setStep("map");
    };
    reader.readAsText(file);
  }

  function updateMapping(colIndex: number, field: string) {
    setMapping((prev) => ({ ...prev, [colIndex]: field }));
  }

  const hasName = Object.values(mapping).includes("full_name") || Object.values(mapping).includes("first_name");

  async function handleImport() {
    if (!user) return;
    if (!hasName) {
      toast.error("You must map at least one column to Full Name or First Name.");
      return;
    }

    setImporting(true);
    setStep("importing");

    const contacts = rows
      .map((row) => {
        const record: Record<string, string | null> = { created_by: user.id };
        Object.entries(mapping).forEach(([colIdx, field]) => {
          if (field === "__skip__") return;
          const value = row[Number(colIdx)]?.trim();
          record[field] = value || null;
        });
        // Validate email looks like an email, otherwise discard it
        if (record.email && !record.email.includes("@")) {
          record.email = null;
        }
        // If full_name mapped but not first/last, split it
        if (record.full_name && !record.first_name) {
          const parts = (record.full_name as string).split(" ");
          record.first_name = parts[0] || "";
          record.last_name = parts.slice(1).join(" ") || "";
        }
        // If first_name mapped but no full_name, construct it
        if (record.first_name && !record.full_name) {
          record.full_name = `${record.first_name} ${record.last_name || ""}`.trim();
        }
        return record;
      })
      .filter((r) => r.first_name || r.full_name);

    if (contacts.length === 0) {
      toast.error("No valid rows found (all missing name).");
      setImporting(false);
      setStep("map");
      return;
    }

    // Fetch existing contacts for duplicate detection
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, full_name, first_name, last_name, email");

    const makeKey = (firstName: string | null, lastName: string | null, email: string | null) =>
      `${(firstName || "").toLowerCase()}|${(lastName || "").toLowerCase()}|${(email || "").toLowerCase()}`;

    const existingByKey = new Map<string, any>();
    (existing || []).forEach((c: any) => {
      existingByKey.set(makeKey(c.first_name, c.last_name, c.email), c);
      // Also match by full_name for legacy records
      if (c.full_name) {
        existingByKey.set(makeKey(c.full_name.split(" ")[0], c.full_name.split(" ").slice(1).join(" "), c.email), c);
      }
    });

    const toInsert: Record<string, string | null>[] = [];
    const toUpdate: { id: string; data: Record<string, string | null> }[] = [];
    const seenKeys = new Set<string>();

    for (const record of contacts) {
      const key = makeKey(record.first_name, record.last_name, record.email);
      // Also try matching by name only (no email)
      const nameKey = makeKey(record.first_name, record.last_name, null);

      if (seenKeys.has(key)) continue; // skip duplicates within the CSV itself
      seenKeys.add(key);

      const match = existingByKey.get(key) || existingByKey.get(nameKey);
      if (match) {
        // Merge: update empty fields in existing record
        const updates: Record<string, string | null> = {};
        Object.entries(record).forEach(([field, value]) => {
          if (field === "created_by" || field === "full_name") return;
          if (value && !match[field]) {
            updates[field] = value;
          }
        });
        if (Object.keys(updates).length > 0) {
          toUpdate.push({ id: match.id, data: updates });
        }
      } else {
        toInsert.push(record);
      }
    }

    // Perform inserts in batches
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      const { error } = await supabase.from("contacts").insert(batch as any);
      if (error) {
        toast.error(`Import error at row ${i + 1}: ${error.message}`);
        break;
      }
      inserted += batch.length;
    }

    // Perform updates
    let updated = 0;
    for (const { id, data } of toUpdate) {
      const { error } = await supabase.from("contacts").update(data as any).eq("id", id);
      if (!error) updated++;
    }

    const parts = [];
    if (inserted > 0) parts.push(`${inserted} imported`);
    if (updated > 0) parts.push(`${updated} merged`);
    const skipped = contacts.length - inserted - updated;
    if (skipped > 0) parts.push(`${skipped} duplicates skipped`);
    toast.success(parts.join(", ") + ".");

    setImporting(false);
    reset();
    onImported();
  }

  function reset() {
    setStep("upload");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file and map columns to contact fields.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="rounded-full bg-muted p-4">
              <FileUp className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Select a CSV file with contact data.<br />
              The first row should contain column headers.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              className="hidden"
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Choose File
            </Button>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{rows.length} rows</Badge>
              <Badge variant="secondary">{headers.length} columns</Badge>
              {!hasName && (
                <span className="flex items-center gap-1 text-destructive text-xs">
                  <AlertCircle className="h-3 w-3" />
                  Map a column to "Full Name" or "First Name"
                </span>
              )}
            </div>

            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium">CSV Column</th>
                    <th className="px-3 py-2 text-left font-medium">Sample</th>
                    <th className="px-3 py-2 text-left font-medium">Map to</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[150px]">
                        {rows[0]?.[i] || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={mapping[i] || "__skip__"}
                          onValueChange={(v) => updateMapping(i, v)}
                        >
                          <SelectTrigger className="h-8 text-xs w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONTACT_FIELDS.map((f) => (
                              <SelectItem key={f.value} value={f.value} className="text-xs">
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={!hasName}
                className="bg-sanctuary-bronze text-sanctuary-charcoal hover:bg-sanctuary-bronze/90"
              >
                Import {rows.length} contact{rows.length !== 1 ? "s" : ""}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">Importing contacts...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
