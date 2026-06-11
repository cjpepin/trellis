import { expect, test, selectWorkspace } from "./fixtures";

test("Strand preview renders https markdown links", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByTestId("route-notes")).toBeVisible();

  const noteTitle = "Https Markdown E2E";
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note title").fill(noteTitle);
  await page.getByLabel("Note title").press("Enter");

  await expect(page.getByRole("article").getByRole("button", { name: noteTitle })).toBeVisible();

  await page
    .getByTestId("note-editor-view-mode")
    .getByRole("button", { name: /Markdown — source/i })
    .click();

  const md = page.getByRole("textbox", { name: "Note content" });
  await expect(md).toBeVisible();
  await md.fill(`# ${noteTitle}\n\nSee [Example](https://example.com/trellis-e2e).`);

  await page
    .getByTestId("note-editor-view-mode")
    .getByRole("button", { name: /Preview — rich text/i })
    .click();

  const link = page.locator('.trellis-document-content a[href="https://example.com/trellis-e2e"]');
  await expect(link).toBeVisible({ timeout: 12_000 });
  await expect(link).toHaveText("Example");
});
