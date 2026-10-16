import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { OnboardingMemberInput, OnboardingState } from "../../hooks/useOnboarding";
import { cleanDob, dobRequiredFor } from "../../../../../supabase/functions/_shared/dob";

const RELATIONSHIPS: { value: OnboardingMemberInput["relationship"]; label: string }[] = [
  { value: "spouse", label: "Spouse / partner" },
  { value: "child", label: "Child" },
  { value: "dependant", label: "Other dependant" },
  { value: "other", label: "Other member" },
];

const ROLE_LABELS: Record<string, string> = {
  head_of_family: "Head of household",
  head_of_household: "Head of household",
  spouse: "Spouse / partner",
  child: "Child",
  dependant: "Dependant",
  beneficiary: "Beneficiary",
  minor: "Minor",
  other: "Household member",
};

// Display order for the "already on file" list: HOF, HOH, Minor, Beneficiary,
// then anything else in whatever order it arrived.
const ROLE_SORT_ORDER: Record<string, number> = {
  head_of_family: 0,
  head_of_household: 1,
  minor: 2,
  beneficiary: 3,
};
const roleSortRank = (role: string | null) => ROLE_SORT_ORDER[role ?? ""] ?? 99;

interface Props {
  state: OnboardingState;
  saving: boolean;
  onSave: (input: {
    householdName: string;
    primaryName: string;
    address: string;
    phone?: string;
    email?: string;
    dateOfBirth?: string;
    memberDobs?: Record<string, string>;
    members: OnboardingMemberInput[];
  }) => void;
}

const PLACEHOLDER_NAMES = ["new client", "client", ""];

/** Household info — details and members (each becomes a contact record).
 *  Step 1 for legacy upgrades, Step 2 for new clients. */
