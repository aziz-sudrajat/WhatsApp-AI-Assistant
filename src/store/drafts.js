// Draft store backed by a JSONL file (one draft object per line).
// Drafts are NEVER sent by this module; sending is the gateway's job, and
// only for drafts whose status is "approved".
//
// CONCURRENCY: the gateway process appends drafts while the owner may run
// `wa-ai approve-draft` in a second process, so every read-modify-write
// is serialized with a cross-process file lock (an atomic mkdir lock dir
// holding the owner's pid), and every write uses a unique temp file
// (pid + random) before an atomic rename. Readers therefore never see a
// torn file, and two writers can never lose each other's drafts. A lock
// left behind by a crashed process is reclaimed when its pid is dead (or
// the lock is older than LOCK_STALE_MS with no readable pid). A lock wait
// longer than LOCK_TIMEOUT_MS fails loudly instead of corrupting data.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 5;

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function lockDirFor(draftsFile) {
  return `${draftsFile}.lock`;
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Fallback spin when Atomics.wait is unavailable.
    }
  }
}

function tryAcquireLock(draftsFile) {
  const lockDir = lockDirFor(draftsFile);
  try {
    fs.mkdirSync(lockDir);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return false;
  }
  try {
    fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
  } catch {
    // The pid file is best-effort; staleness also falls back to lock age.
  }
  return true;
}

// True when the lock may be reclaimed: its owner pid is dead, or the lock
// has no readable pid and is older than LOCK_STALE_MS (a lock younger
// than that without a pid file is a holder that just created it).
function lockIsStale(draftsFile) {
  const lockDir = lockDirFor(draftsFile);
  try {
    const pid = Number.parseInt(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8'), 10);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return false; // owner alive
      } catch {
        return true; // owner dead
      }
    }
  } catch {
    // No pid file; fall through to the age check.
  }
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS;
  } catch {
    return true; // lock dir vanished
  }
}

function breakLock(draftsFile) {
  fs.rmSync(lockDirFor(draftsFile), { recursive: true, force: true });
}

function acquireLock(draftsFile) {
  ensureParent(draftsFile);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    if (tryAcquireLock(draftsFile)) return;
    if (lockIsStale(draftsFile)) {
      breakLock(draftsFile);
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for draft store lock on ${draftsFile}`);
    }
    sleepSync(LOCK_POLL_MS);
  }
}

// Release only a lock this process owns, so a stale-break race can never
// delete another process's live lock.
function releaseLock(draftsFile) {
  const lockDir = lockDirFor(draftsFile);
  try {
    const pid = Number.parseInt(fs.readFileSync(path.join(lockDir, 'pid'), 'utf8'), 10);
    if (pid === process.pid) fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Already gone; nothing to release.
  }
}

function withLock(draftsFile, fn) {
  acquireLock(draftsFile);
  try {
    return fn();
  } finally {
    releaseLock(draftsFile);
  }
}

function readDrafts(draftsFile) {
  if (!fs.existsSync(draftsFile)) return [];
  const drafts = [];
  for (const line of fs.readFileSync(draftsFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      drafts.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines; drafts must never crash the CLI.
    }
  }
  return drafts;
}

// Low-level writer: unique temp file + atomic rename. Callers must hold
// the lock (see writeDrafts, which takes it for external callers).
function writeDraftsUnlocked(draftsFile, drafts) {
  ensureParent(draftsFile);
  const tmp = `${draftsFile}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const body = drafts.map((d) => JSON.stringify(d)).join('\n');
  fs.writeFileSync(tmp, body ? `${body}\n` : '');
  fs.renameSync(tmp, draftsFile);
}

function writeDrafts(draftsFile, drafts) {
  return withLock(draftsFile, () => writeDraftsUnlocked(draftsFile, drafts));
}

function nextId(drafts) {
  const stamp = Date.now();
  return `draft-${stamp}-${drafts.length + 1}`;
}

// Create a pending draft. Returns the draft record.
function appendDraft(draftsFile, fields) {
  return withLock(draftsFile, () => {
    const drafts = readDrafts(draftsFile);
    const draft = {
      id: nextId(drafts),
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...fields,
    };
    drafts.push(draft);
    writeDraftsUnlocked(draftsFile, drafts);
    return draft;
  });
}

function listPending(draftsFile) {
  return readDrafts(draftsFile).filter((d) => d.status === 'pending');
}

// Mark a pending draft as approved. Returns the draft, or null if the id
// does not exist or is not pending. Approving does NOT send anything.
function approveDraft(draftsFile, id) {
  return withLock(draftsFile, () => {
    const drafts = readDrafts(draftsFile);
    const draft = drafts.find((d) => d.id === id);
    if (!draft || draft.status !== 'pending') return null;
    draft.status = 'approved';
    draft.approvedAt = new Date().toISOString();
    writeDraftsUnlocked(draftsFile, drafts);
    return draft;
  });
}

// Mark an approved draft as sent. Returns the draft, or null.
function markSent(draftsFile, id) {
  return withLock(draftsFile, () => {
    const drafts = readDrafts(draftsFile);
    const draft = drafts.find((d) => d.id === id);
    if (!draft || draft.status !== 'approved') return null;
    draft.status = 'sent';
    draft.sentAt = new Date().toISOString();
    writeDraftsUnlocked(draftsFile, drafts);
    return draft;
  });
}

module.exports = { readDrafts, writeDrafts, appendDraft, listPending, approveDraft, markSent };
