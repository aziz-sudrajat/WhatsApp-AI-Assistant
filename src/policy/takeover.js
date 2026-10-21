// Human takeover tracker: when the owner sends a message from their own
// phone in a chat, AI replies pause for that chat until the cooldown
// expires, so the human and the AI never talk over each other.

class TakeoverTracker {
  constructor(cooldownMs) {
    if (!(cooldownMs >= 0)) {
      throw new Error('TakeoverTracker requires cooldownMs >= 0.');
    }
    this.cooldownMs = cooldownMs;
    this.pausedUntil = new Map(); // chatId -> epoch ms
  }

  // Record a human message in a chat. Returns the pause expiry timestamp.
  noteTakeover(chatId, now = Date.now()) {
    const until = now + this.cooldownMs;
    this.pausedUntil.set(chatId, until);
    return until;
  }

  // True while the takeover cooldown for a chat is still active.
  isPaused(chatId, now = Date.now()) {
    const until = this.pausedUntil.get(chatId);
    if (!until) return false;
    if (now >= until) {
      this.pausedUntil.delete(chatId);
      return false;
    }
    return true;
  }
}

module.exports = { TakeoverTracker };
