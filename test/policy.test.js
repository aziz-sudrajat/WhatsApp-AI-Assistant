// Tests for policy primitives: rate limiter and takeover tracker.
// No network, no WhatsApp connection.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { RateLimiter } = require('../src/policy/rate');
const { TakeoverTracker } = require('../src/policy/takeover');

describe('RateLimiter', () => {
  it('allows up to the limit, then blocks within the window', () => {
    const limiter = new RateLimiter(3);
    const now = 1_000_000;
    assert.equal(limiter.allow('chat', now), true);
    assert.equal(limiter.allow('chat', now + 1000), true);
    assert.equal(limiter.allow('chat', now + 2000), true);
    assert.equal(limiter.allow('chat', now + 3000), false);
  });

  it('allows again after the window slides past', () => {
    const limiter = new RateLimiter(1);
    const now = 1_000_000;
    assert.equal(limiter.allow('chat', now), true);
    assert.equal(limiter.allow('chat', now + 1000), false);
    assert.equal(limiter.allow('chat', now + 61_000), true);
  });

  it('limits are per chat', () => {
    const limiter = new RateLimiter(1);
    assert.equal(limiter.allow('a', 1000), true);
    assert.equal(limiter.allow('b', 1000), true);
    assert.equal(limiter.allow('a', 1000), false);
  });

  it('rejects invalid limits', () => {
    assert.throws(() => new RateLimiter(0), /> 0/);
  });
});

describe('TakeoverTracker', () => {
  it('pauses a chat after takeover and releases it after cooldown', () => {
    const tracker = new TakeoverTracker(30 * 60_000);
    const now = 5_000_000;
    assert.equal(tracker.isPaused('chat', now), false);
    tracker.noteTakeover('chat', now);
    assert.equal(tracker.isPaused('chat', now + 1000), true);
    assert.equal(tracker.isPaused('chat', now + 31 * 60_000), false);
  });

  it('takeover in one chat does not pause others', () => {
    const tracker = new TakeoverTracker(30 * 60_000);
    tracker.noteTakeover('a', 1000);
    assert.equal(tracker.isPaused('a', 2000), true);
    assert.equal(tracker.isPaused('b', 2000), false);
  });
});
