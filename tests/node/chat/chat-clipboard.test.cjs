const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const { formatChatTranscriptForClipboard } = require(fromRepoRoot("src", "lib", "chatClipboard.ts"));

test("formatChatTranscriptForClipboard returns empty string for no messages and no title", () => {
  assert.equal(formatChatTranscriptForClipboard([]), "");
});

test("formatChatTranscriptForClipboard includes title and labeled messages", () => {
  const messages = [
    {
      id: "a",
      sessionId: "s",
      role: "user",
      content: "Hello",
      createdAt: 1,
      tokens: null
    },
    {
      id: "b",
      sessionId: "s",
      role: "assistant",
      content: "Hi there",
      createdAt: 2,
      tokens: null
    }
  ];

  const out = formatChatTranscriptForClipboard(messages, "My chat");
  assert.equal(
    out,
    `My chat

You:
Hello

Assistant:
Hi there`
  );
});

test("formatChatTranscriptForClipboard notes attachments and images without duplicating body", () => {
  const messages = [
    {
      id: "a",
      sessionId: "s",
      role: "user",
      content: "See file",
      createdAt: 1,
      tokens: null,
      attachments: [{ kind: "file", label: "notes.pdf", text: "long text" }],
      mediaArtifacts: [
        { kind: "image", fileId: "x", mimeType: "image/png", label: "shot.png" }
      ]
    }
  ];

  const out = formatChatTranscriptForClipboard(messages, null);
  assert.ok(out.includes("Attachments: notes.pdf"));
  assert.ok(out.includes("1 image in this message"));
  assert.ok(!out.includes("long text"));
});
