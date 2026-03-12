import fs from "node:fs";
import path from "node:path";

function redactSecrets(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (["privateKey", "secret", "passphrase", "apiKey", "signature", "Authorization"].includes(k)) {
      out[k] = "***redacted***";
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out;
}

export class AuditLogger {
  constructor({ filePath = "./audit/polymarket-audit.log" } = {}) {
    this.filePath = path.resolve(process.cwd(), filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  write(event, payload = {}) {
    const entry = {
      ts: new Date().toISOString(),
      event,
      payload: redactSecrets(payload),
    };
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
    return entry;
  }
}
