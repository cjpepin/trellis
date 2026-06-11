import type {
  ChatAttachment,
  ChatMediaArtifact,
  ChatReplyContext,
  ChatSessionSummary,
  MessageRecord,
  FolderSummary,
  GraphData,
  GraphEdge,
  GraphNode,
  NoteSummary,
  ProviderKeyStatusSnapshot,
  BucketSnapshot,
  WikiNote
} from "@trellis/contracts";
import { normalizeChatModel } from "@trellis/contracts";
import type {
  CloudBootstrapResponse,
  CloudChatMessage,
  CloudChatSessionSummary,
  CloudGraphData,
  CloudNote,
  CloudNoteSummary,
  CloudProviderCredentialStatus
} from "@trellis/shared/cloud/types";
import { extractParsedCloudWikiLinks } from "@trellis/shared/cloud/wikiLinks";

function buildRelativePath(folderPath: string, slug: string): string {
  return folderPath.length > 0 ? `${folderPath}/${slug}.md` : `${slug}.md`;
}

function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tagAssociationStrength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0.18;
  }

  const leftSet = new Set(left.map((value) => value.toLowerCase()));
  const overlap = right.filter((value) => leftSet.has(value.toLowerCase())).length;

  if (overlap === 0) {
    return 0.22;
  }

  return Math.min(1, 0.28 + overlap * 0.18);
}

export function cloudProviderStatusesToSnapshot(
  statuses: CloudProviderCredentialStatus[]
): ProviderKeyStatusSnapshot {
  return {
    statuses: statuses.map((status) => ({
      provider: status.provider,
      configured: status.configured,
      lastFour: status.lastFour,
      updatedAt: status.updatedAt ? Date.parse(status.updatedAt) : null
    })),
    secureStorageAvailable: true,
    persistenceMode: "encrypted"
  };
}

export function cloudNoteSummaryToNoteSummary(note: CloudNoteSummary): NoteSummary {
  return {
    slug: note.slug,
    title: note.title,
    updated: note.updatedAt,
    tags: note.tags,
    type: note.noteType,
    excerpt: note.excerpt,
    inboundCount: note.inboundCount,
    folderPath: note.folderPath,
    relativePath: buildRelativePath(note.folderPath, note.slug)
  };
}

export function cloudNoteToWikiNote(note: CloudNote): WikiNote {
  return {
    ...cloudNoteSummaryToNoteSummary(note),
    content: note.markdownBody,
    links: extractParsedCloudWikiLinks(note.markdownBody).map((link) => link.slug),
    sources: note.sourceCount,
    url: note.url ?? undefined
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isJsonObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  return (
    isJsonObjectRecord(value) &&
    (value.kind === "file" || value.kind === "url") &&
    isString(value.label) &&
    isString(value.text) &&
    (value.sourceUrl === undefined || isString(value.sourceUrl))
  );
}

function isChatMediaArtifact(value: unknown): value is ChatMediaArtifact {
  return (
    isJsonObjectRecord(value) &&
    (value.kind === "image" || value.kind === "generated_image") &&
    isString(value.fileId) &&
    isString(value.mimeType) &&
    isString(value.label) &&
    (value.prompt === undefined || isString(value.prompt)) &&
    (value.pendingGeneration === undefined || typeof value.pendingGeneration === "boolean") &&
    (value.noteAssetsPath === undefined || isString(value.noteAssetsPath))
  );
}

function isChatReplyContext(value: unknown): value is ChatReplyContext {
  return (
    isJsonObjectRecord(value) &&
    Array.isArray(value.sourceLabels) &&
    value.sourceLabels.every(isString) &&
    Array.isArray(value.items)
  );
}

export function cloudChatSessionToSummary(
  session: CloudChatSessionSummary,
  bucketId: string
): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: Date.parse(session.createdAt),
    updatedAt: Date.parse(session.updatedAt),
    model: normalizeCloudChatModel(session.model),
    messageCount: session.messageCount,
    bucketId
  };
}

export function cloudChatMessageToRecord(message: CloudChatMessage): MessageRecord {
  const attachments = message.attachments.filter(isChatAttachment) as unknown as ChatAttachment[];
  const mediaArtifacts = message.mediaArtifacts.filter(
    isChatMediaArtifact
  ) as unknown as ChatMediaArtifact[];

  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    content: message.content,
    createdAt: Date.parse(message.createdAt),
    tokens: message.tokens,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(mediaArtifacts.length > 0 ? { mediaArtifacts } : {}),
    ...(Array.isArray(message.noteActions) && message.noteActions.length > 0
      ? { noteActions: message.noteActions as unknown as MessageRecord["noteActions"] }
      : {}),
    ...(message.replyContext && isChatReplyContext(message.replyContext)
      ? { replyContext: message.replyContext as unknown as ChatReplyContext }
      : {}),
    ...(Array.isArray(message.composerPins) && message.composerPins.length > 0
      ? { composerPins: message.composerPins as unknown as MessageRecord["composerPins"] }
      : {})
  };
}

function normalizeCloudChatModel(model: string): ChatSessionSummary["model"] {
  return normalizeChatModel(model);
}

export function cloudFolderPathsToFolderSummaries(
  folderPaths: string[],
  notes: NoteSummary[]
): FolderSummary[] {
  const uniquePaths = [...new Set(folderPaths)].sort((left, right) => left.localeCompare(right));

  return uniquePaths.map((folderPath) => ({
    path: folderPath,
    name: folderPath.split("/").at(-1) ?? folderPath,
    noteCount: notes.filter(
      (note) => note.folderPath === folderPath || note.folderPath.startsWith(`${folderPath}/`)
    ).length
  }));
}

export function cloudGraphToGraphData(graph: CloudGraphData): GraphData {
  const nodeBySlug = new Map(graph.nodes.map((node) => [node.slug, node]));
  const directedEdgeKeys = new Set(graph.edges.map((edge) => `${edge.source}->${edge.target}`));

  const edges: GraphEdge[] = graph.edges.map((edge) => {
    const source = nodeBySlug.get(edge.source);
    const target = nodeBySlug.get(edge.target);
    const mutual = directedEdgeKeys.has(`${edge.target}->${edge.source}`);
    const association = tagAssociationStrength(source?.tags ?? [], target?.tags ?? []);

    return {
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      association: mutual ? Math.min(1, association * 1.15 + 0.08) : association
    };
  });

  const nodes: GraphNode[] = graph.nodes.map((node) => ({
    id: node.slug,
    slug: node.slug,
    title: node.title || humanizeSlug(node.slug),
    tags: node.tags,
    type: node.noteType,
    inboundCount: node.inboundCount,
    size: node.isPlaceholder
      ? 8 + Math.min(node.inboundCount * 2, 14)
      : 10 + Math.min(node.inboundCount * 2, 18),
    cluster: node.isPlaceholder ? "placeholder" : node.tags[0],
    isPlaceholder: node.isPlaceholder === true
  }));

  return {
    nodes,
    edges
  };
}

export function cloudBootstrapToBucketSnapshot(
  payload: CloudBootstrapResponse,
  localVault: { id: string; name: string; path: string }
): BucketSnapshot {
  const notes = payload.notes.map(cloudNoteSummaryToNoteSummary);

  return {
    bucketId: localVault.id,
    bucketName: localVault.name,
    bucketPath: localVault.path,
    notes,
    folders: cloudFolderPathsToFolderSummaries(payload.folderPaths, notes),
    graph: cloudGraphToGraphData(payload.graph)
  };
}
