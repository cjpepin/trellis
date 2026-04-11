const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { fromRepoRoot } = require("../support/repo-paths.cjs");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLImageElement = dom.window.HTMLImageElement;

const { htmlToMarkdown } = require(fromRepoRoot("src", "lib", "htmlToMarkdown.ts"));
const { renderWikiMarkdown } = require(fromRepoRoot("src", "lib", "markdown.ts"));

test("renderWikiMarkdown adds local-only preview for standalone external links", () => {
  const rendered = renderWikiMarkdown(
    ["Read this:", "", "[Trellis](https://example.com/research)", "", "inline [x](https://example.com/x) stays inline."].join("\n"),
    new Set()
  );

  assert.match(rendered.html, /data-trellis-link-preview="true"/);
  assert.match(rendered.html, /example\.com/);
  assert.equal((rendered.html.match(/data-trellis-link-preview/g) ?? []).length, 1);
});

test("renderWikiMarkdown skips external previews inside fenced code", () => {
  const rendered = renderWikiMarkdown(
    ["```", "https://example.com/not-a-preview", "```"].join("\n"),
    new Set()
  );

  assert.doesNotMatch(rendered.html, /data-trellis-link-preview/);
});

test("htmlToMarkdown drops generated preview cards and preserves the source link", () => {
  const markdown = htmlToMarkdown(`
    <p><a href="https://example.com/research">Trellis</a></p>
    <div class="trellis-link-preview" data-trellis-link-preview="true">
      <a href="https://example.com/research">Trellis</a>
      <span>example.com</span>
    </div>
  `);

  assert.match(markdown, /\[Trellis\]\(https:\/\/example\.com\/research\)/);
  assert.doesNotMatch(markdown, /example\.com\s*$/);
  assert.doesNotMatch(markdown, /trellis-link-preview/);
});

test("htmlToMarkdown preserves local image markdown paths after data URL display", () => {
  const markdown = htmlToMarkdown(
    '<p><img src="data:image/png;base64,abc" data-trellis-image-src="./.trellis-note-assets/diagram.png" alt="diagram"></p>'
  );

  assert.equal(markdown.trim(), "![diagram](./.trellis-note-assets/diagram.png)");
});

test("htmlToMarkdown keeps rich table HTML when column sizing is present", () => {
  const markdown = htmlToMarkdown(`
    <table>
      <colgroup><col style="width: 120px;"></colgroup>
      <tbody><tr><td>Alpha</td></tr></tbody>
    </table>
  `);

  assert.match(markdown, /<table>/);
  assert.match(markdown, /width: 120px/);
  assert.match(markdown, /Alpha/);
});

test("renderWikiMarkdown preserves safe table sizing styles", () => {
  const rendered = renderWikiMarkdown(
    '<table style="min-width: 75px;"><colgroup><col style="width: 120px;"></colgroup><tbody><tr><td>Alpha</td></tr></tbody></table>',
    new Set()
  );

  assert.match(rendered.html, /min-width: 75px/);
  assert.match(rendered.html, /width: 120px/);
  assert.match(rendered.html, /Alpha/);
});
