// Test helper (not a test file): approves the draft ids listed in a
// JSON file (one id per array element).
// Usage: node test/approve-worker.js <draftsFile> <idsJsonFile>
const fs = require('fs');
const { approveDraft } = require('../src/store/drafts');

const [file, idsFile] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
let approved = 0;
for (const id of ids) {
  if (approveDraft(file, id)) approved += 1;
}
console.log(approved);
