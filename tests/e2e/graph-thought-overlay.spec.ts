import { expect, test, selectWorkspace } from "./fixtures";

test("Graph search surfaces a recently captured Thought as a node", async ({ page }) => {
  await selectWorkspace(page, "preview");

  const snippet = `Graph thought e2e ${Date.now()}`;
  await page.getByTestId("sidebar-nav-thoughts").click();
  await expect(page.getByTestId("route-thoughts")).toBeVisible();

  await page.getByTestId("thought-capture-input").fill(snippet);
  await page.getByTestId("thought-capture-submit").click();
  await expect(page.getByText(snippet, { exact: false })).toBeVisible({ timeout: 12_000 });

  await page.getByTestId("sidebar-nav-graph").click();
  await expect(page.getByTestId("route-graph")).toBeVisible();
  await expect(page.getByTestId("force-graph")).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search graph nodes" });
  await search.fill(snippet.slice(0, 40));

  const matchButton = page.locator("button").filter({ hasText: snippet.slice(0, 28) }).first();
  await expect(matchButton).toBeVisible({ timeout: 12_000 });
});
