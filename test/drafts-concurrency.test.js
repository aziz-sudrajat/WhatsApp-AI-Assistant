// Regression tests for the draft store cross-process race (review fix 1).
// Two separate processes append/approve concurrently; no draft may be
// lost, no approval may be lost, and no process may crash. Previously
// the shared `${draftsFile}.tmp` temp file plus unlocked
// read-modify-write lost over half the drafts and crashed with ENOENT.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { readDrafts, listPending } = require('../src/store/drafts');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ai-conc-'));
}

function runWorker(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function assertCleanDir(dir, file) {
  assert.equal(fs.existsSync(`${file}.lock`), false, 'lock dir left behind');
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')),
    [],
    'stray temp files left behind'
  );
}

describe('draft store concurrency (review fix 1)', () => {
  it('two processes x 1000 appends lose nothing and never crash', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'drafts.jsonl');
    const results = await Promise.all([
      runWorker('append-worker.js', [file, '1000', 'A']),
      runWorker('append-worker.js', [file, '1000', 'B']),
    ]);
    for (const r of results) {
      assert.equal(r.code, 0, `worker crashed: ${r.stderr}`);
    }
    const drafts = readDrafts(file);
    assert.equal(drafts.length, 2000);
    assert.equal(new Set(drafts.map((d) => d.id)).size, 2000, 'duplicate draft ids');
    assert.equal(
      drafts.filter((d) => d.status === 'pending').length,
      2000
    );
    assertCleanDir(dir, file);
  });

  it('concurrent approvers lose no drafts and no approvals', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'drafts.jsonl');
    const results = await Promise.all([
      runWorker('append-worker.js', [file, '500', 'A']),
      runWorker('append-worker.js', [file, '500', 'B']),
    ]);
    for (const r of results) {
      assert.equal(r.code, 0, `appender crashed: ${r.stderr}`);
    }
    const ids = readDrafts(file).map((d) => d.id);
    assert.equal(ids.length, 1000);
    const half = Math.ceil(ids.length / 2);
    const idsA = path.join(dir, 'ids-a.json');
    const idsB = path.join(dir, 'ids-b.json');
    fs.writeFileSync(idsA, JSON.stringify(ids.slice(0, half)));
    fs.writeFileSync(idsB, JSON.stringify(ids.slice(half)));
    const approvals = await Promise.all([
      runWorker('approve-worker.js', [file, idsA]),
      runWorker('approve-worker.js', [file, idsB]),
    ]);
    for (const r of approvals) {
      assert.equal(r.code, 0, `approver crashed: ${r.stderr}`);
    }
    const after = readDrafts(file);
    assert.equal(after.length, 1000, 'drafts lost during concurrent approve');
    assert.equal(
      after.filter((d) => d.status === 'approved').length,
      1000,
      'approvals lost during concurrent approve'
    );
    assert.equal(listPending(file).length, 0);
    assertCleanDir(dir, file);
  });
});
