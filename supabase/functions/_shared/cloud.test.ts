import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildWorkspaceGraph,
  decryptProviderCredentialSecret,
  encryptProviderCredentialSecret,
  workspaceNameToSlug
} from "./cloud.ts";

Deno.test("workspaceNameToSlug normalizes human labels", () => {
  assertEquals(workspaceNameToSlug("Work Computer Notes"), "work-computer-notes");
});

Deno.test("buildWorkspaceGraph keeps only links between existing notes", () => {
  const graph = buildWorkspaceGraph(
    [
      {
        id: "note-1",
        workspaceId: "workspace-1",
        slug: "alpha",
        title: "Alpha",
        excerpt: "",
        tags: [],
        noteType: "concept",
        folderPath: "",
        sourceCount: 0,
        url: null,
        inboundCount: 1,
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z"
      },
      {
        id: "note-2",
        workspaceId: "workspace-1",
        slug: "beta",
        title: "Beta",
        excerpt: "",
        tags: [],
        noteType: "concept",
        folderPath: "",
        sourceCount: 0,
        url: null,
        inboundCount: 0,
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z"
      }
    ],
    [
      { sourceNoteId: "note-1", targetSlug: "beta" },
      { sourceNoteId: "note-1", targetSlug: "missing-note" }
    ]
  );

  assertEquals(graph.edges, [{ source: "alpha", target: "beta" }]);
});

Deno.test("provider credential helpers round-trip secrets", async () => {
  const secretMaterial = btoa("0123456789abcdef0123456789abcdef");
  Deno.env.set("TRELLIS_PROVIDER_CREDENTIALS_SECRET", secretMaterial);

  const encrypted = await encryptProviderCredentialSecret("sk-test-1234567890");
  const decrypted = await decryptProviderCredentialSecret({
    encryptedSecret: encrypted.encryptedSecret,
    secretNonce: encrypted.secretNonce
  });

  assertEquals(decrypted, "sk-test-1234567890");
  assertEquals(encrypted.lastFour, "7890");
});
