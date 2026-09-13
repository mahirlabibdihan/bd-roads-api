// No queue: disconnected callers must not leave an unbounded backlog in OSRM.
class UpstreamGate {
  constructor({ concurrency, cooldownMs, now = Date.now }) {
    this.concurrency = concurrency;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.active = 0;
    this.blockedUntil = 0;
  }

  async run(operation) {
    if (this.active >= this.concurrency || this.now() < this.blockedUntil) {
      const error = new Error("Map matching is busy; retry later");
      Object.assign(error, {
        status: 503,
        expose: true,
        retryAfter: Math.max(1, Math.ceil((this.blockedUntil - this.now()) / 1000)),
      });
      throw error;
    }
    this.active++;
    try {
      return await operation();
    } catch (error) {
      // A fetch timeout does not stop OSRM's computation. Stop admitting new work
      // for a while so retries cannot immediately fill every worker again.
      if (!error.status || error.status >= 500) {
        this.blockedUntil = this.now() + this.cooldownMs;
        error.retryAfter = Math.ceil(this.cooldownMs / 1000);
      }
      throw error;
    } finally {
      this.active--;
    }
  }
}

module.exports = { UpstreamGate };
