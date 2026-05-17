import { mergeAttributes } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import { isInternalNoteHashHref } from "@/lib/noteRoutes";

/**
 * Renders in-app note links (`#/notes?note=…`, including legacy `#/wiki?note=…`) with distinct classes from web links.
 */
export const WikiAwareLink = Link.extend({
  name: "link",

  renderHTML({ HTMLAttributes }) {
    const href = String(HTMLAttributes.href ?? "");
    const isWiki = isInternalNoteHashHref(href);
    const isHttp = href.startsWith("http://") || href.startsWith("https://");
    const cls = isWiki
      ? "trellis-link trellis-link-internal"
      : isHttp
        ? "trellis-link"
        : "trellis-link";

    return [
      "a",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: cls,
        ...(isHttp ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})
      }),
      0
    ];
  }
});
