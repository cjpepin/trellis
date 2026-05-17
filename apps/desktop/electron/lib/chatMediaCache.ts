import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getUserDataRoot } from "./appPaths";

const cacheDirName = "chat-media-cache";
const maxImageBytes = 15 * 1024 * 1024;
const maxAudioBytes = 25 * 1024 * 1024;

function getCacheRoot(): string {
  return path.join(getUserDataRoot(), cacheDirName);
}

function safeFileId(fileId: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(fileId);
}

export async function writeMediaCacheFile(
  bytes: Buffer,
  mimeType: string,
  kind: "image" | "audio" | "other"
): Promise<{ fileId: string }> {
  const limit = kind === "audio" ? maxAudioBytes : maxImageBytes;

  if (bytes.length > limit) {
    throw new Error(
      kind === "audio"
        ? "That recording is too large to transcribe."
        : "That image is too large to attach."
    );
  }

  const fileId = randomUUID();
  const root = getCacheRoot();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, `${fileId}.bin`), bytes);
  await fs.writeFile(path.join(root, `${fileId}.mime`), mimeType.trim(), "utf8");
  return { fileId };
}

export async function writeMediaCacheFromBase64(
  base64: string,
  mimeType: string,
  kind: "image" | "audio" | "other"
): Promise<{ fileId: string }> {
  const normalized = base64.replace(/^data:[^;]+;base64,/, "").trim();
  const bytes = Buffer.from(normalized, "base64");

  if (bytes.length === 0) {
    throw new Error("No media data to store.");
  }

  return writeMediaCacheFile(bytes, mimeType, kind);
}

export async function readMediaCacheBytes(fileId: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!safeFileId(fileId)) {
    return null;
  }

  const root = getCacheRoot();
  const binPath = path.join(root, `${fileId}.bin`);
  const mimePath = path.join(root, `${fileId}.mime`);

  try {
    const [bytes, mimeRaw] = await Promise.all([
      fs.readFile(binPath),
      fs.readFile(mimePath, "utf8")
    ]);
    return { bytes, mimeType: mimeRaw.trim() || "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function readMediaCacheDataUrl(fileId: string): Promise<string | null> {
  const got = await readMediaCacheBytes(fileId);

  if (!got) {
    return null;
  }

  return `data:${got.mimeType};base64,${got.bytes.toString("base64")}`;
}

export async function readMediaCacheBase64ForApi(fileId: string): Promise<{
  mimeType: string;
  dataBase64: string;
} | null> {
  const got = await readMediaCacheBytes(fileId);

  if (!got) {
    return null;
  }

  return {
    mimeType: got.mimeType,
    dataBase64: got.bytes.toString("base64")
  };
}

/** Digest for logging only — never log raw media. */
export function mediaCacheDigest(fileId: string): string {
  return createHash("sha256").update(fileId).digest("hex").slice(0, 12);
}
