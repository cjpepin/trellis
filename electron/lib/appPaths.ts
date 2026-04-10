import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export const electronE2eUserDataEnvVar = "TRELLIS_E2E_USER_DATA_DIR";

export function applyElectronTestPathOverrides(): void {
  const override = process.env[electronE2eUserDataEnvVar]?.trim();

  if (!override) {
    return;
  }

  const resolvedOverride = path.resolve(override);
  fs.mkdirSync(resolvedOverride, { recursive: true });
  app.setPath("userData", resolvedOverride);
}

export function getUserDataRoot(): string {
  return app.getPath("userData");
}
