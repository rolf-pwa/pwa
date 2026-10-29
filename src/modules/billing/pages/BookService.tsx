import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/shared/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { formatMoney, round2 } from "../lib/money";

interface PublicService {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  duration_minutes: number | null;
  tax_rate: number | null;
  requires_prepayment: boolean | null;
  booking_url: string | null;
  slug: string | null;
}

export default function BookService({ embed = false }: { embed?: boolean }) {
  const { slug } = useParams<{ slug?: string }>();

  const [searchParams] = useSearchParams();
  const [services, setServices] = useState<PublicService[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ schedulingUrl: string | null } | null>(null);

  useEffect(() => {
    document.title = "Book a service | ProsperWise";
    (async () => {
      const { data } = await supabase
        .from("services" as any)
        .select(
          "id, name, description, price, currency, duration_minutes, tax_rate, requires_prepayment, booking_url, slug",
        )
        .eq("is_active", true)
        .order("name");
      const rows: PublicService[] = (data as any) || [];
      setServices(rows);
      const wanted = slug || searchParams.get("service");
      if (wanted) {
        const match = rows.find((s) => s.slug === wanted || s.id === wanted);
        if (match) setServiceId(match.id);
      }
    })();
  }, [slug, searchParams]);

  const selected = services.find((s) => s.id === serviceId);

  const totals = useMemo(() => {
    if (!selected) return null;
    const price = Number(selected.price || 0);
    const tax = round2(price * (Number(selected.tax_rate || 0) / 100));
    return { price, tax, total: round2(price + tax), rate: Number(selected.tax_rate || 0) };
  }, [selected]);

  const locked = Boolean(slug || searchParams.get("service"));

  const willPay = Boolean(selected && selected.requires_prepayment !== false && Number(selected.price || 0) > 0);

  const submit = async () => {
    if (!serviceId || !name.trim() || !email.trim()) {
      toast.error("Service, name, and email are required.");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("book-checkout", {
      body: {
        action: "createCheckout",
        serviceId,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        startsAt: startsAt || null,
        notes: notes.trim(),
        returnUrl: `${window.location.origin}/book/confirm`,
      },
    });

    const result: any = data;
    if (error || !result?.ok) {
      setSubmitting(false);
      toast.error(result?.error || "We couldn't start that booking. Please try again.");
      return;
    }

    if (result.requiresPayment && result.checkoutUrl) {
      // Square's hosted checkout refuses to render inside an iframe, so always
      // send the buyer to a top-level page when we're embedded.
      if (embed) {
        let escaped = false;
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = result.checkoutUrl;
            escaped = true;
          }
        } catch {
          escaped = false;
        }
        if (!escaped) {
          const opened = window.open(result.checkoutUrl, "_blank", "noopener");
          if (!opened) window.location.href = result.checkoutUrl;
        }
        setSubmitting(false);
        return;
      }
      window.location.href = result.checkoutUrl;
      return;
    }


    setSubmitting(false);
    setDone({ schedulingUrl: result.schedulingUrl || selected?.booking_url || null });
  };

  return (
    <main className={embed ? "bg-background px-3 py-4" : "min-h-screen bg-background px-4 py-12"}>
      <div className="mx-auto max-w-xl">
        {!embed && (
          <>
            <h1 className="mb-2 font-serif text-3xl">Book a service</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Choose the engagement you'd like, pay securely, then pick your time.
            </p>
          </>
        )}


        {done ? (
          <Card>
            <CardContent className="flex items-start gap-3 py-8">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-accent" />
              <div className="space-y-3">
                <div>
                  <p className="font-medium">Request received</p>
                  <p className="text-sm text-muted-foreground">
                    Our team will follow up shortly to confirm your appointment.
                  </p>
                </div>
                {done.schedulingUrl && (
                  <Button asChild>
                    <a href={done.schedulingUrl} target="_blank" rel="noopener noreferrer">
                      Choose your time
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Booking details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {locked && selected ? (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="font-medium">{selected.name}</p>
                  {selected.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMoney(selected.price, selected.currency)}
                    {selected.duration_minutes ? ` · ${selected.duration_minutes} min` : ""}
                  </p>
                </div>
              ) : (
              <div className="space-y-2">
                <Label>Service</Label>
                <Select value={serviceId} onValueChange={setServiceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}, {formatMoney(s.price, s.currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selected?.description && <p className="text-xs text-muted-foreground">{selected.description}</p>}
              </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bk-name">Full name</Label>
                  <Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bk-email">Email</Label>
                  <Input id="bk-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bk-phone">Phone (optional)</Label>
                  <Input id="bk-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bk-when">Preferred time (optional)</Label>
                  <Input
                    id="bk-when"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bk-notes">Anything we should know?</Label>
                <Textarea id="bk-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {totals && willPay && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service</span>
                    <span>{formatMoney(totals.price, selected?.currency)}</span>
                  </div>
                  {totals.tax > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax ({totals.rate}%)</span>
                      <span>{formatMoney(totals.tax, selected?.currency)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
                    <span>Total due today</span>
                    <span>{formatMoney(totals.total, selected?.currency)}</span>
                  </div>
                </div>
              )}

              <Button className="w-full" onClick={submit} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : willPay ? (
                  <Lock className="mr-2 h-4 w-4" />
                ) : null}
                {willPay && totals
                  ? `Pay ${formatMoney(totals.total, selected?.currency)} & book`
                  : "Submit request"}
              </Button>
              {willPay && (
                <p className="text-xs text-muted-foreground">
                  Payments are processed securely by Square. You'll choose your appointment time right after
                  checkout.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Please don't include financial account numbers or health information in this form.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
