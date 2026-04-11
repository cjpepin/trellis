import fs from "node:fs";
import path from "node:path";
import { dismissLocalNoteProcessorFirstRun, expect, test, selectWorkspace } from "./fixtures";

const templateReviewDraft = [
  "# Daily Reflection",
  "",
  "## Mood",
  "- How did you feel overall today?",
  "",
  "## Energy",
  "- What was your energy level?"
].join("\n");

test("reviews proposed template note actions from chat", async ({ page }) => {
  await selectWorkspace(page, "preview");

  const seeded = await page.evaluate(async (commonDraft: string) => {
    const settings = await window.trellis.app.getSettings();
    const vault = settings.vaults[0];

    if (!vault) {
      throw new Error("Missing preview vault.");
    }

    const session = await window.trellis.db.createSession({
      model: "gpt-4.1-mini",
      vaultId: vault.id
    });
    const draftedMessageId = crypto.randomUUID();
    const saveRequestId = crypto.randomUUID();
    const now = Date.now();
    const rejectedSlug = `daily-reflection-rejected-${now}`;
    const approvedSlug = `daily-reflection-approved-${now}`;
    await window.trellis.db.replaceMessages({
      sessionId: session.id,
      messages: [
        {
          id: draftedMessageId,
          sessionId: session.id,
          role: "assistant",
          content: commonDraft,
          createdAt: now,
          tokens: null
        },
        {
          id: saveRequestId,
          sessionId: session.id,
          role: "user",
          content: "Save those as reusable templates.",
          createdAt: now + 1,
          tokens: null
        },
        {
          id: crypto.randomUUID(),
          sessionId: session.id,
          role: "assistant",
          content: "I prepared two template changes for review.",
          createdAt: now + 2,
          tokens: null,
          noteActions: [
            {
              id: crypto.randomUUID(),
              kind: "create_template",
              status: "pending",
              targetTitle: "Daily Reflection Rejected",
              targetSlug: rejectedSlug,
              targetFolderPath: "templates",
              beforeMarkdown: "",
              afterMarkdown: commonDraft,
              frontmatter: {
                tags: ["template"],
                type: "concept",
                sources: 0
              },
              rationale: "Save the rejected template draft.",
              sourceMessageIds: [draftedMessageId, saveRequestId],
              createdAt: now + 2
            },
            {
              id: crypto.randomUUID(),
              kind: "create_template",
              status: "pending",
              targetTitle: "Daily Reflection Approved",
              targetSlug: approvedSlug,
              targetFolderPath: "templates",
              beforeMarkdown: "",
              afterMarkdown: commonDraft,
              frontmatter: {
                tags: ["template"],
                type: "concept",
                sources: 0
              },
              rationale: "Save the approved template draft.",
              sourceMessageIds: [draftedMessageId, saveRequestId],
              createdAt: now + 2
            }
          ]
        }
      ]
    });

    return {
      approvedPath: `${vault.path}/wiki/templates/${approvedSlug}.md`,
      rejectedPath: `${vault.path}/wiki/templates/${rejectedSlug}.md`
    };
  }, templateReviewDraft);

  await page.reload();
  await expect(page.getByTestId("app-frame")).toBeVisible();
  await dismissLocalNoteProcessorFirstRun(page);

  const cards = page.getByTestId("note-action-review-card");
  await expect(cards).toHaveCount(2);

  await cards.nth(0).getByRole("button", { name: "Reject" }).click();
  await expect(cards.nth(0).getByText("rejected", { exact: true })).toBeVisible();

  const editedDraft = `${templateReviewDraft}\n\n## E2E edit\n- Edited in the review card before approve.`;
  await cards.nth(1).getByTestId("note-action-draft-editor").fill(editedDraft);
  await cards.nth(1).getByRole("button", { name: "Approve" }).click();
  await expect(cards.nth(1).getByText("approved", { exact: true })).toBeVisible();

  expect(fs.existsSync(seeded.rejectedPath)).toBeFalsy();
  expect(fs.existsSync(seeded.approvedPath)).toBeTruthy();
  expect(path.basename(seeded.approvedPath)).toMatch(/daily-reflection-approved/);
  expect(fs.readFileSync(seeded.approvedPath, "utf8")).toContain("## E2E edit");
});
