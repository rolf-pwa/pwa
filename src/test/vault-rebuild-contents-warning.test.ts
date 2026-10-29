import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vaultContentsSummary, vaultHasContentsError } from "../../supabase/functions/_shared/vault-contents";

const F = "application/vnd.google-apps.folder";

describe("vault contents summary", () => {
  it("counts folders and files separately", () => {
    expect(vaultContentsSummary([{ name: "00 Shoebox", mimeType: F }, { name: "04 Insurance", mimeType: F }, { name: "a.pdf", mimeType: "application/pdf" }])).toEqual({ folders: ["00 Shoebox", "04 Insurance"], files: 1 });
  });
  it("words the error with the folder names", () => {
    expect(vaultHasContentsError({ folders: ["00 Shoebox", "04 Insurance"], files: 0 })).toBe("vault_has_contents: 2 folders (00 Shoebox, 04 Insurance)");
    expect(vaultHasContentsError({ folders: [], files: 1 })).toBe("vault_has_contents: 1 file");
  });
});

describe("forced rebuild guard wiring", () => {
  const prov = readFileSync("supabase/functions/_shared/vault-provisioning.ts", "utf8");
  const svc = readFileSync("supabase/functions/vault-service/index.ts", "utf8");
  it("checks the current Vault before a forced rebuild unless acknowledged", () => {
    expect(prov).toMatch(/opts\.force && household\.vault_root_folder_id && !opts\.acknowledgeContents/);
    expect(svc).toMatch(/force && hh\.vault_root_folder_id && acknowledgeContents !== true/);
    expect(svc).toMatch(/acknowledgeContents: acknowledgeContents === true/);
  });
  it("the Vault page confirms again with the contents, then retries acknowledged", () => {
    const ui = readFileSync("src/modules/crm/pages/Vault.tsx", "utf8");
    expect(ui).toContain("callVaultReplacing(\"provisionFamilyStructure\"");
    expect(ui).toContain("callVaultReplacing(\"provisionVault\"");
    expect(ui).toContain("acknowledgeContents: true");
  });
});
