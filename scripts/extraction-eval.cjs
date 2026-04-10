#!/usr/bin/env node

require("sucrase/register/ts");

const fs = require("node:fs");
const path = require("node:path");

const {
  extractKnowledge,
  extractKnowledgeHeuristic
} = require("../supabase/functions/_shared/models.ts");

const rootDir = path.resolve(__dirname, "..");
const defaultCorpusPath = path.join(rootDir, "fixtures", "eval", "extraction-corpus.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getFlag(args, name) {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value) {
  return stripMarkdown(value)
    .split(" ")
    .filter(Boolean).length;
}

function getWritableUpdates(response) {
  return (response?.updates ?? []).filter((update) => update.operation !== "noop");
}

function scoreCase(definition, response, error) {
  const expectations = definition.expectations ?? {};
  const writes = response ? getWritableUpdates(response) : [];
  const checks = [];

  function addCheck(label, passed, details) {
    checks.push({ label, passed, details });
  }

  if (expectations.expectNoop === true) {
    addCheck("No-op behavior", writes.length === 0, `writes=${writes.length}`);
  } else if (expectations.minWrites !== undefined) {
    addCheck(
      "Minimum writes",
      writes.length >= expectations.minWrites,
      `writes=${writes.length}, min=${expectations.minWrites}`
    );
  }

  if (expectations.maxWrites !== undefined) {
    addCheck(
      "Maximum writes",
      writes.length <= expectations.maxWrites,
      `writes=${writes.length}, max=${expectations.maxWrites}`
    );
  }

  if (Array.isArray(expectations.requireTargetSlugs) && expectations.requireTargetSlugs.length > 0) {
    const present = new Set(writes.map((update) => update.targetSlug));
    addCheck(
      "Required targets",
      expectations.requireTargetSlugs.every((slug) => present.has(slug)),
      `targets=${writes.map((update) => update.targetSlug).join(", ") || "none"}`
    );
  }

  if (Array.isArray(expectations.forbiddenTargetSlugs) && expectations.forbiddenTargetSlugs.length > 0) {
    const present = new Set(writes.map((update) => update.targetSlug));
    addCheck(
      "Forbidden targets avoided",
      expectations.forbiddenTargetSlugs.every((slug) => !present.has(slug)),
      `targets=${writes.map((update) => update.targetSlug).join(", ") || "none"}`
    );
  }

  if (expectations.requiredOperationsByTarget && typeof expectations.requiredOperationsByTarget === "object") {
    const operationMap = new Map(
      writes.map((update) => [update.targetSlug, update.operation])
    );
    const entries = Object.entries(expectations.requiredOperationsByTarget);
    addCheck(
      "Required operations",
      entries.every(([slug, operation]) => operationMap.get(slug) === operation),
      entries
        .map(([slug, operation]) => `${slug}:${operationMap.get(slug) ?? "missing"} (expected ${operation})`)
        .join(" | ")
    );
  }

  if (expectations.forbidCreate === true) {
    addCheck(
      "Create avoided",
      writes.every((update) => update.operation !== "create"),
      `ops=${writes.map((update) => update.operation).join(", ") || "none"}`
    );
  }

  if (Array.isArray(expectations.requiredTargetTypes) && expectations.requiredTargetTypes.length > 0) {
    const types = new Set(writes.map((update) => update.targetType));
    addCheck(
      "Required note types",
      expectations.requiredTargetTypes.every((type) => types.has(type)),
      `types=${writes.map((update) => update.targetType).join(", ") || "none"}`
    );
  }

  if (expectations.minLinksOnWrites !== undefined && writes.length > 0) {
    addCheck(
      "Link density",
      writes.every((update) => update.links.length >= expectations.minLinksOnWrites),
      writes.map((update) => `${update.targetSlug}:${update.links.length}`).join(" | ")
    );
  }

  if (expectations.minBodyWords !== undefined && writes.length > 0) {
    addCheck(
      "Body quality",
      writes.every((update) => countWords(update.body) >= expectations.minBodyWords),
      writes.map((update) => `${update.targetSlug}:${countWords(update.body)}`).join(" | ")
    );
  }

  if (writes.length > 0) {
    addCheck(
      "Transcript-style lines avoided",
      writes.every((update) => !/\b(?:user|assistant)\s*:/i.test(update.body)),
      "Bodies should read like notes, not chat logs."
    );
  }

  if (error) {
    addCheck("Run completed", false, error);
  }

  const score = checks.filter((check) => check.passed).length;

  return {
    score,
    maxScore: checks.length,
    checks
  };
}

