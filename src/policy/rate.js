// Per-chat sliding-window rate limiter: at most `maxPerMin` allowed
// events per chat per rolling 60-second window.

class RateLimiter {
  constructor(maxPerMin) {
    if (!(maxPerMin > 0)) {
      throw new Error('RateLimiter requires maxPerMin > 0.');
    }
    this.maxPerMin = maxPerMin;
    this.hits = new Map(); // chatId -> array of epoch ms
  }

  // Returns true when the event is allowed (and records it), false when
  // the chat is over its limit. `now` is injectable for tests.
  allow(chatId, now = Date.now()) {
    const windowStart = now - 60_000;
    const recent = (this.hits.get(chatId) || []).filter((t) => t > windowStart);
    if (recent.length >= this.maxPerMin) {
      this.hits.set(chatId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(chatId, recent);
    return true;
  }

  reset(chatId) {
    if (chatId) this.hits.delete(chatId);
    else this.hits.clear();
  }
}

module.exports = { RateLimiter };
