import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "Peters" → "Peters Family"; a name already ending in "Family" (e.g. "The Smith Family") is left alone. */
export function familyTitle(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "Family";
  return /\bfamily$/i.test(n) ? n : `${n} Family`;
}
