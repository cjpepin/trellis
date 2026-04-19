/**
 * Dev-only cloud LLM extraction path for `scripts/extraction-eval.cjs`.
 * Not deployed as an Edge Function route; Trellis extraction is local-only in production.
 */

import { buildExtractionCorpus, buildExtractionUserMessage } from "../../shared/extraction/buildPrompt.ts";
import {
  extractionFeatureFlagNames,
  parseBooleanFlag
} from "../../shared/extraction/config.ts";
import {
  extractKnowledgeHeuristic,
  shouldExtractKnowledge,
  type HeuristicTranscriptMessage
} from "../../shared/extraction/heuristicKnowledge.ts";
import type {
  ExtractionContextNote,
  ExtractionIndexEntry as ExtractionIndexNote,
  ExtractionResponse as ExtractionPayload
} from "../../shared/extraction/contracts.ts";
import { parseExtractionResponseJson } from "../../shared/extraction/validate.ts";
import { extractionPrompt } from "../../supabase/functions/_shared/prompts.ts";
import { deriveSessionTitle } from "../../shared/chat/deriveSessionTitle.ts";

function readEnvironmentValue(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    const value = process.env[name];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function isHeuristicExtractionFallbackEnabled(): boolean {
  return parseBooleanFlag(
    readEnvironmentValue(extractionFeatureFlagNames.heuristicFallback),
    true
  );
}

async function callExtractionLLM(
  systemPrompt: string,
  userMessage: string
): Promise<string | null> {
  const openAiKey = readEnvironmentValue("OPENAI_API_KEY");

  if (openAiKey) {
    const model = readEnvironmentValue("OPENAI_EXTRACTION_MODEL") ?? "gpt-4o-mini";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ]
      })
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return payload.choices?.[0]?.message?.content ?? null;
    }
  }

  const anthropicKey = readEnvironmentValue("ANTHROPIC_API_KEY");
  const anthropicModel = readEnvironmentValue("ANTHROPIC_EXTRACTION_MODEL") ??
    "claude-3-5-haiku-latest";

  if (anthropicKey && anthropicModel) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 2048,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    });

    if (response.ok) {
      const payload = (await response.json()) as { content?: Array<{ text?: string }> };
      return payload.content?.[0]?.text ?? null;
    }
  }

  return null;
}

function parseExtractionResponse(
  raw: string,
  index: ExtractionIndexNote[],
  input: {
    sourceType?: string;
    sourcePath?: string;
  }
): ExtractionPayload | null {
  return parseExtractionResponseJson(raw, {
    index,
    sourceType:
      input.sourceType === "pdf" || input.sourceType === "text" || input.sourceType === "web"
        ? input.sourceType
        : undefined,
    sourcePath: input.sourcePath
  }).value;
}

export async function extractKnowledge(input: {
  transcript: HeuristicTranscriptMessage[];
  index: ExtractionIndexNote[];
  relatedNotes?: ExtractionContextNote[];
  sourceType?: "pdf" | "web" | "text";
  sourceTitle?: string;
  sourcePath?: string;
  sourceContent?: string;
}, options?: {
  allowHeuristicFallback?: boolean;
}): Promise<ExtractionPayload> {
  const corpus = buildExtractionCorpus(input);

  if (!shouldExtractKnowledge(corpus, input.sourceType)) {
    return { updates: [], sessionTitle: deriveSessionTitle(input.transcript) };
  }

  const userMessage = buildExtractionUserMessage(input);

  const llmResult = await callExtractionLLM(extractionPrompt, userMessage);

  if (llmResult) {
    const parsed = parseExtractionResponse(llmResult, input.index, {
      sourceType: input.sourceType,
      sourcePath: input.sourcePath
    });

    if (parsed && parsed.updates.length > 0) {
      return parsed;
    }

    if (parsed && parsed.updates.length === 0) {
      return {
        updates: [],
        sessionTitle: parsed.sessionTitle || deriveSessionTitle(input.transcript)
      };
    }
  }

  if (options?.allowHeuristicFallback ?? isHeuristicExtractionFallbackEnabled()) {
    return extractKnowledgeHeuristic(input);
  }

  throw new Error(
    "Cloud extraction returned no valid structured output and heuristic fallback is disabled."
  );
}

export { extractKnowledgeHeuristic };
