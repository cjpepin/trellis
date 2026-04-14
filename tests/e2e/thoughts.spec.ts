import { expect, test, selectWorkspace } from "./fixtures";

test("Thoughts route: capture appears in the list", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.getByTestId("sidebar-nav-thoughts").click();
  await expect(page.getByTestId("route-thoughts")).toBeVisible();

  const snippet = `E2E thought ${Date.now()}`;
  await page.getByTestId("thought-capture-input").fill(snippet);
  await page.getByTestId("thought-capture-submit").click();

  await expect(page.getByText(snippet, { exact: false })).toBeVisible({ timeout: 8_000 });
});
