import fs from "node:fs";
import path from "node:path";
import { dismissLocalNoteProcessorFirstRun, expect, test, selectWorkspace } from "./fixtures";

test("switches workspace modes and shows logged-out chat fallback", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("route-settings")).toBeVisible();
  await expect(page.getByTestId("reset-preview-workspace")).toBeVisible();

  await page.getByTestId("workspace-switch-personal").click();
  await dismissLocalNoteProcessorFirstRun(page);
  await expect(page.getByTestId("route-settings")).toBeVisible();
  await expect(page.getByTestId("reset-preview-workspace")).toHaveCount(0);

  await dismissLocalNoteProcessorFirstRun(page);
  await page.getByTestId("workspace-switch-preview").click();
  await dismissLocalNoteProcessorFirstRun(page);
  await expect(page.getByTestId("reset-preview-workspace")).toBeVisible();

  await page.getByTestId("sidebar-nav-chat").click();
  await expect(page.getByTestId("route-chat")).toBeVisible();
  await expect(page.getByTestId("chat-auth-banner")).toBeVisible();
});

test("imports from and exports to an Obsidian vault from settings", async ({
  app,
  page,
  userDataDir
}) => {
  const obsidianImportPath = path.join(userDataDir, "obsidian-import");
  const obsidianExportPath = path.join(userDataDir, "obsidian-export");

  fs.mkdirSync(obsidianImportPath, { recursive: true });
  fs.mkdirSync(obsidianExportPath, { recursive: true });
  fs.writeFileSync(
    path.join(obsidianImportPath, "Daily Plan.md"),
    "# Daily Plan\n\nImported from Obsidian.\n",
    "utf8"
  );

  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("settings-obsidian-bridge")).toBeVisible();
  await expect(page.getByTestId("settings-obsidian-import")).toBeVisible();
  await expect(page.getByTestId("settings-obsidian-export")).toBeVisible();

  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath]
    });
  }, obsidianImportPath);

  await page.getByTestId("settings-obsidian-import").click();
  await expect(page.getByText("Imported 1 Obsidian notes into Preview Vault.")).toBeVisible();

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByTestId("route-notes")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Plan" }).first()).toBeVisible();

  await page.getByTestId("sidebar-nav-settings").click();
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedPath]
    });
  }, obsidianExportPath);

  await page.getByTestId("settings-obsidian-export").click();
  await expect(page.getByText("Exported 43 Trellis notes for Obsidian.")).toBeVisible();

  expect(
    fs.existsSync(
      path.join(
        obsidianExportPath,
        "Trellis",
        "Preview Vault",
        "imports",
        "obsidian-obsidian-import",
        "daily-plan.md"
      )
    )
  ).toBeTruthy();
});
