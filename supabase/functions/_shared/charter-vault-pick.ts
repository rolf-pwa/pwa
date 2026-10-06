// Pure selection rules for finding a household's Charter among its Vault files (no Deno or Drive imports,
// so they can be unit-tested). The Drive/Gemini calls live in charter-vault.ts.

export interface DriveItem { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string }

const FOLDER = "application/vnd.google-apps.folder";

export interface CharterFile { id: string; name: string; mimeType: string; modifiedTime: string | null; ratified: boolean; viaSubfolder: boolean }

/** A file name that marks the document as not final. */
export const looksUnratified = (name: string) => /\b(draft|unsigned|working|v0|template)\b/i.test(name);

const newest = (files: DriveItem[]) =>
  [...files].sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""))[0];

/**
 * Picks the Charter from the contents of the Correspondence folder. A "Charter" subfolder wins (its newest
 * non-draft PDF/doc); otherwise the newest top-level file with "charter" in its name.
 */
export function pickCharterFile(
  correspondence: DriveItem[],
  subfolderContents: DriveItem[] | null,
): CharterFile | null {
  const usable = (f: DriveItem) => f.mimeType !== FOLDER;
  const toCharter = (f: DriveItem, viaSubfolder: boolean): CharterFile => ({
    id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime ?? null,
    ratified: !looksUnratified(f.name), viaSubfolder,
  });
  if (subfolderContents) {
    const files = subfolderContents.filter(usable);
    const finals = files.filter((f) => !looksUnratified(f.name));
    const pick = newest(finals.length ? finals : files);
    if (pick) return toCharter(pick, true);
  }
  const loose = correspondence.filter((f) => usable(f) && /charter/i.test(f.name));
  const finals = loose.filter((f) => !looksUnratified(f.name));
  const pick = newest(finals.length ? finals : loose);
  return pick ? toCharter(pick, false) : null;
}

export const findCharterSubfolder = (correspondence: DriveItem[]) =>
  correspondence.find((f) => f.mimeType === FOLDER && /^\s*charter\s*$/i.test(f.name)) ?? correspondence.find((f) => f.mimeType === FOLDER && /charter/i.test(f.name)) ?? null;