export const StepHouseholdProfile = ({ state, saving, onSave }: Props) => {
  const legacyUpgrade = state.household.legacyUpgrade;
  const knownName = PLACEHOLDER_NAMES.includes(state.contact.fullName.trim().toLowerCase())
    ? ""
    : state.contact.fullName;

  const derivedName =
    state.household.label ||
    (state.contact.lastName ? `${state.contact.lastName} Household` : knownName);

  const [primaryName, setPrimaryName] = useState(knownName);
  const [householdName, setHouseholdName] = useState(derivedName);
  const [address, setAddress] = useState(state.household.address);
  const [phone, setPhone] = useState(state.contact.phone);
  const [email, setEmail] = useState(state.contact.email);
  const [members, setMembers] = useState<OnboardingMemberInput[]>([]);
  const [dob, setDob] = useState(state.contact.dateOfBirth ?? "");
  // Dates of birth for members already on file who have none yet.
  const [memberDobs, setMemberDobs] = useState<Record<string, string>>({});

  const sortedExistingMembers = [...state.members].sort(
    (a, b) => roleSortRank(a.role) - roleSortRank(b.role),
  );

  const updateMember = (index: number, patch: Partial<OnboardingMemberInput>) =>
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  // A date of birth is required for you and for a spouse (on file or added here); for anyone else it is optional.
  const needsDob = sortedExistingMembers.filter((m) => !m.dateOfBirth && dobRequiredFor(m.role));
  const dobOk =
    cleanDob(dob) !== "invalid" && cleanDob(dob) !== null &&
    needsDob.every((m) => { const v = cleanDob(memberDobs[m.id]); return v !== "invalid" && v !== null; }) &&
    sortedExistingMembers.every((m) => cleanDob(memberDobs[m.id]) !== "invalid") &&
    members.filter((m) => m.fullName.trim().length > 0).every((m) => { const v = cleanDob(m.dateOfBirth); return v !== "invalid" && (v !== null || !dobRequiredFor(m.relationship === "spouse" ? "spouse" : "other")); });

  const canSubmit =
    primaryName.trim().length > 1 &&
    householdName.trim().length > 0 &&
    address.trim().length > 0 &&
    dobOk &&
    !saving;


  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-serif text-lg font-semibold text-foreground">
            {legacyUpgrade ? "Household info" : "Your household"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {legacyUpgrade
              ? "Confirm what's already on file, and add anyone genuinely missing."
              : "Add your spouse, children or other dependants. You can always add more later."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ob-primary-name">Your full name</Label>
            <Input
              id="ob-primary-name"
              value={primaryName}
              onChange={(e) => setPrimaryName(e.target.value)}
              placeholder="e.g. Jane Smith"
              maxLength={120}
              disabled={legacyUpgrade}
              className={legacyUpgrade ? "disabled:opacity-100 bg-muted/50 text-muted-foreground" : undefined}
            />
            {legacyUpgrade && (
              <p className="text-xs text-muted-foreground">
                On file — let us know if this needs to change.
              </p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ob-household">Household name</Label>
            <Input
              id="ob-household"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              placeholder="e.g. The Smith Household"
              maxLength={120}
              disabled={legacyUpgrade}
              className={legacyUpgrade ? "disabled:opacity-100 bg-muted/50 text-muted-foreground" : undefined}
            />
            {legacyUpgrade && (
              <p className="text-xs text-muted-foreground">
                On file — let us know if this needs to change.
              </p>
            )}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ob-address">Home address</Label>
            <Textarea
              id="ob-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, province, postal code"
              rows={2}
              maxLength={400}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ob-dob">Your date of birth</Label>
            <Input id="ob-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} className="sm:w-[220px]" />
            <p className="text-xs text-muted-foreground">We use it to apply the right age rules to your accounts and plan.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-phone">Phone</Label>
            <Input
              id="ob-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-email">Email</Label>
            <Input
              id="ob-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground font-serif">
                Household members
              </h3>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setMembers((prev) => [...prev, { fullName: "", email: "", relationship: "spouse" }])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add member
            </Button>
          </div>

          {sortedExistingMembers.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Already on file — no need to re-add these:
              </p>
              <ul className="space-y-1">
                {sortedExistingMembers.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground">{m.fullName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(m.role && ROLE_LABELS[m.role]) ?? m.role ?? "Household member"}
                    </span>
                    {!m.dateOfBirth && (
                      <Input
                        type="date"
                        aria-label={`Date of birth for ${m.fullName}`}
                        value={memberDobs[m.id] ?? ""}
                        onChange={(e) => setMemberDobs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        min="1900-01-01"
                        max={new Date().toISOString().slice(0, 10)}
                        className="h-8 w-[160px]"
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {members.length > 0 && (
            <div className="space-y-3">
              {members.map((member, index) => (
                <div
                  key={index}
                  className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[1fr_1fr_auto_auto_auto]"
                >
                  <Input
                    value={member.fullName}
                    onChange={(e) => updateMember(index, { fullName: e.target.value })}
                    placeholder="Full name"
                    maxLength={120}
                  />
                  <Input
                    value={member.email ?? ""}
                    onChange={(e) => updateMember(index, { email: e.target.value })}
                    placeholder="Email (optional)"
                    type="email"
                    maxLength={200}
                  />
                  <Input
                    type="date"
                    aria-label={`Date of birth${member.relationship === "spouse" ? "" : " (optional)"}`}
                    title={member.relationship === "spouse" ? "Date of birth (required)" : "Date of birth (optional)"}
                    value={member.dateOfBirth ?? ""}
                    onChange={(e) => updateMember(index, { dateOfBirth: e.target.value })}
                    min="1900-01-01"
                    max={new Date().toISOString().slice(0, 10)}
                    className="sm:w-[150px]"
                  />
                  <Select
                    value={member.relationship}
                    onValueChange={(v) =>
                      updateMember(index, {
                        relationship: v as OnboardingMemberInput["relationship"],
                      })
                    }
                  >
                    <SelectTrigger className="sm:w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIPS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setMembers((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Remove member"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Button
          disabled={!canSubmit}
          onClick={() =>
            onSave({
              householdName: householdName.trim(),
              primaryName: primaryName.trim(),
              address: address.trim(),


              phone: phone.trim(),
              email: email.trim(),
              dateOfBirth: dob,
              memberDobs: Object.fromEntries(Object.entries(memberDobs).filter(([, v]) => v)),
              members: members.filter((m) => m.fullName.trim().length > 0),
            })
          }
        >
          Save and continue
        </Button>
      </CardContent>
    </Card>
  );
};
