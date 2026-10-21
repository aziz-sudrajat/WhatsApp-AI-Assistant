// Global gateway state (paused flag). Stored as JSON, never contains
// secrets.

const fs = require('fs');
const path = require('path');

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) return { paused: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return { paused: false, ...parsed };
  } catch {
    return { paused: false };
  }
}

function writeState(stateFile, state) {
  ensureParent(stateFile);
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

function setPaused(stateFile, paused) {
  const state = readState(stateFile);
  state.paused = paused;
  return writeState(stateFile, state);
}

module.exports = { readState, writeState, setPaused };
