/** Max combined file, URL, and image attachments per chat message. */
export const maxChatComposerAttachments = 5;

export const maxChatPickPdfBytes = 15 * 1024 * 1024;
export const maxChatPickTextFileBytes = 2 * 1024 * 1024;
/** Characters of attachment text included in the model context (per file). */
export const maxChatAttachmentContextChars = 120_000;
