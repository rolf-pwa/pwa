// Pure (no Deno, no I/O) so it can be unit-tested. Used by the forced-rebuild warning in vault-provisioning / vault-service.

/** What a household's current Vault holds, for the warning before a forced rebuild unlinks it. null = couldn't tell. */
export function vaultContentsSummary(children: { name: string; mimeType: string }[]): { folders: string[]; files: number } {
  const isFolder = (c: { mimeType: string }) => c.mimeType === "application/vnd.google-apps.folder";
  return { folders: children.filter(isFolder).map((c) => c.name), files: children.filter((c) => !isFolder(c)).length };
}

export const VAULT_HAS_CONTENTS = "vault_has_contents";

/** Error text the Vault page recognises: it lists what is in the Vault being replaced and asks again. */
export function vaultHasContentsError(s: { folders: string[]; files: number }): string {
  const parts = [s.folders.length ? `${s.folders.length} folder${s.folders.length === 1 ? "" : "s"} (${s.folders.slice(0, 8).join(", ")}${s.folders.length > 8 ? ", …" : ""})` : "", s.files ? `${s.files} file${s.files === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `${VAULT_HAS_CONTENTS}: ${parts.join(" and ")}`;
}
