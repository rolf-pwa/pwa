import { createContext, useContext, useMemo, useReducer, useRef, type ReactNode } from "react";
import { domainForCatalyst, type Answer, type Answers, type Catalyst, type Domain, type Pathway } from "@/modules/intake/lib/derive";

export type Step = 1 | 2 | 3 | 4 | 5; // 1 transition, 2 questions (+ free text), 3 gate, 4 results, 5 safety screen

export interface Contact {
  first_name: string;
  email: string;
  mobile: string;
}

/** What georgia2-analyze reported about the optional free-text answer. */
export interface FreeformResult {
  /** The exact text that was analyzed, so an unchanged resubmission is not re-sent. */
  text: string;
  threat_detected: boolean;
  threat_source?: "keywords" | "model" | "verifier" | null;
  emotional_state?: string | null;
  primary_friction?: string | null;
}

export interface Georgia2State {
  step: Step;
  // Which question of the diagnostic step (2) is showing, one per screen.
  questionIndex: number;
  domain: Domain | null;
  catalyst: Catalyst | null;
  answers: Partial<Answers>;
  chosenPathway: Pathway | null;
  contact: Contact;
  sessionKey: string;
  // The brief "Georgia is analyzing" beat before the gate has played once.
  analyzed: boolean;
  submitting: boolean;
  submitError: string | null;
  freeformText: string;
  freeformResult: FreeformResult | null;
  /** The acknowledgment paragraph returned when the lead was created. */
  validationText: string | null;
}

type Action =
  | { type: "set_step"; step: Step }
  | { type: "set_question_index"; index: number }
  | { type: "set_catalyst"; catalyst: Catalyst }
  | { type: "set_answer"; key: string; value: Answer }
  | { type: "set_pathway"; pathway: Pathway }
  | { type: "set_contact"; contact: Partial<Contact> }
  | { type: "analyzed" }
  | { type: "set_freeform_text"; text: string }
  | { type: "set_freeform_result"; result: FreeformResult | null }
  | { type: "set_validation"; text: string | null }
  | { type: "submitting"; value: boolean }
  | { type: "submit_error"; error: string | null }
  | { type: "reset" };

function newSessionKey() {
  return `g2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function initial(): Georgia2State {
  return {
    step: 1,
    questionIndex: 0,
    domain: null,
    catalyst: null,
    answers: {},
    chosenPathway: null,
    contact: { first_name: "", email: "", mobile: "" },
    sessionKey: newSessionKey(),
    analyzed: false,
    submitting: false,
    submitError: null,
    freeformText: "",
    freeformResult: null,
    validationText: null,
  };
}

function reducer(state: Georgia2State, action: Action): Georgia2State {
  switch (action.type) {
    case "set_step":
      return { ...state, step: action.step };
    case "set_question_index":
      return { ...state, questionIndex: action.index };
    case "set_catalyst":
      return {
        ...state,
        catalyst: action.catalyst,
        domain: domainForCatalyst(action.catalyst),
        answers: {},
        questionIndex: 0,
        analyzed: false,
        freeformText: "",
        freeformResult: null,
        step: 2,
      };
    case "set_answer":
      return { ...state, answers: { ...state.answers, [action.key]: action.value } };
    case "set_pathway":
      return { ...state, chosenPathway: action.pathway };
    case "set_contact":
      return { ...state, contact: { ...state.contact, ...action.contact } };
    case "set_freeform_text":
      return { ...state, freeformText: action.text };
    case "set_freeform_result":
      return { ...state, freeformResult: action.result };
    case "set_validation":
      return { ...state, validationText: action.text };
    case "analyzed":
      return { ...state, analyzed: true };
    case "submitting":
      return { ...state, submitting: action.value };
    case "submit_error":
      return { ...state, submitError: action.error };
    case "reset":
      return initial();
    default:
      return state;
  }
}

const Ctx = createContext<{
  state: Georgia2State;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function Georgia2Provider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const ref = useRef({ state, dispatch });
  ref.current = { state, dispatch };
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGeorgia2() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGeorgia2 must be used inside Georgia2Provider");
  return ctx;
}
