import type { ChatModel, MessageRecord, NoteSummary } from "@electron/ipc/types";
import { getSupabase, hasSupabaseConfig } from "./supabase";

export interface ExtractionIndexEntry {
  slug: string;
  title: string;
  tags: string[];
  isPlaceholder?: boolean;
}

export interface ExtractionUpdate {
  file: string;
  action: "create" | "update" | "append";
  title: string;
  content: string;
  tags: string[];
  type: "concept" | "entity" | "source-summary" | "synthesis";
  linkedTo: string[];
  sources?: number;
  url?: string;
}

export interface ExtractionResponse {
  updates: ExtractionUpdate[];
  sessionTitle: string;
}

export interface IngestProgress {
  step: "reading" | "extracting" | "updating" | "done" | "error";
  message: string;
}

export interface ChatNoteReference {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
}

interface StreamChatInput {
  accessToken: string;
  model: ChatModel;
  sessionId: string;
  messages: Array<Pick<MessageRecord, "role" | "content">>;
  references?: ChatNoteReference[];
  onToken: (token: string) => void;
  onStatus: (message: string) => void | Promise<void>;
  onTitle: (title: string) => void | Promise<void>;
}

interface ExtractInput {
  accessToken: string;
  transcript: Array<Pick<MessageRecord, "role" | "content">>;
  sessionId?: string;
  index: ExtractionIndexEntry[];
}

interface IngestExtractInput extends ExtractInput {
  sourceType: "pdf" | "web" | "text";
  sourceTitle: string;
  sourcePath: string;
  sourceContent: string;
  onProgress: (event: IngestProgress) => void;
}

interface EdgeFunctionErrorPayload {
  code?: string;
  error?: string;
  message?: string;
}

function getFunctionsBaseUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return `${supabaseUrl}/functions/v1`;
}

function getFunctionHeaders(accessToken: string): HeadersInit {
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!publishableKey) {
    throw new Error("Cloud features are not configured for this build yet.");
  }

  return {
    "Content-Type": "application/json",
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken}`
  };
}

async function resolveAccessToken(fallbackToken: string): Promise<string> {
  if (!hasSupabaseConfig()) {
    return fallbackToken;
  }

  try {
    const supabase = getSupabase();
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return fallbackToken;
    }

    const expiresAtMs =
      typeof session.expires_at === "number" ? session.expires_at * 1000 : null;
    const bufferMs = 120_000;

    if (expiresAtMs !== null && Date.now() >= expiresAtMs - bufferMs) {
      const { data, error } = await supabase.auth.refreshSession();

      if (!error && data.session?.access_token) {
        return data.session.access_token;
      }
    }

    return session.access_token;
  } catch {
    return fallbackToken;
  }
}

async function readSseStream(
  response: Response,
  handlers: {
    onEvent: (type: string, payload: string) => void | Promise<void>;
  }
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

      await handlers.onEvent(event, data);
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

    if (data.length > 0) {
      await handlers.onEvent(event, data);
    }
  }
}

async function readErrorResponse(response: Response, fallbackMessage: string): Promise<Error> {
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

export async function streamChat(input: StreamChatInput): Promise<void> {
  const accessToken = await resolveAccessToken(input.accessToken);
  const response = await fetch(`${getFunctionsBaseUrl()}/chat`, {
    method: "POST",
    headers: getFunctionHeaders(accessToken),
    body: JSON.stringify({
      sessionId: input.sessionId,
      model: input.model,
      messages: input.messages,
      references: input.references ?? []
    })
  });

  if (!response.ok) {
    throw await readErrorResponse(response, "Chat request failed.");
  }

  await readSseStream(response, {
    onEvent: (type, payload) => {
      if (type === "token") {
        input.onToken(payload);
      } else if (type === "status") {
        input.onStatus(payload);
      } else if (type === "title") {
        input.onTitle(payload);
      } else if (type === "error") {
        throw new Error(payload);
      }
    }
  });
}

export async function extractTranscript(input: ExtractInput): Promise<ExtractionResponse> {
  const accessToken = await resolveAccessToken(input.accessToken);
  const response = await fetch(`${getFunctionsBaseUrl()}/extract`, {
    method: "POST",
    headers: getFunctionHeaders(accessToken),
    body: JSON.stringify({
      transcript: input.transcript,
      sessionId: input.sessionId,
      index: input.index
    })
  });

  if (!response.ok) {
    throw await readErrorResponse(response, "Extraction request failed.");
  }

  return (await response.json()) as ExtractionResponse;
}

export async function extractIngestedSource(
  input: IngestExtractInput
): Promise<ExtractionResponse> {
  const accessToken = await resolveAccessToken(input.accessToken);
  const response = await fetch(`${getFunctionsBaseUrl()}/extract`, {
    method: "POST",
    headers: getFunctionHeaders(accessToken),
    body: JSON.stringify({
      stream: true,
      index: input.index,
      sourceType: input.sourceType,
      sourceTitle: input.sourceTitle,
      sourcePath: input.sourcePath,
      sourceContent: input.sourceContent,
      transcript: [
        {
          role: "user",
          content: input.sourceContent
        }
      ]
    })
  });

  if (!response.ok) {
    throw await readErrorResponse(response, "Ingest extraction failed.");
  }

  let finalPayload: ExtractionResponse | null = null;

  await readSseStream(response, {
    onEvent: (type, payload) => {
      if (type === "status") {
        input.onProgress(JSON.parse(payload) as IngestProgress);
      } else if (type === "done") {
        finalPayload = JSON.parse(payload) as ExtractionResponse;
      } else if (type === "error") {
        throw new Error(payload);
      }
    }
  });

  if (!finalPayload) {
    throw new Error("Ingest extraction completed without a final payload.");
  }

  return finalPayload;
}
