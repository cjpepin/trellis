import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

type TrellisFixtures = {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
};

export const test = base.extend<TrellisFixtures>({
  userDataDir: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-e2e-"));

    try {
      await use(userDataDir);
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
  app: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [repoRoot],
      cwd: repoRoot,
      env: {
        ...process.env,
        TRELLIS_E2E_USER_DATA_DIR: userDataDir
      }
    });

    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  }
});

export { expect };

export async function dismissLocalNoteProcessorFirstRun(page: Page): Promise<void> {
  const dialog = page.getByTestId("local-note-processor-first-run");

  const dialogVisible = await dialog
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (!dialogVisible) {
    return;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cancelDownload = page.getByTestId("local-note-processor-cancel-download");
    if (await cancelDownload.isVisible().catch(() => false)) {
      await cancelDownload.click().catch(() => {});
    }

    const notNow = page.getByTestId("local-note-processor-not-now");
    if (await notNow.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await notNow.click();
      await expect(dialog).toHaveCount(0);
      return;
    }

    const remindLater = page.getByTestId("local-note-processor-remind-later");
    if (await remindLater.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await remindLater.click();
      await expect(dialog).toHaveCount(0);
      return;
    }

    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }

    await page.waitForTimeout(300);
  }
}

export async function selectWorkspace(page: Page, workspaceId: "personal" | "preview"): Promise<void> {
  await expect(page.getByTestId("workspace-chooser")).toBeVisible();
  await page.getByTestId(`workspace-option-${workspaceId}`).click();
  await expect(page.getByTestId("app-frame")).toBeVisible();
  await dismissLocalNoteProcessorFirstRun(page);
}
