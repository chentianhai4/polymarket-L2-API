export class RateLimiter {
  constructor({ requestsPerSecond = 10, concurrency = 4 } = {}) {
    this.capacity = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillIntervalMs = 1000;
    this.concurrency = concurrency;
    this.inFlight = 0;
    this.queue = [];
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;

    const toAdd = Math.floor((elapsed / this.refillIntervalMs) * this.capacity);
    if (toAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + toAdd);
      this.lastRefill = now;
    }
  }

  async schedule(task) {
    return await new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    this.refill();

    while (this.queue.length > 0 && this.tokens > 0 && this.inFlight < this.concurrency) {
      const job = this.queue.shift();
      this.tokens -= 1;
      this.inFlight += 1;

      Promise.resolve()
        .then(job.task)
        .then((result) => {
          this.inFlight -= 1;
          job.resolve(result);
          this.drain();
        })
        .catch((err) => {
          this.inFlight -= 1;
          job.reject(err);
          this.drain();
        });
    }

    if (this.queue.length > 0 && (this.tokens <= 0 || this.inFlight >= this.concurrency)) {
      setTimeout(() => this.drain(), 25);
    }
  }
}
