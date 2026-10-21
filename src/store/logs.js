// Structured JSONL logging. One line per event, one JSON object per line.

const fs = require('fs');
const path = require('path');

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

// Append one event object to a JSONL file. Adds an ISO timestamp.
function appendLog(logFile, entry) {
  ensureParent(logFile);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  fs.appendFileSync(logFile, `${line}\n`);
  return line;
}

// Read all events from a JSONL file. Malformed lines are skipped.
function readLogs(logFile) {
  if (!fs.existsSync(logFile)) return [];
  const events = [];
  for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines; logs must never crash the gateway.
    }
  }
  return events;
}

module.exports = { appendLog, readLogs };
