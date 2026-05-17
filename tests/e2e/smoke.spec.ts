import { expect, test, selectWorkspace } from "./fixtures";

test("boots and navigates the core routes", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await expect(page.getByTestId("app-frame")).not.toHaveAttribute(
    "data-workspace-data-pending",
    "true"
  );

  await expect(page.getByTestId("route-chat")).toBeVisible();

  await page.getByTestId("sidebar-nav-notes").click();
  await expect(page.getByTestId("route-notes")).toBeVisible();

  await page.getByTestId("sidebar-nav-thoughts").click();
  await expect(page.getByTestId("route-thoughts")).toBeVisible();

  await page.getByTestId("sidebar-nav-graph").click();
  await expect(page.getByTestId("route-graph")).toBeVisible();

  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page.getByTestId("route-settings")).toBeVisible();
});
