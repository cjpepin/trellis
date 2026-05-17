import { Node, mergeAttributes, type NodeViewRendererProps } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import katex from "katex";

const KATEX_DISPLAY = {
  displayMode: true,
  throwOnError: false,
  strict: "ignore" as const,
  trust: false,
  maxSize: 500,
  maxExpand: 1000
};

const KATEX_INLINE = {
  displayMode: false,
  throwOnError: false,
  strict: "ignore" as const,
  trust: false,
  maxSize: 500,
  maxExpand: 1000
};

function escapeDataTex(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\n", "&#10;");
}

function elFromKatexOrRebuild(
  katexHTML: string | null | undefined,
  tex: string,
  display: true,
  origin: string | null
): HTMLDivElement;
function elFromKatexOrRebuild(
  katexHTML: string | null | undefined,
  tex: string,
  display: false,
  origin: null
): HTMLSpanElement;
function elFromKatexOrRebuild(
  katexHTML: string | null | undefined,
  tex: string,
  display: boolean,
  origin: string | null
): HTMLDivElement | HTMLSpanElement {
  if (katexHTML) {
    const tpl = document.createElement("template");
    tpl.innerHTML = katexHTML.trim();
    const el = tpl.content.firstElementChild;
    if (el instanceof HTMLElement && el.querySelector(".katex") !== null) {
      return el as HTMLDivElement | HTMLSpanElement;
    }
  }
  const trimmed = tex?.trim() ?? "";
  if (display) {
    const div = document.createElement("div");
    div.className = "trellis-math-display";
    if (origin === "fence-latex") {
      div.setAttribute("data-trellis-math-origin", "fence-latex");
    }
    div.setAttribute("data-trellis-tex", escapeDataTex(trimmed));
    if (trimmed) {
      div.innerHTML = katex.renderToString(trimmed, KATEX_DISPLAY);
    }
    return div;
  }
  const span = document.createElement("span");
  span.className = "trellis-math-inline";
  span.setAttribute("data-trellis-tex", escapeDataTex(trimmed));
  if (trimmed) {
    span.innerHTML = katex.renderToString(trimmed, KATEX_INLINE);
  }
  return span;
}

function copyKatexShellFrom(target: HTMLElement, source: HTMLElement): void {
  const tagOk =
    (target instanceof HTMLDivElement && source instanceof HTMLDivElement) ||
    (target instanceof HTMLSpanElement && source instanceof HTMLSpanElement);
  if (!tagOk) {
    return;
  }
  for (const name of target.getAttributeNames()) {
    target.removeAttribute(name);
  }
  for (const attr of source.attributes) {
    target.setAttribute(attr.name, attr.value);
  }
  target.innerHTML = source.innerHTML;
}

export const TrellisKatexDisplay = Node.create({
  name: "trellisKatexDisplay",
  group: "block",
  atom: true,
  defining: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tex: { default: null as string | null },
      origin: { default: null as string | null },
      katexHTML: { default: null as string | null }
    };
  },

  parseHTML() {
    return [
      {
        tag: "div.trellis-math-display",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) {
            return false;
          }
          return {
            katexHTML: el.outerHTML,
            tex: el.getAttribute("data-trellis-tex") ?? "",
            origin: el.dataset.trellisMathOrigin === "fence-latex" ? "fence-latex" : null
          };
        }
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    if (typeof document === "undefined") {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          class: "trellis-math-display",
          ...(node.attrs.origin === "fence-latex" ? { "data-trellis-math-origin": "fence-latex" } : {}),
          ...(node.attrs.tex ? { "data-trellis-tex": node.attrs.tex } : {})
        })
      ];
    }
    return elFromKatexOrRebuild(null, node.attrs.tex, true, node.attrs.origin);
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const { node } = props;
      const dom = elFromKatexOrRebuild(node.attrs.katexHTML, node.attrs.tex, true, node.attrs.origin) as HTMLDivElement;
      return {
        dom,
        ignoreMutation: () => true,
        update: (n: PMNode) => {
          if (n.type.name !== "trellisKatexDisplay") {
            return false;
          }
          const next = elFromKatexOrRebuild(n.attrs.katexHTML, n.attrs.tex, true, n.attrs.origin) as HTMLDivElement;
          copyKatexShellFrom(dom, next);
          return true;
        }
      };
    };
  }
});

export const TrellisKatexInline = Node.create({
  name: "trellisKatexInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tex: { default: null as string | null },
      katexHTML: { default: null as string | null }
    };
  },

  parseHTML() {
    return [
      {
        tag: "span.trellis-math-inline",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) {
            return false;
          }
          return {
            katexHTML: el.outerHTML,
            tex: el.getAttribute("data-trellis-tex") ?? ""
          };
        }
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    if (typeof document === "undefined") {
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          class: "trellis-math-inline",
          ...(node.attrs.tex ? { "data-trellis-tex": node.attrs.tex } : {})
        })
      ];
    }
    return elFromKatexOrRebuild(null, node.attrs.tex, false, null);
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const { node } = props;
      const dom = elFromKatexOrRebuild(
        node.attrs.katexHTML,
        node.attrs.tex,
        false,
        null
      ) as HTMLSpanElement;
      return {
        dom,
        ignoreMutation: () => true,
        update: (n: PMNode) => {
          if (n.type.name !== "trellisKatexInline") {
            return false;
          }
          const next = elFromKatexOrRebuild(n.attrs.katexHTML, n.attrs.tex, false, null) as HTMLSpanElement;
          copyKatexShellFrom(dom, next);
          return true;
        }
      };
    };
  }
});
