const assert = require("node:assert/strict");
const test = require("node:test");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const {
  findActiveTemplateInstance,
  findTemplateFromLinkedTitle,
  isTemplateInstanceDoneMessage
} = require(fromRepoRoot("electron", "lib", "chat", "templateInstanceActions.ts"));

test("findTemplateFromLinkedTitle finds only linked template notes", () => {
  const notes = [
    {
      slug: "daily-log-date-template",
      title: "Daily Log - {{date}} Template",
      tags: ["template"],
      updated: "",
      type: "concept",
      excerpt: "",
      inboundCount: 0,
      folderPath: "templates",
      relativePath: "templates/daily-log-date-template.md"
    },
    {
      slug: "daily-log",
      title: "Daily Log",
      tags: [],
      updated: "",
      type: "concept",
      excerpt: "",
      inboundCount: 0,
      folderPath: "",
      relativePath: "daily-log.md"
    }
  ];

  const matched = findTemplateFromLinkedTitle(
    "Fill out [[Daily Log - {{date}} Template]] for today.",
    notes
  );
  const ordinary = findTemplateFromLinkedTitle("Fill out [[Daily Log]] for today.", notes);

  assert.equal(matched?.slug, "daily-log-date-template");
  assert.equal(ordinary, null);
});

test("findActiveTemplateInstance returns the latest active instance", () => {
  const older = {
    templateSlug: "old-template",
    templateTitle: "Old Template",
    instanceSlug: "old-instance",
    instanceTitle: "Old Instance",
    status: "completed",
    sourceUserMessageIds: [crypto.randomUUID()],
    answerUserMessageIds: [],
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2
  };
  const active = {
    templateSlug: "daily-log-template",
    templateTitle: "Daily Log Template",
    instanceSlug: "daily-log-2026-04-10-abcdef12",
    instanceTitle: "Daily Log - Apr 10, 2026",
    status: "active",
    sourceUserMessageIds: [crypto.randomUUID()],
    answerUserMessageIds: [],
    createdAt: 3,
    updatedAt: 3
  };

  assert.equal(
    findActiveTemplateInstance([{ templateInstance: older }, { templateInstance: active }]),
    active
  );
});

test("template completion phrases are conservative", () => {
  assert.equal(isTemplateInstanceDoneMessage("perfect!"), true);
  assert.equal(isTemplateInstanceDoneMessage("that’s it"), true);
  assert.equal(isTemplateInstanceDoneMessage("I had a perfect day at the park."), false);
});
