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

test("renderWikiMarkdown renders $$ display math with KaTeX", () => {
  const rendered = renderWikiMarkdown("$$\n(AB)_{ij} = \\sum_{k=1}^{n} A_{ik} B_{kj}\n$$", new Set());

  assert.match(rendered.html, /trellis-math-display/);
  assert.match(rendered.html, /\bkatex\b/);
  assert.match(rendered.html, /data-trellis-tex=/);
});

test("renderWikiMarkdown renders fenced latex code blocks as math", () => {
  const rendered = renderWikiMarkdown(["```latex", "x^2 + y^2 = r^2", "```"].join("\n"), new Set());

  assert.match(rendered.html, /trellis-math-display/);
  assert.match(rendered.html, /data-trellis-math-origin="fence-latex"/);
  assert.doesNotMatch(rendered.html, /<pre><code class="[^"]*language-latex/);
});

test("renderWikiMarkdown does not treat $$ inside fenced code as math", () => {
  const rendered = renderWikiMarkdown(["```", "$$not-math$$", "```"].join("\n"), new Set());

  assert.match(rendered.html, /\$\$not-math\$\$/);
  assert.doesNotMatch(rendered.html, /trellis-math-display/);
});

test("htmlToMarkdown restores display math from trellis-math-display", () => {
  const rendered = renderWikiMarkdown("$$\na+b\n$$", new Set());
  const roundTrip = htmlToMarkdown(rendered.html);

  assert.match(roundTrip, /\$\$\s*\na\+b\n\$\$/);
});

test("renderWikiMarkdown treats legacy AI bracket display blocks as math", () => {
  const md = ["[", "(AB)_{ij} = \\sum_{k=1}^{n} A_{ik} B_{kj}", "]"].join("\n");
  const rendered = renderWikiMarkdown(md, new Set());

  assert.match(rendered.html, /trellis-math-display/);
  assert.match(rendered.html, /\bkatex\b/);
});

test("renderWikiMarkdown renders undelimited \\begin{bmatrix}…\\end{bmatrix}", () => {
  const md = "A=\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}";
  const rendered = renderWikiMarkdown(md, new Set());

  assert.match(rendered.html, /trellis-math-display/);
  assert.match(rendered.html, /\bkatex\b/);
});

test("renderWikiMarkdown merges $…\\begin{bmatrix}…\\end{bmatrix}…$ into one display (OpenAI-style)", () => {
  const md = "$A = \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$";
  const rendered = renderWikiMarkdown(md, new Set());
  assert.doesNotMatch(rendered.html, /katex-error/);
  assert.match(rendered.html, /trellis-math-display/);
  assert.doesNotMatch(rendered.html, /TRELLIS_MATH_S/);
});

test("renderWikiMarkdown merges multiline $…$ around bmatrix (newlines before \\begin)", () => {
  const md = [
    "$A = ",
    "",
    " \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$"
  ].join("\n");
  const rendered = renderWikiMarkdown(md, new Set());
  assert.doesNotMatch(rendered.html, /katex-error/);
  assert.match(rendered.html, /trellis-math-display/);
});

test("renderWikiMarkdown merges three $…bmatrix…$ in example + = pattern", () => {
  const inner = "\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}";
  const md = "Example: $" + inner + "$ + $" + inner + "$ = $" + inner + "$";
  const rendered = renderWikiMarkdown(md, new Set());
  assert.doesNotMatch(rendered.html, /katex-error/);
  assert.equal((rendered.html.match(/trellis-math-display/g) ?? []).length, 3);
});

test("renderWikiMarkdown stashes \\begin in a single $$…$$ block (no KaTeX on TRELLIS_* placeholders)", () => {
  const inner = "\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}";
  const md = "$$" + inner + " + " + inner + " = " + inner + "$$";
  const rendered = renderWikiMarkdown(md, new Set());
  assert.doesNotMatch(rendered.html, /katex-error/);
  assert.doesNotMatch(rendered.html, /TRELLIS_MATH_S/);
  assert.equal((rendered.html.match(/trellis-math-display/g) ?? []).length, 3);
});

test("renderWikiMarkdown normalizes bogus single-backslash row breaks (avoids red KaTeX error HTML)", () => {
  const md = "A=\\begin{bmatrix}1 & 2 & 3\\\n4 & 5 & 6\\end{bmatrix}";
  const rendered = renderWikiMarkdown(md, new Set());

  assert.doesNotMatch(rendered.html, /katex-error/);
  assert.match(rendered.html, /\bkatex\b/);
});

test("renderWikiMarkdown decodes HTML entities inside LaTeX before KaTeX", () => {
  const md = "A=\\begin{bmatrix}1 &amp; 2 &amp; 3 \\\\ 4 &amp; 5 &amp; 6\\end{bmatrix}";
  const rendered = renderWikiMarkdown(md, new Set());

  assert.doesNotMatch(rendered.html, /katex-error/);
  assert.match(rendered.html, /\bkatex\b/);
});

test("renderWikiMarkdown does not leave math slot stubs in output", () => {
  const md = ["$$x+1$$", "", "Inline $y$ here."].join("\n");
  const rendered = renderWikiMarkdown(md, new Set());

  assert.doesNotMatch(rendered.html, /data-trellis-math-slot=/);
  assert.doesNotMatch(rendered.html, /TRELLIS_MATH_S_\d+_(?:BLK|INL)/);
  assert.doesNotMatch(rendered.html, /trellis-math:blk:/);
  assert.doesNotMatch(rendered.html, /trellis-math:inl:/);
});

test("renderWikiMarkdown strips leaked stubs with unicode minus / glued div (persisted bad markup)", () => {
  const md = ["Hello", '<divdata\u2212trellis\u2212math\u2212slot="0"></div>', "tail"].join("\n");
  const rendered = renderWikiMarkdown(md, new Set());

  assert.doesNotMatch(rendered.html, /trellis-math-slot/i);
  assert.doesNotMatch(rendered.html, /\u2212trellis/);
});

test("renderWikiMarkdown removes glued div stub that marked escapes as entities (A=<divdata-…)", () => {
  const md = 'A=<divdata-trellis-math-slot="0"></div>';
  const rendered = renderWikiMarkdown(md, new Set());

  assert.doesNotMatch(rendered.html, /trellis-math-slot/i);
  assert.doesNotMatch(rendered.html, /divdata-trellis/);
  assert.doesNotMatch(rendered.html, /&lt;div/);
  assert.match(rendered.html, /A=/);
});

test("renderWikiMarkdown removes tab-indented legacy <!-- trellis-math:… --> left as entity text by marked", () => {
  const md = "\t<!-- trellis-math:blk:0 -->\n";
  const rendered = renderWikiMarkdown(md, new Set());
  assert.doesNotMatch(rendered.html, /&lt;!--/);
  assert.doesNotMatch(rendered.html, /TRELLIS_MATH_S/);
  assert.doesNotMatch(rendered.html, /trellis-math:blk/);
});
