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
