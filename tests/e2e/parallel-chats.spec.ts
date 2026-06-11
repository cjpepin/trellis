import { dismissLocalNoteProcessorFirstRun, expect, test, selectWorkspace } from "./fixtures";

const previousStubLocalReply = process.env.TRELLIS_E2E_STUB_LOCAL_REPLY;
const previousStubLocalReplyDelay = process.env.TRELLIS_E2E_STUB_LOCAL_REPLY_DELAY_MS;

process.env.TRELLIS_E2E_STUB_LOCAL_REPLY = "1";
process.env.TRELLIS_E2E_STUB_LOCAL_REPLY_DELAY_MS = "2500";

test.afterAll(() => {
  if (previousStubLocalReply === undefined) {
    delete process.env.TRELLIS_E2E_STUB_LOCAL_REPLY;
  } else {
    process.env.TRELLIS_E2E_STUB_LOCAL_REPLY = previousStubLocalReply;
  }

  if (previousStubLocalReplyDelay === undefined) {
    delete process.env.TRELLIS_E2E_STUB_LOCAL_REPLY_DELAY_MS;
  } else {
    process.env.TRELLIS_E2E_STUB_LOCAL_REPLY_DELAY_MS = previousStubLocalReplyDelay;
  }
});

test("runs up to three chats in parallel and releases the new chat cap", async ({ page }) => {
  await selectWorkspace(page, "preview");

  await page.evaluate(async () => {
    const settings = await window.trellis.app.getSettings();
    await window.trellis.app.updateSettings({
      ...settings,
      chat: {
        ...settings.chat,
        privacyMode: "local"
      }
    });
  });

  await page.reload();
  await expect(page.getByTestId("app-frame")).toBeVisible();
  await dismissLocalNoteProcessorFirstRun(page);

  const composer = page.getByPlaceholder("What are you thinking about?");
  const send = page.getByLabel("Send message");
  const newChat = page.getByTestId("chat-new-chat");

  await composer.fill("First parallel chat");
  await send.click();
  await expect(page.getByText("Running")).toBeVisible();

  await newChat.click();
  await composer.fill("Second parallel chat");
  await send.click();
  await expect(page.getByText("Running")).toHaveCount(2);

  await newChat.click();
  await composer.fill("Third parallel chat");
  await send.click();
  await expect(page.getByText("Running")).toHaveCount(3);

  await expect(newChat).toBeDisabled();
  await expect(newChat).toHaveAttribute(
    "title",
    "Three chats are already running. Wait for one to finish before starting another."
  );

  await expect(newChat).toBeEnabled({ timeout: 8_000 });
  await expect(page.getByText("Ready").first()).toBeVisible();
});
