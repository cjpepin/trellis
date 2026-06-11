import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dismissLocalNoteProcessorFirstRun, expect, test, selectWorkspace } from "./fixtures";

function commandPaletteShortcut(mod: "Meta" | "Control"): string {
  return `${mod}+k`;
}

test("switches workspace modes and shows logged-out chat fallback", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("route-settings")).toBeVisible();

  const mod = os.platform() === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(commandPaletteShortcut(mod));
  await page.getByPlaceholder(/Search Strands/i).waitFor({ state: "visible" });
  await page.getByText("Switch to Personal workspace").click();
  await dismissLocalNoteProcessorFirstRun(page);
  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("settings-workspace-mode")).toHaveCount(0);

  await page.keyboard.press(commandPaletteShortcut(mod));
  await page.getByText("Switch to Preview workspace").click();
  await dismissLocalNoteProcessorFirstRun(page);

  await page.getByTestId("sidebar-nav-chat").click();
  await expect(page.getByTestId("route-chat")).toBeVisible();
  const composer = page.getByPlaceholder("What are you thinking about?");
  const authBanner = page.getByTestId("chat-auth-banner");
  // Guest auto sign-in (Supabase anonymous) enables chat without the banner; without Supabase the banner stays up.
  if (await authBanner.isVisible()) {
    await expect(composer).toBeDisabled();
  } else {
    await expect(composer).toBeEnabled();
  }
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