async function executeCase(mode, definition) {
  if (mode === "heuristic") {
    return extractKnowledgeHeuristic(definition.input);
  }

  if (mode === "v2") {
    return extractKnowledge(definition.input, {
      allowHeuristicFallback: false
    });
  }

  if (mode === "ollama") {
    return executeOllamaCase(definition);
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

async function executeOllamaCase(definition) {
  const { defaultLocalExtractionModelId } = require("../shared/extraction/config.ts");
  const { buildExtractionUserMessage } = require("../shared/extraction/buildPrompt.ts");
  const { extractionPrompt } = require("../supabase/functions/_shared/prompts.ts");
  const { extractionResponseJsonSchema } = require("../shared/extraction/jsonSchema.ts");
  const { parseExtractionResponseJson } = require("../shared/extraction/validate.ts");

  const model = process.env.TRELLIS_EXTRACTION_MODEL || defaultLocalExtractionModelId;
  const base = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
  const input = definition.input;

  const userContent = buildExtractionUserMessage({
    transcript: input.transcript,
    index: input.index ?? [],
    relatedNotes: input.relatedNotes
  });

  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: extractionResponseJsonSchema,
      options: {
        temperature: 0.2
      },
      messages: [
        {
          role: "system",
          content: extractionPrompt
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const content = payload.message?.content?.trim();

  if (!content) {
    throw new Error("Ollama returned an empty extraction response.");
  }

  const parsed = parseExtractionResponseJson(content, {
    index: input.index ?? []
  });

  if (!parsed.value) {
    const first = parsed.issues[0];
    throw new Error(first ? `${first.path}: ${first.message}` : "Invalid extraction payload.");
  }

  return parsed.value;
}

async function runMode(mode, corpusPath, outputPath) {
  const corpus = readJson(corpusPath);
  const cases = [];

  for (const definition of corpus) {
    try {
      const response = await executeCase(mode, definition);
      const scoring = scoreCase(definition, response, null);
      cases.push({
        id: definition.id,
        title: definition.title,
        response,
        error: null,
        ...scoring
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const scoring = scoreCase(definition, null, message);
      cases.push({
        id: definition.id,
        title: definition.title,
        response: null,
        error: message,
        ...scoring
      });
    }
  }

  const totals = cases.reduce(
    (summary, entry) => {
      summary.score += entry.score;
      summary.maxScore += entry.maxScore;
      if (entry.error) {
        summary.erroredCases += 1;
      }
      if (entry.score === entry.maxScore) {
        summary.passedCases += 1;
      }
      return summary;
    },
    {
      score: 0,
      maxScore: 0,
      passedCases: 0,
      erroredCases: 0
    }
  );

  const result = {
    mode,
    generatedAt: new Date().toISOString(),
    corpusPath: path.relative(rootDir, corpusPath),
    totals: {
      ...totals,
      caseCount: cases.length
    },
    cases
  };

  if (outputPath) {
    writeJson(outputPath, result);
  }

  console.log(
    `${mode.toUpperCase()} ${totals.score}/${totals.maxScore} across ${cases.length} cases (${totals.passedCases} fully passed, ${totals.erroredCases} errors).`
  );

  for (const entry of cases) {
    console.log(
      `- ${entry.id}: ${entry.score}/${entry.maxScore}${entry.error ? ` [error: ${entry.error}]` : ""}`
    );
  }

  if (outputPath) {
    console.log(`Saved results to ${path.relative(rootDir, outputPath)}`);
  }
}

function compareResults(baselinePath, candidatePath) {
  const baseline = readJson(baselinePath);
  const candidate = readJson(candidatePath);
  const baselineCases = new Map(baseline.cases.map((entry) => [entry.id, entry]));

  console.log(
    `Baseline ${baseline.mode}: ${baseline.totals.score}/${baseline.totals.maxScore}`
  );
  console.log(
    `Candidate ${candidate.mode}: ${candidate.totals.score}/${candidate.totals.maxScore}`
  );
  console.log(
    `Delta: ${candidate.totals.score - baseline.totals.score >= 0 ? "+" : ""}${candidate.totals.score - baseline.totals.score}`
  );

  for (const entry of candidate.cases) {
    const previous = baselineCases.get(entry.id);
    const previousScore = previous ? previous.score : 0;
    const delta = entry.score - previousScore;
    console.log(
      `- ${entry.id}: ${previousScore} -> ${entry.score} (${delta >= 0 ? "+" : ""}${delta})`
    );
  }
}

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/extraction-eval.cjs heuristic [--corpus path] [--out path]");
  console.log("  node scripts/extraction-eval.cjs v2 [--corpus path] [--out path]");
  console.log(
    "  node scripts/extraction-eval.cjs ollama [--corpus path] [--out path]  (needs Ollama; model from TRELLIS_EXTRACTION_MODEL or default local extractor)"
  );
  console.log("  node scripts/extraction-eval.cjs compare --baseline path --candidate path");
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "compare") {
    const baselinePath = getFlag(args, "--baseline");
    const candidatePath = getFlag(args, "--candidate");

    if (!baselinePath || !candidatePath) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    compareResults(path.resolve(rootDir, baselinePath), path.resolve(rootDir, candidatePath));
    return;
  }

  if (command !== "heuristic" && command !== "v2" && command !== "ollama") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const corpusPath = path.resolve(rootDir, getFlag(args, "--corpus") ?? defaultCorpusPath);
  const outputPath = path.resolve(
    rootDir,
    getFlag(args, "--out") ?? path.join("fixtures", "eval", `${command}-results.json`)
  );

  await runMode(command, corpusPath, outputPath);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
