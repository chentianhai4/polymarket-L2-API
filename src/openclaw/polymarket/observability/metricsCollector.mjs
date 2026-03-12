export class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
  }

  inc(name, value = 1, labels = undefined) {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name, value, labels = undefined) {
    const key = this.key(name, labels);
    const bucket = this.histograms.get(key) ?? [];
    bucket.push(value);
    this.histograms.set(key, bucket);
  }

  setGauge(name, value, labels = undefined) {
    const key = this.key(name, labels);
    this.gauges.set(key, value);
  }

  snapshot() {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries()),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([k, vals]) => [
          k,
          {
            count: vals.length,
            min: vals.length ? Math.min(...vals) : null,
            max: vals.length ? Math.max(...vals) : null,
            avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
          },
        ]),
      ),
    };
  }

  key(name, labels) {
    if (!labels || Object.keys(labels).length === 0) return name;
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${parts}}`;
  }
}
