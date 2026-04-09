import { validateExtractionResponse } from "@shared/extraction/validate";
import type {
  ExtractionCloudConfig,
  ExtractionProviderStatus,
  ExtractionRunResult
} from "../../../ipc/types";
import { ExtractionValidationError } from "../debug";
import type { ExtractionProvider, ProviderExtractInput } from "./types";

interface EdgeFunctionErrorPayload {
  code?: string;
  error?: string;
  message?: string;
}

function ensureCloudConfig(cloud: ExtractionCloudConfig | undefined): ExtractionCloudConfig {
  if (!cloud?.functionsBaseUrl || !cloud.publishableKey) {
    throw new Error("Cloud note processing is not configured for this build.");
  }

  if (!cloud.accessToken) {
    throw new Error("Sign in to process notes in the cloud.");
  }

  return cloud;
}

async function readProviderError(response: Response, fallbackMessage: string): Promise<Error> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as EdgeFunctionErrorPayload;

    if (payload.error === "trial_expired") {
      return new Error("Your free trial has ended. Upgrade in Settings to continue.");
    }

    if (response.status === 401) {
      return new Error(
        "Trellis couldn't verify your cloud session. Your local notes are still safe. Sign in again from Settings to resume chatting."
      );
    }

    if (response.status === 404 || payload.code === "NOT_FOUND") {
      return new Error("This cloud feature is not available for this build yet.");
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return new Error(payload.error);
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return new Error(payload.message);
    }
  } catch {
    if (text.length > 0) {
      return new Error(text);
    }
  }

  return new Error(fallbackMessage);
}

async function runCloudExtraction(input: ProviderExtractInput): Promise<ExtractionRunResult> {
  const cloud = ensureCloudConfig(input.cloud);
  const response = await fetch(`${cloud.functionsBaseUrl}/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cloud.publishableKey,
      Authorization: `Bearer ${cloud.accessToken}`
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      transcript: input.transcript,
      index: input.index,
      relatedNotes: input.relatedNotes ?? [],
      sourceType: input.sourceType,
      sourceTitle: input.sourceTitle,
      sourcePath: input.sourcePath,
      sourceContent: input.sourceContent
    })
  });

  if (!response.ok) {
    throw await readProviderError(response, "Note processing request failed.");
  }

  const payload = await response.json();
  const { value, issues } = validateExtractionResponse(payload, {
    index: input.index,
    sourceType: input.sourceType,
    sourcePath: input.sourcePath
  });

  if (!value) {
    throw new ExtractionValidationError(
      issues[0]?.message ?? "Cloud note processing returned an invalid response.",
      issues.map((issue) => `${issue.path}: ${issue.message}`)
    );
  }

  return {
    response: value,
    provider: "cloud",
    model: "cloud"
  };
}

export const cloudExtractionProvider: ExtractionProvider = {
  id: "cloud",
  async getStatus(input: { cloud?: ExtractionCloudConfig }): Promise<ExtractionProviderStatus> {
    if (!input.cloud?.functionsBaseUrl || !input.cloud.publishableKey) {
      return {
        id: "cloud",
        label: "Cloud",
        available: false,
        reason: "Cloud note processing is not configured for this build."
      };
    }

    if (!input.cloud.accessToken) {
      return {
        id: "cloud",
        label: "Cloud",
        available: false,
        reason: "Sign in to process notes in the cloud."
      };
    }

    return {
      id: "cloud",
      label: "Cloud",
      available: true
    };
  },
  extract: runCloudExtraction
};
