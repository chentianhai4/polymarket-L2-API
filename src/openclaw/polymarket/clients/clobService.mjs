import { Wallet } from "ethers";
import axios from "axios";
import {
  AssetType,
  ClobClient,
  OrderType,
  Side,
  getContractConfig,
  createL1Headers,
  createL2Headers,
} from "@polymarket/clob-client";
import { ExchangeOrderBuilder } from "@polymarket/order-utils";
import {
  normalizeApiCreds,
  hasApiCreds,
  normalizeBalanceAllowance,
} from "../types.mjs";
import { HttpClient } from "../http/httpClient.mjs";
import { AuthError, PolymarketError, ValidationError } from "../errors.mjs";

function pickData(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function hasErrorField(payload) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error,
  );
}

function ensureArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function isBalanceAllowanceShape(payload) {
  if (!payload || typeof payload !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(payload, "balance") ||
    Object.prototype.hasOwnProperty.call(payload, "allowances")
  );
}

function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return 15000;
  return Math.floor(value);
}

function parseAxiosProxy(proxyUrl) {
  if (!proxyUrl) return null;

  try {
    const url = new URL(proxyUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const proxy = {
      protocol: url.protocol.slice(0, -1),
      host: url.hostname,
    };

    if (url.port) proxy.port = Number(url.port);
    if (url.username || url.password) {
      proxy.auth = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    }
    return proxy;
  } catch {
    return null;
  }
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "1") return true;
    if (lowered === "false" || lowered === "0") return false;
  }
  return null;
}

function extractTickSize(payload) {
  if (
    isPresent(payload) &&
    (typeof payload === "string" || typeof payload === "number")
  ) {
    return payload;
  }
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.minimum_tick_size ??
    payload.tick_size ??
    payload.tickSize ??
    payload.min_tick_size ??
    null
  );
}

function extractFeeRate(payload) {
  if (typeof payload === "number") return payload;
  if (!payload || typeof payload !== "object") return null;
  return payload.base_fee ?? payload.fee_rate_bps ?? payload.feeRateBps ?? null;
}

function extractNegRisk(payload) {
  if (typeof payload === "boolean") return payload;
  if (!payload || typeof payload !== "object") return normalizeBoolean(payload);
  return normalizeBoolean(
    payload.neg_risk ?? payload.negRisk ?? payload.value ?? null,
  );
}

function isValidOrderBook(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (hasErrorField(payload)) return false;
  return (
    Array.isArray(payload.bids) ||
    Array.isArray(payload.asks) ||
    isPresent(payload.asset_id) ||
    isPresent(payload.market) ||
    isPresent(payload.tick_size) ||
    isPresent(payload.minimum_tick_size)
  );
}

function isValidPrice(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (hasErrorField(payload)) return false;
  return isPresent(payload.price);
}

function isValidMidpoint(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (hasErrorField(payload)) return false;
  return (
    isPresent(payload.mid) ||
    isPresent(payload.midpoint) ||
    isPresent(payload.price)
  );
}

function isValidSpread(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (hasErrorField(payload)) return false;
  return isPresent(payload.spread);
}

export class ClobService {
  constructor({
    config,
    privateKey,
    signatureType = 2,
    funderAddress,
    geoBlockToken,
    useServerTime = false,
    builderConfig,
    auditLogger,
  }) {
    if (!privateKey) throw new ValidationError("privateKey is required");

    this.config = config;
    this.privateKey = privateKey;
    this.signatureType = signatureType;
    this.funderAddress = funderAddress;
    this.geoBlockToken = geoBlockToken;
    this.useServerTime = useServerTime;
    this.builderConfig = builderConfig;
    this._auditLogger = auditLogger ?? null;
    this.requestTimeoutMs = normalizeTimeout(config.requestTimeoutMs);
    this.proxyUrl = config.proxyUrl ? String(config.proxyUrl) : null;

    this.signer = new Wallet(privateKey);
    this.creds = null;
    this.configureAxiosDefaults();

    this.http = new HttpClient({
      rateLimit: config.rateLimits.clob,
      retry: config.retry,
      adapter: "fetch",
      fallbackToCurl: true,
      timeoutMs: this.requestTimeoutMs,
      proxyUrl: this.proxyUrl,
    });

    this.client = this.wrapClient(this.buildClient());
  }

  isProxyMode() {
    return Boolean(this.proxyUrl);
  }

  setTickCache(tokenID, tick, client = this.client) {
    const token = String(tokenID);
    const value = String(tick);
    if (!client.tickSizes || typeof client.tickSizes !== "object") {
      client.tickSizes = {};
    }
    if (
      !client.tickSizeTimestamps ||
      typeof client.tickSizeTimestamps !== "object"
    ) {
      client.tickSizeTimestamps = {};
    }
    client.tickSizes[token] = value;
    client.tickSizeTimestamps[token] = Date.now();
  }

  setFeeRateCache(tokenID, feeRateBps, client = this.client) {
    const token = String(tokenID);
    if (!client.feeRates || typeof client.feeRates !== "object") {
      client.feeRates = {};
    }
    client.feeRates[token] = Number(feeRateBps);
  }

  setNegRiskCache(tokenID, negRisk, client = this.client) {
    const token = String(tokenID);
    if (!client.negRisk || typeof client.negRisk !== "object") {
      client.negRisk = {};
    }
    client.negRisk[token] = Boolean(negRisk);
  }

