import { createContext, useContext, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { Answer, Answers, Catalyst, Domain, Pathway } from "@/modules/intake/lib/derive";

export type Step = 1 | 2 | 3 | 4 | 5 | 6; // 6 = success

export interface Contact {
  first_name: string;
  email: string;
  mobile: string;
}

export interface Georgia2State {
  step: Step;
  domain: Domain | null;
  catalyst: Catalyst | null;
  answers: Partial<Answers>;
  scale: number;
  chosenPathway: Pathway | null;
  contact: Contact;
  sessionKey: string;
  submitting: boolean;
  submitError: string | null;
}

type Action =
  | { type: "set_step"; step: Step }
  | { type: "set_domain"; domain: Domain }
  | { type: "set_catalyst"; catalyst: Catalyst }
  | { type: "set_answer"; key: string; value: Answer }
  | { type: "set_scale"; scale: number }
  | { type: "set_pathway"; pathway: Pathway }
  | { type: "set_contact"; contact: Partial<Contact> }
  | { type: "submitting"; value: boolean }
  | { type: "submit_error"; error: string | null }
  | { type: "reset" };

function newSessionKey() {
  return `g2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function initial(): Georgia2State {
  return {
    step: 1,
    domain: null,
    catalyst: null,
    answers: {},
    scale: 1_000_000,
    chosenPathway: null,
    contact: { first_name: "", email: "", mobile: "" },
    sessionKey: newSessionKey(),
    submitting: false,
    submitError: null,
  };
}

function reducer(state: Georgia2State, action: Action): Georgia2State {
  switch (action.type) {
    case "set_step":
      return { ...state, step: action.step };
    case "set_domain":
      return { ...state, domain: action.domain, catalyst: null, answers: {}, step: 2 };
    case "set_catalyst":
      return { ...state, catalyst: action.catalyst, step: 3 };
    case "set_answer":
      return { ...state, answers: { ...state.answers, [action.key]: action.value } };
    case "set_scale":
      return { ...state, scale: action.scale };
    case "set_pathway":
      // No step jump here -- pathway is now chosen from within StepResults
      // itself (step 5, after lead capture), not by transitioning to a
      // still-to-come contact form. See StepResults.tsx's pick().
      return { ...state, chosenPathway: action.pathway };
    case "set_contact":
      return { ...state, contact: { ...state.contact, ...action.contact } };
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
