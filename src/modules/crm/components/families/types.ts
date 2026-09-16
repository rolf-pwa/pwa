export interface Individual {
  id: string;
  first_name: string;
  last_name: string | null;
  family_role: string;
  is_minor: boolean;
  email: string | null;
  phone: string | null;
}

export interface Household {
  id: string;
  label: string;
  address: string | null;
  governance_status: string | null;
  fiduciary_entity: string | null;
  individuals: Individual[];
}

export interface Family {
  id: string;
  name: string;
  fee_tier: string;
  fee_tier_discount_pct: number;
  total_family_assets: number;
  annual_savings: number;
  charter_document_url: string | null;
  service_tier: string | null;
  households: Household[];
}

export type SelectedType = "family" | "household" | "contact";
export type Selected = { type: SelectedType; id: string } | null;

export type ResolvedSelection =
  | { type: "family"; family: Family }
  | { type: "household"; family: Family; household: Household }
  | { type: "contact"; family: Family; household: Household; individual: Individual };
