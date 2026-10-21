// Test helper (not a test file): appends N drafts to a drafts file.
// Usage: node test/append-worker.js <draftsFile> <count> <prefix>
const { appendDraft } = require('../src/store/drafts');

const [file, countArg, prefix] = process.argv.slice(2);
const count = Number.parseInt(countArg, 10);
for (let i = 0; i < count; i++) {
  appendDraft(file, {
    chatId: 'c@s.whatsapp.net',
    incomingText: `${prefix}-${i}`,
    draftText: 'x',
  });
}
