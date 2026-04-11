import { expect, test, selectWorkspace } from "./fixtures";

test("enters preview workspace and resets it from settings", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("route-settings")).toBeVisible();
  await expect(page.getByTestId("workspace-switch-preview")).toBeVisible();
  await expect(page.getByTestId("reset-preview-workspace")).toBeVisible();

  await page.getByTestId("reset-preview-workspace").click();

  await expect(page.getByTestId("route-settings")).toBeVisible();
  await expect(page.getByTestId("reset-preview-workspace")).toBeVisible();
  await expect(page.getByText("Workspace mode")).toBeVisible();
});

test("renames a notes folder and can cancel a follow-up edit", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByTestId("route-notes")).toBeVisible();

  const originalFolderPath = "writing";
  const renamedFolderPath = "writing-renamed";
  const originalRow = page.getByTestId(`wiki-folder-row-${originalFolderPath}`);

  await originalRow.hover();
  await page.getByTestId(`wiki-folder-rename-${originalFolderPath}`).click();

  const renameInput = page.getByLabel("Rename folder");
  await expect(renameInput).toHaveValue("writing");
  await renameInput.fill("writing-renamed");
  await page.getByLabel("Save folder name").click();

  const renamedRow = page.getByTestId(`wiki-folder-row-${renamedFolderPath}`);
  await expect(renamedRow).toBeVisible();
  await expect(page.getByText("Folder renamed")).toBeVisible();

  await renamedRow.hover();
  await page.getByTestId(`wiki-folder-rename-${renamedFolderPath}`).click();
  await expect(renameInput).toHaveValue("writing-renamed");
  await renameInput.fill("writing-should-cancel");
  await page.getByLabel("Cancel rename").click();

  await expect(page.getByTestId(`wiki-folder-row-${renamedFolderPath}`)).toBeVisible();
  await expect(renameInput).toHaveCount(0);
});

test("keeps a newly created note selected after the first autosave", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByTestId("route-notes")).toBeVisible();

  const noteTitle = "Autosave Stability Note";
  const noteSlug = "autosave-stability-note";
  const draftText = "This line should not bounce back to the previous note.";

  await page.getByRole("button", { name: "New note" }).click();
  const titleInput = page.getByLabel("Note title");
  await expect(titleInput).toBeFocused();
  await titleInput.fill(noteTitle);
  await titleInput.press("Enter");

  await expect(page).toHaveURL(new RegExp(`#\\/notes\\?note=${noteSlug}`));
  await expect(
    page.getByRole("article").getByRole("button", { name: noteTitle })
  ).toBeVisible();

  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(draftText);
  await expect(editor).toContainText(draftText);

  await page.waitForTimeout(900);

  await expect(page).toHaveURL(new RegExp(`#\\/notes\\?note=${noteSlug}`));
  await expect(
    page.getByRole("article").getByRole("button", { name: noteTitle })
  ).toBeVisible();
  await expect(editor).toContainText(draftText);
});

test("notes editor persists tables, local link previews, and pasted images", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByTestId("route-notes")).toBeVisible();

  const noteTitle = "Editor Revamp Smoke";
  const noteSlug = "editor-revamp-smoke";

  await page.getByRole("button", { name: "New note" }).click();
  const titleInput = page.getByLabel("Note title");
  await expect(titleInput).toBeFocused();
  await titleInput.fill(noteTitle);
  await titleInput.press("Enter");

  await expect(page).toHaveURL(new RegExp(`#\\/notes\\?note=${noteSlug}`));

  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("https://example.com/research");
  await page.keyboard.press("Enter");

  await page.getByLabel("Insert table").click();
  await expect(editor.locator("table")).toBeVisible();
  await page.getByLabel("Add row after").click();
  await expect(editor.locator("table tr")).toHaveCount(4);

  await editor.evaluate((node) => {
    const target = node as HTMLElement;
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", {
        type: "image/png"
      })
    );
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true
      })
    );
  });

  await expect(editor.locator("img")).toHaveCount(1);
  await page.waitForTimeout(900);

  const saved = await page.evaluate((slug) => window.trellis.vault.readNote(slug), noteSlug);
  expect(saved.content).toContain("https://example.com/research");
  expect(saved.content).toContain("<table");
  expect(saved.content).toMatch(/src="\.\.\/\.trellis-note-assets\/note-/);
  expect(saved.content).toContain('alt="diagram"');

  await page.reload();
  const workspaceChooserVisible = await page
    .getByTestId("workspace-chooser")
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (workspaceChooserVisible) {
    await selectWorkspace(page, "preview");
  } else {
    await expect(page.getByTestId("app-frame")).toBeVisible();
  }

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByText("example.com")).toBeVisible();
});
