import { BrowserWindow, dialog, ipcMain } from "electron";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ipcChannels,
  isAppPreviewWorkspace,
  type AppWorkspaceId,
  type MediaImageGenerateInput,
  type MediaSpeechInput,
  type MediaTranscribeInput
} from "./types";
import {
  readMediaCacheDataUrl,
  writeMediaCacheFile,
  writeMediaCacheFromBase64
} from "../lib/chatMediaCache";
import { getProviderKey } from "../lib/providerKeys";

function getFunctionsBaseUrl(): string {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();

  if (!supabaseUrl) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return `${supabaseUrl}/functions/v1`;
}

function getPublishableKey(): string {
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!publishableKey) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return publishableKey;
}

async function readFunctionError(response: Response, fallbackMessage: string): Promise<Error> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
    };

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

const mediaTranscribeSchema = z.object({
  accessToken: z.string().min(1),
  subscriptionTier: z.enum(["trial", "byok", "pro"]),
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1).max(120)
});

const mediaSpeechSchema = z.object({
  accessToken: z.string().min(1),
  subscriptionTier: z.enum(["trial", "byok", "pro"]),
  text: z.string().min(1).max(500_000)
});

const mediaImageSchema = z.object({
  accessToken: z.string().min(1),
  subscriptionTier: z.enum(["trial", "byok", "pro"]),
  prompt: z.string().min(1).max(4000)
});

const cacheWriteSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1).max(120)
});

function buildMediaHeaders(
  input: { accessToken: string; subscriptionTier: "trial" | "byok" | "pro" },
  workspaceId: AppWorkspaceId
): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    apikey: getPublishableKey(),
    Authorization: `Bearer ${input.accessToken}`
  };

  if (input.subscriptionTier === "byok") {
    const openAiKey = getProviderKey(workspaceId, "openai");

    if (!openAiKey) {
      throw new Error(
        "Add your OpenAI API key in Settings to use voice and image features on the BYOK plan."
      );
    }

    headers["x-trellis-billing-mode"] = "byok";
    headers["x-trellis-provider"] = "openai";
    headers["x-trellis-provider-key"] = openAiKey;
  }

  if (isAppPreviewWorkspace(workspaceId)) {
    headers["x-trellis-preview-workspace"] = "1";
  }

  return headers;
}

export function registerMediaIpc(options: { getWorkspaceId: () => AppWorkspaceId }): void {
  ipcMain.handle(ipcChannels.mediaCacheWrite, async (_event, input: unknown) => {
    const parsed = cacheWriteSchema.parse(input);
    return writeMediaCacheFromBase64(parsed.base64, parsed.mimeType, "image");
  });

  ipcMain.handle(ipcChannels.mediaCacheReadDataUrl, async (_event, fileId: unknown) => {
    if (typeof fileId !== "string" || fileId.length < 32) {
      return null;
    }

    return readMediaCacheDataUrl(fileId);
  });

  ipcMain.handle(ipcChannels.mediaPickImage, async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ["openFile" as const],
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        { name: "All files", extensions: ["*"] }
      ]
    };
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const filePath = result.filePaths[0];
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif"
    };
    const mimeType = mimeMap[ext] ?? "image/png";
    const buf = await fs.readFile(filePath);
    const { fileId } = await writeMediaCacheFile(buf, mimeType, "image");
    return { fileId, name, mimeType };
  });

  ipcMain.handle(ipcChannels.mediaTranscribe, async (_event, input: unknown) => {
    const parsed = mediaTranscribeSchema.parse(input) as MediaTranscribeInput;
    const headers = buildMediaHeaders(parsed, options.getWorkspaceId());

    const response = await fetch(`${getFunctionsBaseUrl()}/chat-media`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "transcribe",
        audioBase64: parsed.audioBase64,
        mimeType: parsed.mimeType
      })
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Transcription failed.");
    }

    const payload = (await response.json()) as { text?: string };

    if (typeof payload.text !== "string") {
      throw new Error("Transcription returned no text.");
    }

    return { text: payload.text };
  });

  ipcMain.handle(ipcChannels.mediaSynthesizeSpeechStream, async (event, input: unknown) => {
    const parsed = mediaSpeechSchema.parse(input) as MediaSpeechInput;
    const headers = buildMediaHeaders(parsed, options.getWorkspaceId());

    const response = await fetch(`${getFunctionsBaseUrl()}/chat-media`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "tts",
        text: parsed.text,
        stream: true
      })
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Speech synthesis failed.");
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Speech synthesis returned no stream.");
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value.length > 0) {
          event.sender.send(ipcChannels.mediaSpeechStreamChunk, value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  });

  ipcMain.handle(ipcChannels.mediaSynthesizeSpeech, async (_event, input: unknown) => {
    const parsed = mediaSpeechSchema.parse(input) as MediaSpeechInput;
    const headers = buildMediaHeaders(parsed, options.getWorkspaceId());

    const response = await fetch(`${getFunctionsBaseUrl()}/chat-media`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "tts",
        text: parsed.text
      })
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Speech synthesis failed.");
    }

    const payload = (await response.json()) as { audioBase64?: string; mimeType?: string };

    if (typeof payload.audioBase64 !== "string" || typeof payload.mimeType !== "string") {
      throw new Error("Speech synthesis returned no audio.");
    }

    return {
      audioBase64: payload.audioBase64,
      mimeType: payload.mimeType
    };
  });

  ipcMain.handle(ipcChannels.mediaGenerateImage, async (_event, input: unknown) => {
    const parsed = mediaImageSchema.parse(input) as MediaImageGenerateInput;
    const headers = buildMediaHeaders(parsed, options.getWorkspaceId());

    const response = await fetch(`${getFunctionsBaseUrl()}/chat-media`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "image_generate",
        prompt: parsed.prompt
      })
    });

    if (!response.ok) {
      throw await readFunctionError(response, "Image generation failed.");
    }

    const payload = (await response.json()) as {
      imageBase64?: string;
      revisedPrompt?: string;
    };

    if (typeof payload.imageBase64 !== "string") {
      throw new Error("Image generation returned no image.");
    }

    return {
      imageBase64: payload.imageBase64,
      revisedPrompt:
        typeof payload.revisedPrompt === "string" ? payload.revisedPrompt : undefined
    };
  });
}
