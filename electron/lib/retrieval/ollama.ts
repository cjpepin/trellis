const defaultEmbeddingModel = "nomic-embed-text-v2-moe";
const ollamaBaseUrl = "http://127.0.0.1:11434/api";

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

export interface EmbeddingRunResult {
  embeddings: Array<number[] | null>;
  model: string | null;
  usedEmbeddings: boolean;
}

function normalizeEmbeddingPayload(payload: OllamaEmbedResponse): number[][] {
  if (Array.isArray(payload.embeddings)) {
    return payload.embeddings.filter(
      (item): item is number[] => Array.isArray(item) && item.every((value) => typeof value === "number")
    );
  }

  if (Array.isArray(payload.embedding)) {
    return [payload.embedding.filter((value): value is number => typeof value === "number")];
  }

  return [];
}

export async function embedTexts(
  inputs: string[],
  model = defaultEmbeddingModel
): Promise<EmbeddingRunResult> {
  if (inputs.length === 0) {
    return {
      embeddings: [],
      model: null,
      usedEmbeddings: false
    };
  }

  try {
    const response = await fetch(`${ollamaBaseUrl}/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: inputs
      })
    });

    if (!response.ok) {
      return {
        embeddings: inputs.map(() => null),
        model: null,
        usedEmbeddings: false
      };
    }

    const payload = (await response.json()) as OllamaEmbedResponse;
    const normalized = normalizeEmbeddingPayload(payload);

    if (normalized.length !== inputs.length) {
      return {
        embeddings: inputs.map((_, index) => normalized[index] ?? null),
        model: normalized.length > 0 ? model : null,
        usedEmbeddings: normalized.length > 0
      };
    }

    return {
      embeddings: normalized,
      model,
      usedEmbeddings: true
    };
  } catch {
    return {
      embeddings: inputs.map(() => null),
      model: null,
      usedEmbeddings: false
    };
  }
}