  updateTickCacheFromOrderBook(book) {
    const tokenID = book?.asset_id ?? book?.token_id ?? book?.tokenId;
    const tick = extractTickSize(book);
    if (!tokenID || !isPresent(tick)) return;
    this.setTickCache(tokenID, tick);
  }

  async getPublicClob(path, query = undefined) {
    const res = await this.http.get(`${this.config.clobHost}${path}`, query, {
      Accept: "application/json",
    });
    return pickData(res);
  }

  async resolveWithFallback({
    attempts,
    validate,
    normalize = (x) => x,
    errorMessage,
  }) {
    let lastError = null;
    for (const attempt of attempts) {
      try {
        const value = await attempt();
        if (validate(value)) {
          return normalize(value);
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    throw new ValidationError(errorMessage);
  }

  getAttemptOrder(sdkAttempt, httpAttempt) {
    return this.isProxyMode()
      ? [httpAttempt, sdkAttempt]
      : [sdkAttempt, httpAttempt];
  }

  resolveClientHttpRequest(endpoint, options = undefined) {
    const baseUrl = this.config?.clobHost ?? "https://clob.polymarket.com";
    const url = new URL(String(endpoint), baseUrl);
    const params = { ...(options?.params ?? {}) };
    for (const [key, value] of url.searchParams.entries()) {
      if (!(key in params)) {
        params[key] = value;
      }
    }
    if (this.geoBlockToken && params.geo_block_token === undefined) {
      params.geo_block_token = this.geoBlockToken;
    }
    return {
      url: url.toString(),
      query: params,
      headers: options?.headers,
      body: options?.data,
    };
  }

  async callHttpForClientMethod(method, endpoint, options = undefined) {
    const request = this.resolveClientHttpRequest(endpoint, options);
    if (method === "get") {
      const response = await this.http.get(
        request.url,
        request.query,
        request.headers,
      );
      return pickData(response);
    }
    if (method === "post") {
      const response = await this.http.post(
        request.url,
        request.body,
        request.headers,
        request.query,
      );
      return pickData(response);
    }
    if (method === "put") {
      const response = await this.http.put(
        request.url,
        request.body,
        request.headers,
        request.query,
      );
      return pickData(response);
    }
    if (method === "del") {
      const response = await this.http.del(
        request.url,
        request.headers,
        request.query,
      );
      return pickData(response);
    }
    throw new ValidationError(`Unsupported HTTP method override: ${method}`);
  }

  isOrderSubmissionEndpoint(endpoint) {
    try {
      const url = new URL(
        String(endpoint),
        this.config?.clobHost ?? "https://clob.polymarket.com",
      );
      const path = url.pathname.toLowerCase();
      return path.endsWith("/order") || path.endsWith("/orders");
    } catch {
      return false;
    }
  }

  markInvalidSubmissionPayload(
    payload,
    operation = undefined,
    endpoint = undefined,
  ) {
    return {
      __openclawInvalidSubmission: true,
      operation,
      endpoint,
      initialPayload: payload ?? null,
    };
  }

  extractSubmissionError(payload) {
    if (payload === undefined || payload === null) return null;

    if (typeof payload === "string") {
      const text = payload.trim();
      if (!text) return null;
      if (
        (text.startsWith("{") && text.endsWith("}")) ||
        (text.startsWith("[") && text.endsWith("]"))
      ) {
        try {
          return this.extractSubmissionError(JSON.parse(text));
        } catch {
          return null;
        }
      }
      return null;
    }

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const extracted = this.extractSubmissionError(item);
        if (extracted) return extracted;
      }
      return null;
    }

    if (typeof payload !== "object") return null;
    if (payload.__openclawInvalidSubmission) return null;

    const status = Number(
      payload.status ?? payload.statusCode ?? payload.httpStatus ?? NaN,
    );
    const hasHardFailure =
      hasErrorField(payload) ||
      payload.success === false ||
      payload.ok === false ||
      (Number.isFinite(status) && status >= 400);

    if (hasHardFailure) {
      const errorMessage =
        payload?.error?.message ??
        payload?.error_description ??
        payload?.message ??
        (typeof payload?.error === "string" ? payload.error : null) ??
        (Number.isFinite(status)
          ? `HTTP ${status}`
          : "Order submission rejected");

      return {
        message: String(errorMessage),
        status: Number.isFinite(status) ? status : undefined,
        code:
          payload.code ??
          payload.errorCode ??
          payload?.error?.code ??
          undefined,
      };
    }

    const nested =
      payload.response ??
      payload.data ??
      payload.result ??
      payload.exchange ??
      payload.initialPayload ??
      payload.body;
    if (nested && nested !== payload) {
      return this.extractSubmissionError(nested);
    }

    return null;
  }

  extractOrderIds(payload) {
    const out = [];
    const seen = new Set();

    const pushValue = (value) => {
      if (Array.isArray(value)) {
        for (const item of value) pushValue(item);
        return;
      }
      if (value === undefined || value === null) return;
      const normalized = String(value).trim();
      if (!normalized) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    const readObject = (value, depth = 0) => {
      if (depth > 5 || value === undefined || value === null) return;
      if (Array.isArray(value)) {
        for (const item of value) readObject(item, depth + 1);
        return;
      }
      if (typeof value !== "object") {
        if (depth === 0) pushValue(value);
        return;
      }

      pushValue(value.orderID);
      pushValue(value.orderId);
      pushValue(value.order_id);
      pushValue(value.id);
      pushValue(value.orderHash);
      pushValue(value.order_hash);
      pushValue(value.hash);
      pushValue(value.orderIDs);
      pushValue(value.orderIds);
      pushValue(value.order_ids);

      if (value.data !== undefined) readObject(value.data, depth + 1);
      if (value.result !== undefined) readObject(value.result, depth + 1);
      if (value.order !== undefined) readObject(value.order, depth + 1);
      if (value.orders !== undefined) readObject(value.orders, depth + 1);
      if (value.response !== undefined) readObject(value.response, depth + 1);
      if (value.exchange !== undefined) readObject(value.exchange, depth + 1);
      if (value.initialPayload !== undefined)
        readObject(value.initialPayload, depth + 1);
    };

    readObject(payload, 0);
    return out;
  }

  isInvalidOrderSubmissionPayload(payload) {
    if (payload?.__openclawInvalidSubmission === true) return true;
    if (payload === undefined || payload === null) return true;
    if (typeof payload === "string") return payload.trim() === "";
    if (Array.isArray(payload)) return payload.length === 0;
    if (typeof payload !== "object") return true;
    if (Object.keys(payload).length === 0) return true;
    if (payload.data === "") return true;
    return false;
  }

  normalizeOrderSubmissionPayload(
    payload,
    operation = "order.submit",
    endpoint = undefined,
  ) {
    const submissionError = this.extractSubmissionError(payload);
    if (submissionError) {
      const error = new PolymarketError(submissionError.message, {
        code: submissionError.code ?? "ORDER_SUBMISSION_REJECTED",
        operation,
        endpoint,
        status: submissionError.status ?? 0,
        submissionError,
        initialPayload: payload ?? null,
      });
      error.status = submissionError.status ?? 0;
      throw error;
    }

    if (this.isInvalidOrderSubmissionPayload(payload)) {
      return this.markInvalidSubmissionPayload(payload, operation, endpoint);
    }

    return payload;
  }

  buildClient(creds = undefined) {
    const client = new ClobClient(
      this.config.clobHost,
      this.config.chainId,
      this.signer,
      creds,
      this.signatureType,
      this.funderAddress,
      this.geoBlockToken,
      this.useServerTime,
      this.builderConfig,
    );

    const originalGet = client.get?.bind(client);
    const originalPost = client.post?.bind(client);
    const originalPut = client.put?.bind(client);
    const originalDel = client.del?.bind(client);
    const originalGetTickSize = client.getTickSize?.bind(client);
    const originalGetFeeRateBps = client.getFeeRateBps?.bind(client);
    const originalGetNegRisk = client.getNegRisk?.bind(client);

    const getPublic = async (path, params) => {
      return await this.getPublicClob(path, params);
    };

    const patchTransportMethod = (method, originalFn) => {
      if (typeof originalFn !== "function") return;

      client[method] = async (endpoint, options = undefined) => {
        let lastError = null;
        let lastInvalidSubmission = null;
        // In proxy mode, SDK's native axios does NOT honour our proxy,
        // so skip the "sdk" transport for order-submission endpoints
        // (they will always fail or return empty behind a geo-block).
        const isOrderEndpoint = this.isOrderSubmissionEndpoint(endpoint);
        const attempts = this.isProxyMode()
          ? isOrderEndpoint
            ? ["http"]
            : ["http", "sdk"]
          : ["sdk", "http"];

        for (const mode of attempts) {
          try {
            const payload =
              mode === "http"
                ? await this.callHttpForClientMethod(method, endpoint, options)
                : await originalFn(endpoint, options);
            if (
              isOrderEndpoint &&
              this.isInvalidOrderSubmissionPayload(payload)
            ) {
              lastInvalidSubmission = this.markInvalidSubmissionPayload(
                payload,
                `client.${method}.${mode}`,
                String(endpoint),
              );
              continue;
            }
            return payload;
          } catch (error) {
            lastError = error;
          }
        }

        // If every transport mode returned an invalid/empty submission
        // payload, throw instead of silently returning the marker object.
        // This lets the execution engine correctly record the fallback
        // as "failed" and surface the real error to the user.
        if (lastInvalidSubmission) {
          const error = new PolymarketError(
            `Order submission returned invalid/empty payload on all transport modes (${attempts.join(", ")})`,
            {
              code: "ORDER_SUBMISSION_ALL_INVALID",
              invalidSubmission: lastInvalidSubmission,
              lastError: lastError?.message ?? null,
            },
          );
          error.status = lastError?.status ?? 0;
          throw error;
        }
        throw (
          lastError ??
          new PolymarketError(
            `Failed clob ${method.toUpperCase()} ${String(endpoint)}`,
          )
        );
      };
    };

    patchTransportMethod("get", originalGet);
    patchTransportMethod("post", originalPost);
    patchTransportMethod("put", originalPut);
    patchTransportMethod("del", originalDel);

    client.getTickSize = async (tokenID) => {
      let lastError = null;
      const attempts = this.isProxyMode() ? ["http", "sdk"] : ["sdk", "http"];

      for (const mode of attempts) {
        try {
          const result =
            mode === "http"
              ? await getPublic("/tick-size", { token_id: tokenID })
              : await originalGetTickSize(tokenID);
          const tick = extractTickSize(result);
          if (!isPresent(tick)) {
            throw new ValidationError(`Tick size missing for token ${tokenID}`);
          }
          this.setTickCache(tokenID, tick, client);
          return String(tick);
        } catch (error) {
          lastError = error;
        }
      }

      throw (
        lastError ??
        new ValidationError(`Unable to resolve tick size for token ${tokenID}`)
      );
    };

    client.getFeeRateBps = async (tokenID) => {
      const token = String(tokenID);
      if (client.feeRates && token in client.feeRates) {
        return client.feeRates[token];
      }

      let lastError = null;
      const attempts = this.isProxyMode() ? ["http", "sdk"] : ["sdk", "http"];
      for (const mode of attempts) {
        try {
          const result =
            mode === "http"
              ? await getPublic("/fee-rate", { token_id: tokenID })
              : await originalGetFeeRateBps(tokenID);
          const feeRateBps = extractFeeRate(result);
          if (!isPresent(feeRateBps)) {
            throw new ValidationError(`Fee rate missing for token ${tokenID}`);
          }
          this.setFeeRateCache(tokenID, feeRateBps, client);
          return client.feeRates[token];
        } catch (error) {
          lastError = error;
        }
      }

      throw (
        lastError ??
        new ValidationError(`Unable to resolve fee rate for token ${tokenID}`)
      );
    };

    client.getNegRisk = async (tokenID) => {
      const token = String(tokenID);
      if (client.negRisk && token in client.negRisk) {
        return client.negRisk[token];
      }

      let lastError = null;
      const attempts = this.isProxyMode() ? ["http", "sdk"] : ["sdk", "http"];
      for (const mode of attempts) {
        try {
          const result =
            mode === "http"
              ? await getPublic("/neg-risk", { token_id: tokenID })
              : await originalGetNegRisk(tokenID);
          const negRisk = extractNegRisk(result);
          if (negRisk === null) {
            throw new ValidationError(`Neg-risk missing for token ${tokenID}`);
          }
          this.setNegRiskCache(tokenID, negRisk, client);
          return client.negRisk[token];
        } catch (error) {
          lastError = error;
        }
      }

      throw (
        lastError ??
        new ValidationError(`Unable to resolve neg-risk for token ${tokenID}`)
      );
    };

    return client;
  }

  configureAxiosDefaults() {
    axios.defaults.timeout = this.requestTimeoutMs;

    if (!this.proxyUrl) return;

    process.env.HTTPS_PROXY = this.proxyUrl;
    process.env.HTTP_PROXY = this.proxyUrl;
    if (!process.env.https_proxy) process.env.https_proxy = this.proxyUrl;
    if (!process.env.http_proxy) process.env.http_proxy = this.proxyUrl;

    const proxy = parseAxiosProxy(this.proxyUrl);
    if (proxy) {
      axios.defaults.proxy = proxy;
    }
  }

  wrapClient(client) {
    const self = this;
    return new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;

        return (...args) => {
          return self.withRequestTimeout(`clob.${String(prop)}`, async () => {
            return await value.apply(target, args);
          });
        };
      },
    });
  }

  async withRequestTimeout(operation, fn) {
    const timeoutMs = this.requestTimeoutMs;

    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new PolymarketError(
          `Request timeout after ${timeoutMs}ms (${operation})`,
          {
            status: 0,
            operation,
            timeoutMs,
          },
        );
        err.status = 0;
        reject(err);
      }, timeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve().then(fn), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  setApiCreds(creds) {
    const normalized = normalizeApiCreds(creds);
    if (!hasApiCreds(normalized)) {
      throw new ValidationError("Invalid L2 API creds");
    }
    this.creds = normalized;
    this.client = this.wrapClient(this.buildClient(normalized));
    return normalized;
  }

  getApiCreds() {
    return this.creds;
  }

  async getSignerAddress() {
    return await this.signer.getAddress();
  }

  async createApiKey(nonce = undefined) {
    const fromClient = normalizeApiCreds(await this.client.createApiKey(nonce));
    if (hasApiCreds(fromClient)) return fromClient;
    return await this.createApiKeyFallback(nonce);
  }

  async deriveApiKey(nonce = undefined) {
    const fromClient = normalizeApiCreds(await this.client.deriveApiKey(nonce));
    if (hasApiCreds(fromClient)) return fromClient;
    return await this.deriveApiKeyFallback(nonce);
  }

  async createOrDeriveApiKey(nonce = undefined) {
    const created = await this.createApiKey(nonce).catch(() => null);
    if (created && hasApiCreds(created)) return created;

    const derived = await this.deriveApiKey(nonce);
    if (!hasApiCreds(derived)) {
      throw new AuthError("Failed to create or derive api key", {
        created,
        derived,
      });
    }
    return derived;
  }

  async createApiKeyFallback(nonce = undefined) {
    const headers = await createL1Headers(
      this.signer,
      this.config.chainId,
      nonce,
    );
    const res = await this.http.post(
      `${this.config.clobHost}/auth/api-key`,
      undefined,
      {
        ...headers,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    );

    return normalizeApiCreds(pickData(res));
  }

  async deriveApiKeyFallback(nonce = undefined) {
    const headers = await createL1Headers(
      this.signer,
      this.config.chainId,
      nonce,
    );
    const res = await this.http.get(
      `${this.config.clobHost}/auth/derive-api-key`,
      undefined,
      {
        ...headers,
        Accept: "application/json",
      },
    );
    return normalizeApiCreds(pickData(res));
  }

  async getApiKeys() {
    const endpoint = "/auth/api-keys";
    try {
      const res = await this.client.getApiKeys();
      if (res && typeof res === "object" && Array.isArray(res.apiKeys)) {
        return res;
      }
      if (res && typeof res === "object" && res.error) {
        throw new AuthError(String(res.error), {
          status: res.status,
          response: res,
        });
      }
    } catch (error) {
      // Fallback below.
    }

    const headers = await this.createL2Headers(endpoint, "GET");
    const res = await this.http.get(
      `${this.config.clobHost}${endpoint}`,
      undefined,
      {
        ...headers,
        Accept: "application/json",
      },
    );
    return pickData(res);
  }

  async deleteApiKey() {
    return await this.client.deleteApiKey();
  }

  async createReadonlyApiKey() {
    return await this.client.createReadonlyApiKey();
  }

  async getReadonlyApiKeys() {
    return await this.client.getReadonlyApiKeys();
  }

  async deleteReadonlyApiKey(key) {
    return await this.client.deleteReadonlyApiKey(key);
  }

  async validateReadonlyApiKey(address, key) {
    return await this.client.validateReadonlyApiKey(address, key);
  }

  async getClosedOnlyMode() {
    return await this.client.getClosedOnlyMode();
  }

  async getServerTime() {
    return await this.client.getServerTime();
  }

  async getOrderBook(tokenID) {
    const sdkAttempt = async () => {
      const response = await this.client.getOrderBook(tokenID);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    };
    const httpAttempt = async () =>
      await this.getPublicClob("/book", { token_id: tokenID });

    return await this.resolveWithFallback({
      attempts: this.getAttemptOrder(sdkAttempt, httpAttempt),
      validate: isValidOrderBook,
      normalize: (book) => {
        this.updateTickCacheFromOrderBook(book);
        return book;
      },
      errorMessage: `Unable to resolve order book for token ${tokenID}`,
    });
  }

  async getOrderBooks(params) {
    return await this.client.getOrderBooks(params);
  }

  async getPrice(tokenID, side) {
    const sdkAttempt = async () => {
      const response = await this.client.getPrice(tokenID, side);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    };
    const httpAttempt = async () =>
      await this.getPublicClob("/price", { token_id: tokenID, side });

    return await this.resolveWithFallback({
      attempts: this.getAttemptOrder(sdkAttempt, httpAttempt),
      validate: isValidPrice,
      errorMessage: `Unable to resolve price for token ${tokenID}`,
    });
  }

  async getPrices(params) {
    return await this.client.getPrices(params);
  }

  async getMidpoint(tokenID) {
    const sdkAttempt = async () => {
      const response = await this.client.getMidpoint(tokenID);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    };
    const httpAttempt = async () =>
      await this.getPublicClob("/midpoint", { token_id: tokenID });

    return await this.resolveWithFallback({
      attempts: this.getAttemptOrder(sdkAttempt, httpAttempt),
      validate: isValidMidpoint,
      errorMessage: `Unable to resolve midpoint for token ${tokenID}`,
    });
  }

  async getMidpoints(params) {
    return await this.client.getMidpoints(params);
  }

  async getSpread(tokenID) {
    const sdkAttempt = async () => {
      const response = await this.client.getSpread(tokenID);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    };
    const httpAttempt = async () =>
      await this.getPublicClob("/spread", { token_id: tokenID });

    return await this.resolveWithFallback({
      attempts: this.getAttemptOrder(sdkAttempt, httpAttempt),
      validate: isValidSpread,
      errorMessage: `Unable to resolve spread for token ${tokenID}`,
    });
  }

  async getSpreads(params) {
    return await this.client.getSpreads(params);
  }

  async getLastTradePrice(tokenID) {
    return await this.client.getLastTradePrice(tokenID);
  }

  async getLastTradesPrices(params) {
    return await this.client.getLastTradesPrices(params);
  }

  async getPricesHistory(params) {
    return await this.client.getPricesHistory(params);
  }

  async getTickSize(tokenID) {
    const sdkAttempt = async () => await this.client.getTickSize(tokenID);
    const httpAttempt = async () =>
      await this.getPublicClob("/tick-size", { token_id: tokenID });
    const bookAttempt = async () => await this.getOrderBook(tokenID);
    const attempts = this.isProxyMode()
      ? [httpAttempt, sdkAttempt, bookAttempt]
      : [sdkAttempt, httpAttempt, bookAttempt];

    return await this.resolveWithFallback({
      attempts,
      validate: (payload) => isPresent(extractTickSize(payload)),
      normalize: (payload) => {
        const tick = extractTickSize(payload);
        this.setTickCache(tokenID, tick);
        return tick;
      },
      errorMessage: `Unable to resolve tick size for token ${tokenID}`,
    });
  }

  async getFeeRateBps(tokenID) {
    const sdkAttempt = async () => {
      const response = await this.client.getFeeRateBps(tokenID);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    };
    const httpAttempt = async () =>
      await this.getPublicClob("/fee-rate", { token_id: tokenID });

    return await this.resolveWithFallback({
      attempts: this.getAttemptOrder(sdkAttempt, httpAttempt),
      validate: (payload) => isPresent(extractFeeRate(payload)),
      normalize: (payload) => {
        const feeRate = extractFeeRate(payload);
        this.setFeeRateCache(tokenID, feeRate);
        return feeRate;
      },
      errorMessage: `Unable to resolve fee rate for token ${tokenID}`,
    });
  }

  async getNegRisk(tokenID) {
    const sdkAttempt = async () => {
      const response = await this.client.getNegRisk(tokenID);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    };
    const httpAttempt = async () =>
      await this.getPublicClob("/neg-risk", { token_id: tokenID });

    return await this.resolveWithFallback({
      attempts: this.getAttemptOrder(sdkAttempt, httpAttempt),
      validate: (payload) => extractNegRisk(payload) !== null,
      normalize: (payload) => {
        const negRisk = extractNegRisk(payload);
        this.setNegRiskCache(tokenID, negRisk);
        return negRisk;
      },
      errorMessage: `Unable to resolve neg-risk for token ${tokenID}`,
    });
  }

  async getMarket(conditionID) {
    return await this.client.getMarket(conditionID);
  }

  async getMarkets(nextCursor = undefined) {
    return await this.client.getMarkets(nextCursor);
  }

  async getSamplingMarkets(nextCursor = undefined) {
    return await this.client.getSamplingMarkets(nextCursor);
  }

  async getSamplingSimplifiedMarkets(nextCursor = undefined) {
    return await this.client.getSamplingSimplifiedMarkets(nextCursor);
  }

  async getSimplifiedMarkets(nextCursor = undefined) {
    return await this.client.getSimplifiedMarkets(nextCursor);
  }

  async updateBalanceAllowance(params = { asset_type: AssetType.COLLATERAL }) {
    const callFallback = async () => {
      const endpoint = "/balance-allowance/update";
      const headers = await this.createL2Headers(endpoint, "GET");
      const query = {
        ...params,
        signature_type: this.signatureType,
        funder: this.funderAddress,
      };
      const res = await this.http.get(
        `${this.config.clobHost}${endpoint}`,
        query,
        {
          ...headers,
          Accept: "application/json",
        },
      );
      return pickData(res);
    };

    // In proxied environments SDK requests can return a late empty payload ("")
    // even when the endpoint is reachable. Prefer deterministic HTTP fallback there.
    if (this.proxyUrl) {
      return await callFallback();
    }

    try {
      const res = await this.client.updateBalanceAllowance(params);
      if (!(res && typeof res === "object" && res.error) && res !== "") {
        return res;
      }
      throw new PolymarketError(
        String(res?.error ?? "Empty update balance response"),
        { status: res?.status, response: res },
      );
    } catch (error) {
      return await callFallback();
    }
  }

  async getBalanceAllowance(params = { asset_type: AssetType.COLLATERAL }) {
    const callFallback = async () => {
      const endpoint = "/balance-allowance";
      const headers = await this.createL2Headers(endpoint, "GET");
      const query = {
        ...params,
        signature_type: this.signatureType,
        funder: this.funderAddress,
      };
      const res = await this.http.get(
        `${this.config.clobHost}${endpoint}`,
        query,
        {
          ...headers,
          Accept: "application/json",
        },
      );
      return normalizeBalanceAllowance(pickData(res));
    };

    if (this.proxyUrl) {
      return await callFallback();
    }

    try {
      const response = await this.client.getBalanceAllowance(params);
      if (response && typeof response === "object" && response.error) {
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      }
      if (!isBalanceAllowanceShape(response)) {
        throw new PolymarketError("Invalid balance allowance response shape", {
          response,
        });
      }
      return normalizeBalanceAllowance(response);
    } catch (error) {
      return await callFallback();
    }
  }

  async getNotifications() {
    try {
      const response = await this.client.getNotifications();
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    } catch {
      const endpoint = "/notifications";
      const headers = await this.createL2Headers(endpoint, "GET");
      const query = {
        signature_type: this.signatureType,
      };
      const res = await this.http.get(
        `${this.config.clobHost}${endpoint}`,
        query,
        {
          ...headers,
          Accept: "application/json",
        },
      );
      return ensureArray(pickData(res));
    }
  }

  async dropNotifications(params) {
    return await this.client.dropNotifications(params);
  }

  async getOrder(orderID) {
    return await this.client.getOrder(orderID);
  }

  async getOpenOrders(params, onlyFirstPage = true) {
    try {
      const response = await this.client.getOpenOrders(params, onlyFirstPage);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    } catch {
      const endpoint = "/data/orders";
      const headers = await this.createL2Headers(endpoint, "GET");
      const query = {
        ...params,
        maker_address:
          params?.maker_address ?? params?.address ?? this.funderAddress,
        signature_type: this.signatureType,
        next_cursor: params?.next_cursor ?? "MA==",
      };
      const res = await this.http.get(
        `${this.config.clobHost}${endpoint}`,
        query,
        {
          ...headers,
          Accept: "application/json",
        },
      );
      return ensureArray(pickData(res));
    }
  }

  async getTrades(params, onlyFirstPage = true) {
    try {
      const response = await this.client.getTrades(params, onlyFirstPage);
      if (hasErrorField(response))
        throw new PolymarketError(String(response.error), {
          status: response.status,
          response,
        });
      return response;
    } catch {
      const endpoint = "/data/trades";
      const headers = await this.createL2Headers(endpoint, "GET");
      const hasMakerAddress = isPresent(params?.maker_address);
      const hasTakerAddress = isPresent(params?.taker);
      const fallbackMakerAddress =
        hasMakerAddress || hasTakerAddress
          ? undefined
          : (params?.address ?? this.funderAddress);
      const query = {
        ...params,
        ...(fallbackMakerAddress
          ? { maker_address: fallbackMakerAddress }
          : {}),
        signature_type: this.signatureType,
        next_cursor: params?.next_cursor ?? "MA==",
      };
      const res = await this.http.get(
        `${this.config.clobHost}${endpoint}`,
        query,
        {
          ...headers,
          Accept: "application/json",
        },
      );
      return ensureArray(pickData(res));
    }
  }

  async getTradesPaginated(params, nextCursor = undefined) {
    return await this.client.getTradesPaginated(params, nextCursor);
  }

  async createAndPostOrder(
    userOrder,
    options = undefined,
    orderType = OrderType.GTC,
    deferExec = false,
    postOnly = false,
  ) {
    const payload = await this.client.createAndPostOrder(
      userOrder,
      options,
      orderType,
      deferExec,
      postOnly,
    );
    return this.normalizeOrderSubmissionPayload(
      payload,
      "createAndPostOrder",
      "/order",
    );
  }

  async createAndPostMarketOrder(
    userMarketOrder,
    options = undefined,
    orderType = OrderType.FOK,
    deferExec = false,
  ) {
    const payload = await this.client.createAndPostMarketOrder(
      userMarketOrder,
      options,
      orderType,
      deferExec,
    );
    return this.normalizeOrderSubmissionPayload(
      payload,
      "createAndPostMarketOrder",
      "/order",
    );
  }

  async createOrder(userOrder, options = undefined) {
    return await this.client.createOrder(userOrder, options);
  }

  async createMarketOrder(userMarketOrder, options = undefined) {
    return await this.client.createMarketOrder(userMarketOrder, options);
  }

  async postOrder(
    order,
    orderType = OrderType.GTC,
    deferExec = false,
    postOnly = false,
  ) {
    const payload = await this.client.postOrder(
      order,
      orderType,
      deferExec,
      postOnly,
    );
    return this.normalizeOrderSubmissionPayload(payload, "postOrder", "/order");
  }

  /**
   * Submit a signed order directly via HttpClient, bypassing the SDK's patched
   * transport layer.  This avoids the dual-mode (HTTP+SDK) retry inside the
   * patched `client.post`, which can swallow the real API response when
   * running behind a proxy.
   *
   * The method replicates the SDK's `postOrder` request construction:
   *   1. Build the order JSON payload (same as SDK's orderToJson)
   *   2. Create L2 HMAC headers (same as SDK's createL2Headers)
   *   3. POST to /order via this.http (curl / fetch, no patching)
   *
   * Returns the raw parsed response body.
   */
  async postOrderDirect(
    signedOrder,
    orderType = OrderType.GTC,
    deferExec = false,
    postOnly = false,
  ) {
    if (!hasApiCreds(this.creds)) {
      throw new AuthError(
        "L2 credentials are not configured (postOrderDirect)",
      );
    }

    // ── 1. Build the order payload (mirrors SDK orderToJson) ──
    if (
      postOnly === true &&
      orderType !== OrderType.GTC &&
      orderType !== OrderType.GTD
    ) {
      throw new ValidationError(
        "postOnly is only supported for GTC and GTD orders",
      );
    }
    const side = Number(signedOrder.side) === 0 ? Side.BUY : Side.SELL;
    const orderPayload = {
      deferExec,
      order: {
        salt: parseInt(signedOrder.salt, 10),
        maker: signedOrder.maker,
        signer: signedOrder.signer,
        taker: signedOrder.taker,
        tokenId: signedOrder.tokenId,
        makerAmount: signedOrder.makerAmount,
        takerAmount: signedOrder.takerAmount,
        side,
        expiration: signedOrder.expiration,
        nonce: signedOrder.nonce,
        feeRateBps: signedOrder.feeRateBps,
        signatureType: signedOrder.signatureType,
        signature: signedOrder.signature,
      },
      owner: this.creds.key,
      orderType,
      ...(typeof postOnly === "boolean" ? { postOnly } : {}),
    };

    // ── 2. Create L2 HMAC headers ──
    const endpoint = "/order";
    const bodyString = JSON.stringify(orderPayload);
    const l2HeaderArgs = {
      method: "POST",
      requestPath: endpoint,
      body: bodyString,
    };
    const serverTime = this.useServerTime
      ? await this.getServerTime().catch(() => undefined)
      : undefined;
    const headers = await createL2Headers(
      this.signer,
      this.creds,
      l2HeaderArgs,
      serverTime,
    );

    // ── 3. Direct POST via HttpClient (no patched transport) ──
    // IMPORTANT: pass the pre-serialized bodyString (not the object) so that
    // HttpClient does NOT re-serialise it.  This guarantees the bytes sent
    // over the wire are identical to the bytes used for the HMAC signature.
    const url = `${this.config.clobHost}${endpoint}`;
    const query = {};
    if (this.geoBlockToken) {
      query.geo_block_token = this.geoBlockToken;
    }

    // ── Diagnostic: log order payload before submission ──
    if (typeof this._auditLogger?.write === "function") {
      this._auditLogger.write("order.direct.pre_submit", {
        endpoint,
        orderPayload: {
          ...orderPayload,
          order: {
            ...orderPayload.order,
            signature: orderPayload.order.signature
              ? `${String(orderPayload.order.signature).slice(0, 20)}…`
              : null,
          },
        },
        serverTimestamp: serverTime ?? null,
        useServerTime: this.useServerTime,
      });
    }

    let response;
    try {
      response = await this.http.post(
        url,
        bodyString,
        {
          ...headers,
          "Content-Type": "application/json",
          "User-Agent": "@polymarket/clob-client",
          Accept: "*/*",
          Connection: "keep-alive",
        },
        query,
      );
    } catch (httpErr) {
      // ── Diagnostic: log the upstream rejection body for 4xx errors ──
      const status = httpErr?.status ?? httpErr?.details?.status;
      const upstreamBody = httpErr?.details?.body ?? httpErr?.details ?? null;
      if (typeof this._auditLogger?.write === "function") {
        this._auditLogger.write("order.direct.rejected", {
          endpoint,
          status,
          upstreamBody,
          message: httpErr?.message ?? String(httpErr),
        });
      }
      // Attach the upstream response body to the error so callers can surface it
      if (!httpErr.details) httpErr.details = {};
      httpErr.details.upstreamResponseBody = upstreamBody;
      httpErr.details.orderPayloadSent = {
        ...orderPayload,
        order: {
          ...orderPayload.order,
          signature: orderPayload.order.signature
            ? `${String(orderPayload.order.signature).slice(0, 20)}…`
            : null,
        },
      };
      throw httpErr;
    }

    const payload = pickData(response);
    return this.normalizeOrderSubmissionPayload(
      payload,
      "postOrderDirect",
      endpoint,
    );
  }

  async postOrders(args, deferExec = false, defaultPostOnly = false) {
    if (!Array.isArray(args) || args.length === 0) {
      throw new ValidationError("postOrders expects at least one order");
    }
    if (args.length > this.config.maxBatchOrders) {
      throw new ValidationError(
        `postOrders batch size exceeds ${this.config.maxBatchOrders}`,
      );
    }
    const payload = await this.client.postOrders(
      args,
      deferExec,
      defaultPostOnly,
    );
    return this.normalizeOrderSubmissionPayload(
      payload,
      "postOrders",
      "/orders",
    );
  }

  async cancelOrder(payload) {
    return await this.client.cancelOrder(payload);
  }

  async cancelOrders(orderHashes) {
    return await this.client.cancelOrders(orderHashes);
  }

  async cancelAll() {
    return await this.client.cancelAll();
  }

  async cancelMarketOrders(payload) {
    return await this.client.cancelMarketOrders(payload);
  }

  async isOrderScoring(params) {
    return await this.client.isOrderScoring(params);
  }

  async areOrdersScoring(params) {
    return await this.client.areOrdersScoring(params);
  }

  async getMarketTradesEvents(conditionID) {
    return await this.client.getMarketTradesEvents(conditionID);
  }

  async calculateMarketPrice(tokenID, side, amount, orderType = OrderType.FOK) {
    return await this.client.calculateMarketPrice(
      tokenID,
      side,
      amount,
      orderType,
    );
  }

  async postHeartbeat(heartbeatId = undefined) {
    return await this.client.postHeartbeat(heartbeatId);
  }

  async createBuilderApiKey() {
    return await this.client.createBuilderApiKey();
  }

  async getBuilderApiKeys() {
    return await this.client.getBuilderApiKeys();
  }

  async revokeBuilderApiKey() {
    return await this.client.revokeBuilderApiKey();
  }

  async getBuilderTrades(params, nextCursor = undefined) {
    return await this.client.getBuilderTrades(params, nextCursor);
  }

  toUserOrder(intent) {
    return {
      tokenID: intent.tokenId,
      price: intent.limitPrice,
      size: intent.size,
      side: intent.side === "BUY" ? Side.BUY : Side.SELL,
      expiration: intent.expiration,
      feeRateBps: intent.feeRateBps,
    };
  }

  toUserMarketOrder(intent) {
    const normalizedAmount = Number(intent.amount ?? intent.size);
    return {
      tokenID: intent.tokenId,
      amount: normalizedAmount,
      side: intent.side === "BUY" ? Side.BUY : Side.SELL,
      price: intent.limitPrice,
      orderType: intent.timeInForce === "FAK" ? OrderType.FAK : OrderType.FOK,
      feeRateBps: intent.feeRateBps,
    };
  }

  deriveOrderId(order, negRisk = false) {
    if (!order || typeof order !== "object") return null;
    try {
      const contracts = getContractConfig(Number(this.config.chainId));
      const exchangeAddress = negRisk
        ? contracts.negRiskExchange
        : contracts.exchange;
      const builder = new ExchangeOrderBuilder(
        exchangeAddress,
        Number(this.config.chainId),
        this.signer,
      );
      const typedData = builder.buildOrderTypedData(order);
      return builder.buildOrderHash(typedData);
    } catch {
      return null;
    }
  }

  async createL2Headers(requestPath, method = "GET", body = undefined) {
    if (!hasApiCreds(this.creds)) {
      throw new AuthError("L2 credentials are not configured");
    }
    return await createL2Headers(this.signer, this.creds, {
      method,
      requestPath,
      body,
    });
  }
}

export { AssetType, OrderType, Side };
