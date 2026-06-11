import type {
  ChatContextReference,
  ChatModel,
  ChatStreamPayloadMessage,
  MessageRecord,
  SubscriptionTier
} from "@trellis/contracts";
import { formatTrialQuotaChatError } from "@trellis/shared/billing/trialMessageWindow";
import { resolveChatMediaDataUrl } from "@/lib/chat/resolveChatMediaDataUrl";
import { getChatModelOption } from "@/lib/chatModels";
import { hasSupabaseConfig } from "@/lib/supabase";

const functionsBaseUrl = `${import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""}/functions/v1`;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

type ChatNoteReference = ChatContextReference;

type EdgeChatMessage = {
  role: "user" | "assistant";
  content: string;
  imageParts?: Array<{ mimeType: string; dataBase64: string }>;
};

async function blobToBase64FromDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read image data."));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

export async function enrichWebChatMessagesForEdge(
  payload: ChatStreamPayloadMessage[],
  messageRecords: MessageRecord[]
): Promise<EdgeChatMessage[]> {
  if (payload.length !== messageRecords.length) {
    throw new Error("Could not align chat messages for cloud streaming.");
  }

  const out: EdgeChatMessage[] = [];

  for (let i = 0; i < payload.length; i++) {
    const p = payload[i];
    const rec = messageRecords[i];

    if (!p || !rec || p.role !== rec.role) {
      throw new Error("Could not align chat messages for cloud streaming.");
    }

    if (p.role !== "user" || !p.imageFileIds || p.imageFileIds.length === 0) {
      out.push({ role: p.role, content: p.content });
      continue;
    }

    const imageParts: Array<{ mimeType: string; dataBase64: string }> = [];
    const arts = (rec?.mediaArtifacts ?? []).filter((a) => a.kind === "image");

    for (const fileId of p.imageFileIds) {
      const art = arts.find((a) => a.fileId === fileId);
      if (!art) {
        throw new Error(
          "Trellis could not find an attached image for this message. Remove it and attach the image again."
        );
      }

      const dataUrl = await resolveChatMediaDataUrl(art);
      if (!dataUrl) {
        throw new Error(
          "Trellis could not read an attached image for the cloud chat. Remove it and attach the image again."
        );
      }

      const response = await fetch(dataUrl);
      if (!response.ok) {
        throw new Error("Trellis could not read an attached image for the cloud chat.");
      }

      const blob = await response.blob();
      const dataBase64 = await blobToBase64FromDataUrl(blob);
      const mimeType = art.mimeType.split(";")[0]?.trim() || blob.type || "image/png";
      imageParts.push({ mimeType, dataBase64 });
    }

    out.push({ role: p.role, content: p.content, imageParts });
  }

  return out;
}

async function parseChatFunctionError(response: Response, fallbackMessage: string): Promise<Error> {
  const text = await response.text();

  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
      reset_at?: string;
    };

    if (payload.error === "subscription_expired") {
      return new Error(
        "Your subscription is no longer active. Open Settings to review plans and continue chatting."
      );
    }

    if (payload.error === "message_quota_exceeded") {
      const resetAt = typeof payload.reset_at === "string" ? payload.reset_at : null;
      return new Error(formatTrialQuotaChatError(resetAt));
    }

    if (payload.error === "trial_expired") {
      return new Error(
        "Your trial or free message allowance is no longer available. Open Settings to review plans and continue chatting."
      );
    }

    if (response.status === 401) {
      return new Error(
        "Trellis couldn't verify your cloud session. Your local notes are still safe. Sign in again from Settings to resume chatting."
      );
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

async function readSseStream(
  response: Response,
  onEvent: (type: "status" | "token" | "title" | "done", payload: string) => void
): Promise<void> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Streaming response had no body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  function readDataValue(line: string): string {
    const rawValue = line.slice(5);
    return rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map(readDataValue)
        .join("\n");

      if (event === "status" || event === "token" || event === "title" || event === "done") {
        onEvent(event, data);
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim().length > 0) {
    const lines = buffer.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map(readDataValue)
      .join("\n");

    if (
      data.length > 0 &&
      (event === "status" || event === "token" || event === "title" || event === "done")
    ) {
      onEvent(event, data);
    }
  }
}

export async function streamCloudChatOverHttp(input: {
  accessToken: string;
  subscriptionTier: SubscriptionTier;
  model: ChatModel;
  sessionId: string;
  messages: ChatStreamPayloadMessage[];
  messageRecords: MessageRecord[];
  references: ChatNoteReference[];
  previewWorkspace?: boolean;
  onToken: (token: string) => void;
  onStatus: (message: string) => void | Promise<void>;
  onTitle: (title: string) => void | Promise<void>;
}): Promise<void> {
  if (!hasSupabaseConfig() || publishableKey.length === 0) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  const messagesForEdge = await enrichWebChatMessagesForEdge(input.messages, input.messageRecords);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: publishableKey,
    Authorization: `Bearer ${input.accessToken}`
  };

  if (input.subscriptionTier === "byok") {
    headers["x-trellis-billing-mode"] = "byok";
    headers["x-trellis-provider"] = getChatModelOption(input.model).provider;
  }

  if (input.previewWorkspace) {
    headers["x-trellis-preview-workspace"] = "1";
  }

  const response = await fetch(`${functionsBaseUrl}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sessionId: input.sessionId,
      model: input.model,
      messages: messagesForEdge,
      references: input.references,
      ...(input.previewWorkspace ? { previewWorkspace: true } : {})
    })
  });

  if (!response.ok) {
    throw await parseChatFunctionError(response, "Chat request failed.");
  }

  await readSseStream(response, (type, payload) => {
    if (type === "token") {
      input.onToken(payload);
    }
    if (type === "status") {
      void input.onStatus(payload);
    }
    if (type === "title") {
      void input.onTitle(payload);
    }
  });
}
