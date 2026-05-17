import { dismissLocalNoteProcessorFirstRun, expect, test, selectWorkspace } from "./fixtures";

/**
 * Exercises guest/local-only affordances on the personal workspace.
 * Full anonymous chat + quota requires Supabase anonymous sign-ins and VITE_* in the built app.
 */
test("personal workspace shows cloud sync settings when Supabase is configured", async ({
  page
}, testInfo) => {
  await selectWorkspace(page, "personal");
  await dismissLocalNoteProcessorFirstRun(page);

  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("route-settings")).toBeVisible();

  const panel = page.getByTestId("settings-cloud-sync-panel");
  const panelVisible = await panel.isVisible().catch(() => false);

  if (!panelVisible) {
    testInfo.skip(
      true,
      "Cloud sync panel requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the build."
    );
    return;
  }

  await expect(panel).toBeVisible();

  const guestCopy = page.getByText(/Guest sessions keep Strands on this device only/i);
  if (await guestCopy.isVisible()) {
    await expect(page.getByTestId("settings-cloud-sync-checkbox")).toHaveCount(0);
    return;
  }

  const checkbox = page.getByTestId("settings-cloud-sync-checkbox");
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();

  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByText(/Cloud sync is off/i)).toBeVisible();

  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

test("sidebar shows local-only cloud hint for guest or when sync is off", async ({
  page
}, testInfo) => {
  await selectWorkspace(page, "personal");
  await dismissLocalNoteProcessorFirstRun(page);

  const banner = page.getByTestId("sidebar-cloud-local-banner");
  const bannerVisible = await banner.isVisible().catch(() => false);

  if (!bannerVisible) {
    testInfo.skip(
      true,
      "Banner requires desktop + Supabase + guest session or cloud sync disabled (see settings-cloud-sync-checkbox)."
    );
    return;
  }

  await expect(banner).toBeVisible();
  await banner.click();
  await expect(page.getByRole("dialog", { name: /Strands are not syncing/i })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
});
