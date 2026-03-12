import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RateLimiter } from "./rateLimiter.mjs";
import { retryWithBackoff } from "./retry.mjs";
import { PolymarketError } from "../errors.mjs";

const execFileAsync = promisify(execFile);

function buildUrl(url, query = undefined) {
  if (!query || Object.keys(query).length === 0) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function parseBody(text) {
  if (text === "") return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitizeHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return 15000;
  return Math.floor(value);
}

export class HttpClient {
  constructor({
    rateLimit,
    retry,
    adapter = "fetch",
    fallbackToCurl = true,
    timeoutMs = 15000,
    proxyUrl = null,
  } = {}) {
    this.rateLimiter = new RateLimiter(rateLimit);
    this.retryOptions = retry ?? {};
    this.adapter = adapter;
    this.fallbackToCurl = fallbackToCurl;
    this.timeoutMs = normalizeTimeout(timeoutMs);
    this.proxyUrl = proxyUrl ? String(proxyUrl) : null;
  }

  async request({ method = "GET", url, headers, query, body }) {
    return await this.rateLimiter.schedule(async () => {
      return await retryWithBackoff(async () => {
        const mustUseCurl =
          this.adapter === "curl" ||
          (this.adapter === "fetch" && Boolean(this.proxyUrl));
        if (mustUseCurl) {
          return await this.requestByCurl({
            method,
            url,
            headers,
            query,
            body,
          });
        }

        try {
          return await this.requestByFetch({
            method,
            url,
            headers,
            query,
            body,
          });
        } catch (error) {
          if (!this.fallbackToCurl) throw error;
          return await this.requestByCurl({
            method,
            url,
            headers,
            query,
            body,
          });
        }
      }, this.retryOptions);
    });
  }

  async get(url, query = undefined, headers = undefined) {
    return await this.request({ method: "GET", url, query, headers });
  }

  async post(url, body = undefined, headers = undefined, query = undefined) {
    return await this.request({ method: "POST", url, body, query, headers });
  }

  async put(url, body = undefined, headers = undefined, query = undefined) {
    return await this.request({ method: "PUT", url, body, query, headers });
  }

  async del(url, headers = undefined, query = undefined) {
    return await this.request({ method: "DELETE", url, headers, query });
  }

  async requestByFetch({ method, url, headers, query, body }) {
    const finalUrl = buildUrl(url, query);
    const requestHeaders = sanitizeHeaders(headers);
    const hasBody = body !== undefined && body !== null;
    if (hasBody && !requestHeaders["Content-Type"]) {
      requestHeaders["Content-Type"] = "application/json";
    }

    // If body is already a string (pre-serialised by caller, e.g. for HMAC
    // consistency), send it as-is; otherwise JSON.stringify the object.
    const serializedBody = hasBody
      ? typeof body === "string"
        ? body
        : JSON.stringify(body)
      : undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(finalUrl, {
        method,
        headers: requestHeaders,
        body: serializedBody,
        signal: controller.signal,
      });
    } catch (error) {
      const isTimeout = controller.signal.aborted;
      const wrapped = new PolymarketError(
        `${isTimeout ? "Request timeout" : "Request failed"} ${method} ${finalUrl}`,
        {
          status: 0,
          timeoutMs: this.timeoutMs,
          cause: error?.message ?? String(error),
        },
      );
      wrapped.status = 0;
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = parseBody(text);

    if (!res.ok) {
      const error = new PolymarketError(
        `HTTP ${res.status} ${method} ${finalUrl}`,
        {
          status: res.status,
          body: parsed,
        },
      );
      error.status = res.status;
      throw error;
    }

    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      data: parsed,
    };
  }

  async requestByCurl({ method, url, headers, query, body }) {
    const finalUrl = buildUrl(url, query);
    const args = [
      "-sS",
      "--max-time",
      String(Math.max(1, Math.ceil(this.timeoutMs / 1000))),
      "-X",
      method,
      finalUrl,
      "-w",
      "\\n%{http_code}",
    ];

    if (this.proxyUrl) {
      const lowerProxy = this.proxyUrl.toLowerCase();
      if (lowerProxy.startsWith("socks5://")) {
        args.unshift("--socks5-hostname", this.proxyUrl);
      } else if (lowerProxy.startsWith("socks4://")) {
        args.unshift("--socks4", this.proxyUrl);
      } else {
        args.unshift("-x", this.proxyUrl);
      }
    }

    const sanitizedHeaders = sanitizeHeaders(headers);
    for (const [k, v] of Object.entries(sanitizedHeaders)) {
      args.push("-H", `${k}: ${v}`);
    }

    if (body !== undefined && body !== null) {
      // Only add Content-Type if the caller hasn't already provided it.
      const hasContentType = Object.keys(sanitizedHeaders).some(
        (k) => k.toLowerCase() === "content-type",
      );
      if (!hasContentType) {
        args.push("-H", "Content-Type: application/json");
      }
      // If body is already a string (pre-serialised for HMAC), send as-is.
      args.push("-d", typeof body === "string" ? body : JSON.stringify(body));
    }

    let stdout = "";
    let stderr = "";
    try {
      const res = await execFileAsync("curl", args, {
        maxBuffer: 1024 * 1024 * 8,
        timeout: this.timeoutMs + 1000,
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (error) {
      const safeStderr = String(error?.stderr ?? "");
      const cause = error?.killed
        ? `curl timed out after ${this.timeoutMs}ms`
        : `curl exited with code ${String(error?.code ?? "ERR")}`;
      const wrapped = new PolymarketError(`HTTP ERR ${method} ${finalUrl}`, {
        status: 0,
        timeoutMs: this.timeoutMs,
        cause,
        stderr: safeStderr,
      });
      wrapped.status = 0;
      throw wrapped;
    }

    const output = String(stdout);
    const splitAt = output.lastIndexOf("\n");
    const bodyText = splitAt >= 0 ? output.slice(0, splitAt) : output;
    const statusText = splitAt >= 0 ? output.slice(splitAt + 1).trim() : "0";
    const status = Number(statusText);
    const parsed = parseBody(bodyText);

    if (!status || status >= 400) {
      const error = new PolymarketError(
        `HTTP ${status || "ERR"} ${method} ${finalUrl}`,
        {
          status,
          body: parsed,
          stderr,
        },
      );
      error.status = status;
      throw error;
    }

    return {
      status,
      headers: {},
      data: parsed,
    };
  }
}
