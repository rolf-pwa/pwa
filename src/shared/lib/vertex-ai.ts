import { supabase } from "@/shared/integrations/supabase/client";
import type { BrainCitation } from "@/shared/lib/brain";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export type Message = { role: "user" | "assistant" | "system"; content: string; documentData?: { mimeType: string; base64: string } };

export interface FunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface AssistantResponse {
  text: string;
  functionCalls: FunctionCall[];
  citations: BrainCitation[];
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

/** Call the Sovereignty Assistant with optional contact context and document data */
export async function askAssistant(
  messages: Message[],
  contactContext?: Record<string, any>,
  documentData?: { mimeType: string; base64: string },
  model?: string,
  useBrain = false,
): Promise<AssistantResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${FUNCTIONS_URL}/vertex-ai`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, model, contactContext, documentData, useBrain }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Vertex AI request failed");
  return {
    text: data.text || "",
    functionCalls: data.functionCalls || [],
    citations: data.citations || [],
  };
}

/** Log an approved action to the sovereignty audit trail */
export async function logAuditAction(
  contactId: string,
  actionType: string,
  actionDescription: string,
  proposedData?: Record<string, any>
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await (supabase.from("sovereignty_audit_trail" as any) as any).insert({
    contact_id: contactId,
    user_id: user.id,
    action_type: actionType,
    action_description: actionDescription,
    proposed_data: proposedData || null,
  });

  if (error) throw error;
}
