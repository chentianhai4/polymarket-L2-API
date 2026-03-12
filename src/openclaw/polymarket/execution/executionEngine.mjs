import { RiskBlockedError } from "../errors.mjs";
import { RiskDecisionKind, RiskEffectiveAction } from "../types.mjs";

function toFiniteNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeOrderType(orderType) {
  return String(orderType ?? "LIMIT").toUpperCase() === "MARKET"
    ? "MARKET"
    : "LIMIT";
}

function normalizeSide(side) {
  return String(side ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function normalizeExecutionMode(mode) {
  return String(mode ?? "")
    .trim()
    .toLowerCase() === "passive_maker"
    ? "passive_maker"
    : "respect_user_limit";
}

function normalizeMarketTimeInForce(value, fallback = "FAK") {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "FOK" || normalized === "FAK") return normalized;
  return fallback === "FOK" ? "FOK" : "FAK";
}

function isImmediateOrCancelTif(tif) {
  const normalized = String(tif ?? "")
    .trim()
    .toUpperCase();
  return normalized === "FAK" || normalized === "FOK";
}

function normalizeConfirmationPolicy(
  value,
  fallback = "unique_order_id_evidence",
) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "strict_upstream_only") return "strict_upstream_only";
  if (normalized === "unique_order_id_evidence")
    return "unique_order_id_evidence";
  return normalizeConfirmationPolicy(fallback, "unique_order_id_evidence");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function precisionFromTick(tickSize) {
  const text = String(tickSize);
  const dot = text.indexOf(".");
  if (dot === -1) return 0;
  return Math.max(0, text.length - dot - 1);
}

function roundToTick(value, tickSize, mode = "nearest") {
  const tick = toFiniteNumber(tickSize, NaN);
  const n = toFiniteNumber(value, NaN);
  if (!(Number.isFinite(tick) && tick > 0 && Number.isFinite(n))) return NaN;

  const ratio = n / tick;
  let roundedRatio;
  switch (mode) {
    case "floor":
      roundedRatio = Math.floor(ratio + 1e-9);
      break;
    case "ceil":
      roundedRatio = Math.ceil(ratio - 1e-9);
      break;
    default:
      roundedRatio = Math.round(ratio);
      break;
  }

  const precision = precisionFromTick(tick);
  const rounded = roundedRatio * tick;
  return Number(rounded.toFixed(Math.min(12, precision + 2)));
}

function clampPriceToBand(price, tickSize) {
  const tick = toFiniteNumber(tickSize, NaN);
  const n = toFiniteNumber(price, NaN);
  if (!(Number.isFinite(tick) && tick > 0 && Number.isFinite(n))) return NaN;
  const minPrice = tick;
  const maxPrice = Math.max(minPrice, 1 - tick);
  return Math.min(maxPrice, Math.max(minPrice, n));
}

function parseBookLevelPrice(level) {
  if (Array.isArray(level)) {
    return toOptionalNumber(level[0]);
  }
  if (level && typeof level === "object") {
    return (
      toOptionalNumber(level.price) ??
      toOptionalNumber(level.p) ??
      toOptionalNumber(level.rate) ??
      toOptionalNumber(level.value)
    );
  }
  return toOptionalNumber(level);
}

function pickBestBid(levels = []) {
  let best = null;
  for (const level of Array.isArray(levels) ? levels : []) {
    const price = parseBookLevelPrice(level);
    if (price === null) continue;
    if (best === null || price > best) best = price;
  }
  return best;
}

function pickBestAsk(levels = []) {
  let best = null;
  for (const level of Array.isArray(levels) ? levels : []) {
    const price = parseBookLevelPrice(level);
    if (price === null) continue;
    if (best === null || price < best) best = price;
  }
  return best;
}

function extractMarketBookMetadata(orderBook) {
  const tickSize =
    toOptionalNumber(orderBook?.tick_size) ??
    toOptionalNumber(orderBook?.tickSize) ??
    toOptionalNumber(orderBook?.minimum_tick_size) ??
    toOptionalNumber(orderBook?.min_tick_size);
  const minOrderSize =
    toOptionalNumber(orderBook?.min_order_size) ??
    toOptionalNumber(orderBook?.minOrderSize) ??
    toOptionalNumber(orderBook?.minimum_order_size);
  const bestBid = pickBestBid(orderBook?.bids);
  const bestAsk = pickBestAsk(orderBook?.asks);

  return {
    tickSize,
    minOrderSize,
    bestBid,
    bestAsk,
  };
}

function uniqueWarnings(items = []) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : []).filter(Boolean).map((x) => String(x)),
    ),
  );
}

function uniqueStrings(items = []) {
  return Array.from(
    new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => String(item ?? "").trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function normalizeSideOrNull(side) {
  if (side === undefined || side === null || side === "") return null;
  const text = String(side).trim().toUpperCase();
  if (text === "BUY") return "BUY";
  if (text === "SELL") return "SELL";
  return null;
}

function normalizeTokenIdOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isConditionIdHash(value) {
  const text = normalizeTokenIdOrNull(value);
  if (!text) return false;
  return /^0x[a-fA-F0-9]{64}$/.test(text);
}

function toTimestampMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return null;
    if (value >= 1e11) return Math.floor(value);
    if (value >= 1e9) return Math.floor(value * 1000);
    return null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) return toTimestampMs(asNumber);
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export class ExecutionEngine {
  constructor({
    config,
    compiler,
    riskEngine,
    quoteService,
    clobService,
    metrics,
    auditLogger,
  }) {
    this.config = config;
    this.compiler = compiler;
    this.risk = riskEngine;
    this.quote = quoteService;
    this.clob = clobService;
    this.metrics = metrics;
    this.audit = auditLogger;
    this.idempotency = new Map();
  }

  async fetchMarketMetadata(tokenId, side, orderType, options = {}) {
    const retryCount = Math.max(
      0,
      Math.floor(toFiniteNumber(options.retries, 1)),
    );
    const retryDelayMs = Math.max(
      40,
      Math.floor(toFiniteNumber(options.retryDelayMs, 120)),
    );
    const normalizedSide = normalizeSide(side);
    const normalizedOrderType = normalizeOrderType(orderType);
    const executionMode = normalizeExecutionMode(options.executionMode);
    const attempts = [];

    for (let index = 0; index <= retryCount; index += 1) {
      const attempt = {
        attempt: index + 1,
        orderBook: false,
        tickSize: false,
        minOrderSize: false,
        bestBid: false,
        bestAsk: false,
      };

      try {
        const [orderBook, tickFromEndpoint] = await Promise.all([
          this.clob.getOrderBook(tokenId),
          this.clob.getTickSize(tokenId).catch(() => null),
        ]);

        const extracted = extractMarketBookMetadata(orderBook);
        const tickSize =
          toOptionalNumber(tickFromEndpoint) ?? extracted.tickSize;
        const minOrderSize = extracted.minOrderSize;
        const bestBid = extracted.bestBid;
        const bestAsk = extracted.bestAsk;

        attempt.orderBook = Boolean(orderBook && typeof orderBook === "object");
        attempt.tickSize = Number.isFinite(tickSize) && tickSize > 0;
        attempt.minOrderSize =
          Number.isFinite(minOrderSize) && minOrderSize > 0;
        attempt.bestBid = Number.isFinite(bestBid);
        attempt.bestAsk = Number.isFinite(bestAsk);

        const needsBookEdgeForLimit =
          normalizedOrderType === "LIMIT" && executionMode === "passive_maker";
        const needsBookEdgeForMarket = normalizedOrderType === "MARKET";
        const hasSideEdge = needsBookEdgeForMarket
          ? normalizedSide === "BUY"
            ? attempt.bestAsk
            : attempt.bestBid
          : needsBookEdgeForLimit
            ? normalizedSide === "BUY"
              ? attempt.bestBid
              : attempt.bestAsk
            : true;

        if (
          attempt.orderBook &&
          attempt.tickSize &&
          attempt.minOrderSize &&
          hasSideEdge
        ) {
          const [feeRateBpsRaw, negRiskRaw] = await Promise.all([
            this.clob.getFeeRateBps(tokenId).catch(() => null),
            this.clob.getNegRisk(tokenId).catch(() => null),
          ]);

          // ── Resolve negRisk: critical for choosing the correct exchange contract ──
          let resolvedNegRisk =
            typeof negRiskRaw === "boolean" ? negRiskRaw : null;
          if (resolvedNegRisk === null) {
            // Fallback: try parsing from orderBook response which may carry neg_risk
            const bookNegRisk = orderBook?.neg_risk ?? orderBook?.negRisk;
            if (typeof bookNegRisk === "boolean") {
              resolvedNegRisk = bookNegRisk;
            } else if (typeof bookNegRisk === "string") {
              resolvedNegRisk = bookNegRisk.toLowerCase() === "true";
            }
          }

          attempts.push({
            ...attempt,
            success: true,
            negRiskResolved: resolvedNegRisk !== null,
          });

          return {
            ok: true,
            attempts,
            metadata: {
              tokenId,
              orderBook,
              tickSize,
              minOrderSize,
              bestBid,
              bestAsk,
              feeRateBps: toOptionalNumber(feeRateBpsRaw),
              negRisk: resolvedNegRisk,
            },
          };
        }
      } catch (error) {
        attempt.error = error?.message ?? String(error);
      }

      attempts.push(attempt);
      if (index < retryCount) {
        await sleep(retryDelayMs * (index + 1));
      }
    }

    return { ok: false, attempts, metadata: null };
  }

  async normalizeIntentForMarket(intent, side = undefined, options = {}) {
    const normalizedIntent = { ...(intent ?? {}) };
    const original = {
      size: normalizedIntent.size,
      limitPrice: normalizedIntent.limitPrice,
    };
    const fallbackStrategy = "RESPECT_USER_LIMIT_MIN_SIZE_TICK";

    const tokenId = normalizedIntent.tokenId;
    if (!tokenId) {
      return {
        blocked: true,
        error: {
          code: "MARKET_METADATA_UNAVAILABLE",
          message: "tokenId is required to resolve market metadata",
        },
        warnings: ["MARKET_METADATA_UNAVAILABLE"],
        metadata: null,
        adjustments: {
          strategy: fallbackStrategy,
          original,
          adjusted: null,
          changes: [],
          retries: [],
          blocked: true,
          reason: "Missing tokenId",
        },
      };
    }

    const normalizedSide = normalizeSide(side ?? normalizedIntent.side);
    const normalizedOrderType = normalizeOrderType(normalizedIntent.orderType);
    const executionMode = normalizeExecutionMode(options.executionMode);
    const strategy =
      normalizedOrderType === "MARKET"
        ? "MARKETABLE_LIMIT_MIN_SIZE"
        : executionMode === "passive_maker"
          ? "BOOK_OFFSET_3_TICKS_MIN_SIZE"
          : "RESPECT_USER_LIMIT_MIN_SIZE_TICK";
    const marketCrossTicks = Math.max(
      1,
      Math.floor(
        toFiniteNumber(options.marketCrossTicks ?? options.priceOffsetTicks, 3),
      ),
    );
    const marketDefaultTif = normalizeMarketTimeInForce(
      options.marketDefaultTif,
      "FAK",
    );
    const metadataResult = await this.fetchMarketMetadata(
      tokenId,
      normalizedSide,
      normalizedOrderType,
      options,
    );

    if (!metadataResult.ok || !metadataResult.metadata) {
      return {
        blocked: true,
        error: {
          code: "MARKET_METADATA_UNAVAILABLE",
          message: `Unable to resolve market metadata for token ${tokenId}`,
          retrySummary: metadataResult.attempts,
        },
        warnings: ["MARKET_METADATA_UNAVAILABLE"],
        metadata: null,
        adjustments: {
          strategy,
          original,
          adjusted: null,
          changes: [],
          retries: metadataResult.attempts,
          blocked: true,
          reason: "Missing tickSize/minOrderSize/orderBook edge",
        },
      };
    }

    const metadata = metadataResult.metadata;
    const warnings = [];
    const changes = [];

    const minOrderSize = toFiniteNumber(metadata.minOrderSize, NaN);

    if (normalizedOrderType === "LIMIT") {
      const sizeRaw = toOptionalNumber(normalizedIntent.size);
      if (sizeRaw === null || sizeRaw < minOrderSize) {
        normalizedIntent.size = minOrderSize;
        changes.push({
          field: "size",
          from: sizeRaw,
          to: minOrderSize,
          reason: `Raised to min_order_size (${minOrderSize})`,
        });
        warnings.push(`AUTO_ADJUST_SIZE_TO_MIN_ORDER_SIZE:${minOrderSize}`);
      }

      const tickSize = toFiniteNumber(metadata.tickSize, NaN);
      const originalPrice = toOptionalNumber(normalizedIntent.limitPrice);
      let adjustedPrice = originalPrice;

      if (executionMode === "passive_maker" || originalPrice === null) {
        const bookAnchor =
          normalizedSide === "BUY" ? metadata.bestBid : metadata.bestAsk;
        const rawTarget =
          normalizedSide === "BUY"
            ? toFiniteNumber(bookAnchor, NaN) - tickSize * marketCrossTicks
            : toFiniteNumber(bookAnchor, NaN) + tickSize * marketCrossTicks;
        adjustedPrice = rawTarget;
      }

      adjustedPrice = clampPriceToBand(adjustedPrice, tickSize);
      adjustedPrice = roundToTick(
        adjustedPrice,
        tickSize,
        normalizedSide === "BUY" ? "floor" : "ceil",
      );

      if (Number.isFinite(adjustedPrice)) {
        const changed =
          originalPrice === null ||
          Math.abs(adjustedPrice - originalPrice) >
            Math.max(tickSize / 1000, 1e-9);
        normalizedIntent.limitPrice = adjustedPrice;
        if (changed) {
          changes.push({
            field: "limitPrice",
            from: originalPrice,
            to: adjustedPrice,
            reason:
              executionMode === "passive_maker"
                ? `${normalizedSide} ${marketCrossTicks} ticks from book edge with tick alignment`
                : "Tick/band alignment for user limit price",
          });
          if (executionMode === "passive_maker") {
            warnings.push(
              `AUTO_ADJUST_LIMIT_PRICE_BY_BOOK_OFFSET:${marketCrossTicks}_TICKS`,
            );
          } else {
            warnings.push("AUTO_ADJUST_LIMIT_PRICE_TO_TICK_BAND");
          }
        }
      }

      const bestAsk = toOptionalNumber(metadata.bestAsk);
      const bestBid = toOptionalNumber(metadata.bestBid);
      const postOnly = Boolean(normalizedIntent.postOnly);
      if (postOnly && Number.isFinite(adjustedPrice)) {
        const tolerance =
          Number.isFinite(tickSize) && tickSize > 0 ? tickSize / 1000 : 1e-9;
        const wouldTake =
          normalizedSide === "BUY"
            ? bestAsk !== null && adjustedPrice >= bestAsk - tolerance
            : bestBid !== null && adjustedPrice <= bestBid + tolerance;

        if (wouldTake) {
          return {
            blocked: true,
            error: {
              code: "POST_ONLY_WOULD_TAKE_LIQUIDITY",
              message:
                "postOnly order price would cross the book and take liquidity",
            },
            warnings: uniqueWarnings([
              ...warnings,
              "POST_ONLY_WOULD_TAKE_LIQUIDITY",
            ]),
            metadata: {
              ...metadata,
            },
            adjustments: {
              strategy,
              original,
              adjusted: {
                size: normalizedIntent.size,
                limitPrice: normalizedIntent.limitPrice,
              },
              changes,
              retries: metadataResult.attempts,
              blocked: true,
              reason: "postOnly order became marketable after normalization",
            },
            intent: normalizedIntent,
          };
        }
      }
    }

    if (normalizedOrderType === "MARKET") {
      const tickSize = toFiniteNumber(metadata.tickSize, NaN);
      const originalAmount = toOptionalNumber(normalizedIntent.amount);
      if (originalAmount === null) {
        const fallbackAmount = toOptionalNumber(normalizedIntent.size);
        if (fallbackAmount !== null) {
          normalizedIntent.amount = fallbackAmount;
          changes.push({
            field: "amount",
            from: originalAmount,
            to: fallbackAmount,
            reason: "Backfilled MARKET amount from legacy size field",
          });
          warnings.push("MARKET_AMOUNT_MAPPED_FROM_SIZE");
        }
      }

      const amountRaw = toOptionalNumber(normalizedIntent.amount);
      if (normalizedSide === "SELL") {
        if (amountRaw === null || amountRaw < minOrderSize) {
          normalizedIntent.amount = minOrderSize;
          changes.push({
            field: "amount",
            from: amountRaw,
            to: minOrderSize,
            reason: `Raised SELL amount to min_order_size (${minOrderSize})`,
          });
          warnings.push(
            `AUTO_ADJUST_MARKET_SELL_AMOUNT_TO_MIN_ORDER_SIZE:${minOrderSize}`,
          );
        }
      } else {
        const bestAsk = toOptionalNumber(metadata.bestAsk);
        if (
          amountRaw !== null &&
          Number.isFinite(bestAsk) &&
          bestAsk > 0 &&
          amountRaw / bestAsk < minOrderSize
        ) {
          const adjustedAmount = Number((minOrderSize * bestAsk).toFixed(6));
          normalizedIntent.amount = adjustedAmount;
          changes.push({
            field: "amount",
            from: amountRaw,
            to: adjustedAmount,
            reason: `Raised BUY amount to satisfy min_order_size (${minOrderSize}) using bestAsk=${bestAsk}`,
          });
          warnings.push(
            `AUTO_ADJUST_MARKET_BUY_AMOUNT_TO_MIN_ORDER_SIZE:${minOrderSize}`,
          );
        }
      }

      const bookAnchor =
        normalizedSide === "BUY" ? metadata.bestAsk : metadata.bestBid;
      const rawTarget =
        normalizedSide === "BUY"
          ? toFiniteNumber(bookAnchor, NaN) + tickSize * marketCrossTicks
          : toFiniteNumber(bookAnchor, NaN) - tickSize * marketCrossTicks;
      let adjustedPrice = clampPriceToBand(rawTarget, tickSize);
      adjustedPrice = roundToTick(
        adjustedPrice,
        tickSize,
        normalizedSide === "BUY" ? "ceil" : "floor",
      );

      if (Number.isFinite(adjustedPrice)) {
        normalizedIntent.limitPrice = adjustedPrice;
        changes.push({
          field: "limitPrice",
          from: original.limitPrice ?? null,
          to: adjustedPrice,
          reason: `Synthetic marketable limit price (${normalizedSide}, ${marketCrossTicks} ticks from opposite edge)`,
        });
        warnings.push(`MARKET_SYNTHETIC_LIMIT_PRICE:${marketCrossTicks}_TICKS`);
      }

      const originalTif = String(normalizedIntent.timeInForce ?? "")
        .trim()
        .toUpperCase();
      const mappedTif = normalizeMarketTimeInForce(
        originalTif,
        marketDefaultTif,
      );
      normalizedIntent.timeInForce = mappedTif;
      if (originalTif !== mappedTif) {
        warnings.push(`MARKET_TIME_IN_FORCE_MAPPED_TO_${mappedTif}`);
      }
    }

    return {
      blocked: false,
      error: null,
      warnings,
      metadata: {
        ...metadata,
        executionMode,
      },
      adjustments: {
        strategy,
        original,
        adjusted: {
          size: normalizedIntent.size,
          amount: normalizedIntent.amount,
          limitPrice: normalizedIntent.limitPrice,
        },
        changes,
        retries: metadataResult.attempts,
        blocked: false,
      },
      intent: normalizedIntent,
    };
  }

  async withSoftTimeout(promise, timeoutMs, fallback = null) {
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } catch {
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  extractTradeIdsFromPayload(payload) {
    const out = [];
    const seen = new Set();

    const push = (value) => {
      if (Array.isArray(value)) {
        for (const item of value) push(item);
        return;
      }
      if (value === undefined || value === null) return;
      const normalized = String(value).trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    const visit = (value, depth = 0) => {
      if (depth > 5 || value === undefined || value === null) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;

      push(value.tradeID);
      push(value.tradeId);
      push(value.trade_id);
      push(value.tradeIDs);
      push(value.tradeIds);

      if (value.data !== undefined) visit(value.data, depth + 1);
      if (value.result !== undefined) visit(value.result, depth + 1);
      if (value.exchange !== undefined) visit(value.exchange, depth + 1);
      if (value.initialPayload !== undefined)
        visit(value.initialPayload, depth + 1);
    };

    visit(payload, 0);
    return out;
  }

  extractOrderIdsFromPayload(payload) {
    if (typeof this.clob.extractOrderIds === "function") {
      const ids = this.clob.extractOrderIds(payload);
      return uniqueStrings(ids);
    }

    const out = [];
    const seen = new Set();
    const push = (value) => {
      if (Array.isArray(value)) {
        for (const item of value) push(item);
        return;
      }
      if (value === undefined || value === null) return;
      const normalized = String(value).trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };
    const visit = (value, depth = 0) => {
      if (depth > 5 || value === undefined || value === null) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;
      push(value.orderID);
      push(value.orderId);
      push(value.order_id);
      push(value.id);
      push(value.orderHash);
      push(value.hash);
      push(value.orderIDs);
      push(value.orderIds);
      if (value.data !== undefined) visit(value.data, depth + 1);
      if (value.result !== undefined) visit(value.result, depth + 1);
      if (value.exchange !== undefined) visit(value.exchange, depth + 1);
      if (value.initialPayload !== undefined)
        visit(value.initialPayload, depth + 1);
    };
    visit(payload, 0);
    return out;
  }

  isInvalidSubmissionPayload(payload) {
    if (typeof this.clob.isInvalidOrderSubmissionPayload === "function") {
      return this.clob.isInvalidOrderSubmissionPayload(payload);
    }
    if (payload === undefined || payload === null) return true;
    if (typeof payload === "string") return payload.trim() === "";
    if (Array.isArray(payload)) return payload.length === 0;
    if (typeof payload !== "object") return true;
    if (Object.keys(payload).length === 0) return true;
    if (payload.__openclawInvalidSubmission === true) return true;
    return false;
  }

  /**
   * Detect whether a FAK/FOK postOrder response indicates a successful match
   * even when extractOrderIds returns empty (e.g. orderID is "" or missing).
   *
   * SDK OrderResponse: { success, orderID, transactionsHashes[], status,
   *                       takingAmount, makingAmount, errorMsg }
   *
   * Returns true when the response carries enough evidence that the order was
   * filled — preventing a false "FAK_NOT_FILLED" on a real fill.
   */
  isFakSuccessResponse(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.__openclawInvalidSubmission) return false;

    // Unwrap one level of { data: {...} } or { response: {...} } envelope
    const inner = payload.data ?? payload.response ?? payload;
    if (!inner || typeof inner !== "object") return false;

    // Need explicit success === true
    if (inner.success !== true) return false;

    const status = String(inner.status ?? "").toLowerCase();
    // "matched" / "filled" / "live" are all positive fill indicators
    if (status === "matched" || status === "filled" || status === "live")
      return true;

    // If there are transaction hashes, the exchange executed on-chain
    const txHashes = inner.transactionsHashes ?? inner.transactionHashes;
    if (Array.isArray(txHashes) && txHashes.length > 0) return true;

    // If takingAmount or makingAmount > 0, something was exchanged
    const taking = Number(inner.takingAmount ?? 0);
    const making = Number(inner.makingAmount ?? 0);
    if (taking > 0 || making > 0) return true;

    return false;
  }

  isSubmissionTimeoutError(error) {
    if (!error) return false;
    const message = String(error?.message ?? "").toLowerCase();
    const operation = String(
      error?.details?.operation ?? error?.operation ?? "",
    ).toLowerCase();
    const status = Number(error?.status ?? error?.details?.status ?? NaN);
    const timeoutLike = message.includes("timeout") || status === 0;
    const submitLike =
      operation.includes("createandpostorder") ||
      operation.includes("postorder") ||
      message.includes("createandpostorder");
    return timeoutLike && submitLike;
  }

  extractRecordTokenId(record) {
    return normalizeTokenIdOrNull(
      record?.asset_id ??
        record?.assetId ??
        record?.token_id ??
        record?.tokenId ??
        record?.tokenID,
    );
  }

  extractRecordSide(record) {
    return normalizeSideOrNull(
      record?.side ?? record?.maker_side ?? record?.taker_side,
    );
  }

  extractRecordPrice(record) {
    return (
      toOptionalNumber(record?.price) ??
      toOptionalNumber(record?.limit_price) ??
      toOptionalNumber(record?.limitPrice) ??
      toOptionalNumber(record?.avg_price) ??
      toOptionalNumber(record?.rate)
    );
  }

  extractRecordSize(record) {
    return (
      toOptionalNumber(record?.original_size) ??
      toOptionalNumber(record?.originalSize) ??
      toOptionalNumber(record?.size) ??
      toOptionalNumber(record?.remaining_size) ??
      toOptionalNumber(record?.amount)
    );
  }

  extractRecordTimestampMs(record) {
    return toTimestampMs(
      record?.created_at ??
        record?.createdAt ??
        record?.creation_time ??
        record?.creationTime ??
        record?.timestamp ??
        record?.match_time ??
        record?.matchTime ??
        record?.last_update ??
        record?.updated_at,
    );
  }

  matchOrderCandidate(order, intent, tickSize = null) {
    const expectedTokenId = normalizeTokenIdOrNull(intent?.tokenId);
    const expectedSide = normalizeSide(intent?.side);
    const expectedOrderType = normalizeOrderType(intent?.orderType);
    const expectedPrice = toOptionalNumber(intent?.limitPrice);
    const expectedSize =
      expectedOrderType === "MARKET" ? null : toOptionalNumber(intent?.size);
    const priceTolerance =
      Number.isFinite(tickSize) && tickSize > 0 ? tickSize + 1e-9 : 1e-6;
    const sizeTolerance =
      expectedSize !== null ? Math.max(expectedSize * 0.005, 1e-6) : 1e-6;

    const tokenId = this.extractRecordTokenId(order);
    if (!tokenId || !expectedTokenId || tokenId !== expectedTokenId) {
      return { matched: false, reason: "TOKEN_MISMATCH" };
    }

    const side = this.extractRecordSide(order);
    if (!side || side !== expectedSide) {
      return { matched: false, reason: "SIDE_MISMATCH" };
    }

    const price = this.extractRecordPrice(order);
    if (
      expectedPrice !== null &&
      (price === null || Math.abs(price - expectedPrice) > priceTolerance)
    ) {
      return { matched: false, reason: "PRICE_MISMATCH" };
    }

    const size = this.extractRecordSize(order);
    if (
      expectedSize !== null &&
      (size === null || size + sizeTolerance < expectedSize)
    ) {
      return { matched: false, reason: "SIZE_MISMATCH" };
    }

    const orderIds = this.extractOrderIdsFromPayload(order);
    return {
      matched: true,
      reason: "MATCH",
      orderId: orderIds[0] ?? null,
      tokenId,
      side,
      price,
      size,
      createdAtMs: this.extractRecordTimestampMs(order),
    };
  }

  extractCandidateOrderIdsFromTrade(trade, context = {}) {
    const out = [];
    const accountAddressSet = new Set(
      uniqueStrings(context.accountAddresses).map((item) => item.toLowerCase()),
    );
    const push = (value) => {
      const normalized = normalizeTokenIdOrNull(value);
      if (!normalized) return;
      out.push(normalized);
    };

    push(trade?.taker_order_id);
    push(trade?.takerOrderId);
    push(trade?.order_id);
    push(trade?.orderId);

    const makerOrders = Array.isArray(trade?.maker_orders)
      ? trade.maker_orders
      : [];
    for (const makerOrder of makerOrders) {
      const makerAddress = String(
        makerOrder?.maker_address ??
          makerOrder?.makerAddress ??
          makerOrder?.owner ??
          "",
      )
        .trim()
        .toLowerCase();
      if (
        accountAddressSet.size > 0 &&
        makerAddress &&
        !accountAddressSet.has(makerAddress)
      ) {
        continue;
      }
      push(makerOrder?.order_id);
      push(makerOrder?.orderId);
    }

    return uniqueStrings(out);
  }

  extractNotificationPayload(notification) {
    if (
      notification &&
      typeof notification === "object" &&
      notification.payload &&
      typeof notification.payload === "object"
    ) {
      return notification.payload;
    }
    return notification;
  }

  matchTradeCandidate(trade, intent, tickSize = null, context = {}) {
    const expectedTokenId = normalizeTokenIdOrNull(intent?.tokenId);
    const expectedSide = normalizeSide(intent?.side);
    const expectedPrice = toOptionalNumber(intent?.limitPrice);
    const expectedSize = toOptionalNumber(intent?.size);
    const expectedOrderType = normalizeOrderType(intent?.orderType);
    const expectedTif = normalizeMarketTimeInForce(intent?.timeInForce, "FAK");
    const acceptPositiveSizeOnly =
      expectedOrderType === "MARKET" ||
      expectedTif === "FAK" ||
      expectedTif === "FOK";
    const priceTolerance =
      Number.isFinite(tickSize) && tickSize > 0 ? tickSize + 1e-9 : 1e-6;
    const sizeTolerance =
      expectedSize !== null ? Math.max(expectedSize * 0.01, 1e-6) : 1e-6;

    const tokenId = this.extractRecordTokenId(trade);
    if (!tokenId || !expectedTokenId || tokenId !== expectedTokenId) {
      return { matched: false, reason: "TOKEN_MISMATCH" };
    }

    const side = this.extractRecordSide(trade);
    if (!side || side !== expectedSide) {
      return { matched: false, reason: "SIDE_MISMATCH" };
    }

    const price = this.extractRecordPrice(trade);
    if (expectedPrice !== null) {
      if (price === null) {
        return { matched: false, reason: "PRICE_MISSING" };
      }
      if (expectedSide === "BUY" && price - expectedPrice > priceTolerance) {
        return { matched: false, reason: "PRICE_WORSE_THAN_LIMIT" };
      }
      if (expectedSide === "SELL" && expectedPrice - price > priceTolerance) {
        return { matched: false, reason: "PRICE_WORSE_THAN_LIMIT" };
      }
    }

    const size = this.extractRecordSize(trade);
    if (acceptPositiveSizeOnly) {
      if (size === null || size <= sizeTolerance) {
        return { matched: false, reason: "SIZE_NOT_FILLED" };
      }
    } else if (
      expectedSize !== null &&
      (size === null || size + sizeTolerance < expectedSize)
    ) {
      return { matched: false, reason: "SIZE_MISMATCH" };
    }

    const candidateOrderIds = this.extractCandidateOrderIdsFromTrade(
      trade,
      context,
    );
    return {
      matched: true,
      reason: "MATCH",
      tradeId:
        normalizeTokenIdOrNull(trade?.tradeID) ??
        normalizeTokenIdOrNull(trade?.tradeId) ??
        normalizeTokenIdOrNull(trade?.id),
      tokenId,
      side,
      price,
      size,
      candidateOrderIds,
      createdAtMs: this.extractRecordTimestampMs(trade),
    };
  }

  matchNotificationCandidate(notification, intent, tickSize = null) {
    const payload = this.extractNotificationPayload(notification);
    const expectedTokenId = normalizeTokenIdOrNull(intent?.tokenId);
    const expectedConditionId = normalizeTokenIdOrNull(intent?.conditionId);
    const shouldMatchCondition = isConditionIdHash(expectedConditionId);
    const expectedSide = normalizeSide(intent?.side);
    const expectedPrice = toOptionalNumber(intent?.limitPrice);
    const expectedSize = toOptionalNumber(intent?.size);
    const expectedOrderType = normalizeOrderType(intent?.orderType);
    const expectedTif = normalizeMarketTimeInForce(intent?.timeInForce, "FAK");
    const acceptPositiveSizeOnly =
      expectedOrderType === "MARKET" ||
      expectedTif === "FAK" ||
      expectedTif === "FOK";
    const priceTolerance =
      Number.isFinite(tickSize) && tickSize > 0 ? tickSize + 1e-9 : 1e-6;
    const sizeTolerance =
      expectedSize !== null ? Math.max(expectedSize * 0.01, 1e-6) : 1e-6;

    const tokenId = this.extractRecordTokenId(payload);
    if (!tokenId || !expectedTokenId || tokenId !== expectedTokenId) {
      return { matched: false, reason: "TOKEN_MISMATCH" };
    }

    const conditionId = normalizeTokenIdOrNull(
      payload?.condition_id ??
        payload?.conditionId ??
        payload?.market ??
        payload?.market_id,
    );
    if (
      shouldMatchCondition &&
      conditionId &&
      expectedConditionId !== conditionId
    ) {
      return { matched: false, reason: "MARKET_MISMATCH" };
    }

    const side = this.extractRecordSide(payload);
    if (!side || side !== expectedSide) {
      return { matched: false, reason: "SIDE_MISMATCH" };
    }

    const price = this.extractRecordPrice(payload);
    if (expectedPrice !== null && price !== null) {
      if (expectedSide === "BUY" && price - expectedPrice > priceTolerance) {
        return { matched: false, reason: "PRICE_WORSE_THAN_LIMIT" };
      }
      if (expectedSide === "SELL" && expectedPrice - price > priceTolerance) {
        return { matched: false, reason: "PRICE_WORSE_THAN_LIMIT" };
      }
    }

    const size = this.extractRecordSize(payload);
    if (acceptPositiveSizeOnly) {
      if (size !== null && size <= sizeTolerance) {
        return { matched: false, reason: "SIZE_NOT_FILLED" };
      }
    } else if (
      expectedSize !== null &&
      size !== null &&
      size + sizeTolerance < expectedSize
    ) {
      return { matched: false, reason: "SIZE_MISMATCH" };
    }

    const orderId = normalizeTokenIdOrNull(
      payload?.order_id ?? payload?.orderId,
    );
    const tradeId = normalizeTokenIdOrNull(
      payload?.trade_id ?? payload?.tradeId,
    );
    const notificationId = normalizeTokenIdOrNull(notification?.id);
    const createdAtMs =
      this.extractRecordTimestampMs(payload) ??
      toTimestampMs(notification?.timestamp);

    return {
      matched: true,
      reason: "MATCH",
      orderId,
      tradeId,
      notificationId,
      tokenId,
      side,
      price,
      size,
      createdAtMs,
    };
  }

  resolveEvidenceSource(
    orderId,
    orderMatches = [],
    tradeMatches = [],
    notificationMatches = [],
  ) {
    if (!orderId) return null;
    if (
      orderMatches.some(
        (item) =>
          item.orderId === orderId && item.source === "DIRECT_ORDER_LOOKUP",
      )
    ) {
      return "DIRECT_ORDER_LOOKUP";
    }
    if (orderMatches.some((item) => item.orderId === orderId))
      return "OPEN_ORDER";
    if (
      tradeMatches.some(
        (item) =>
          Array.isArray(item.candidateOrderIds) &&
          item.candidateOrderIds.includes(orderId),
      )
    ) {
      return "TRADE_ORDER_ID";
    }
    if (notificationMatches.some((item) => item.orderId === orderId))
      return "NOTIFICATION_ORDER_ID";
    return null;
  }

  async confirmSubmittedOrder(intent, context = {}) {
    const tickSize = toOptionalNumber(context.tickSize);
    const intervalMs = Math.max(
      250,
      Math.floor(toFiniteNumber(context.intervalMs, 2000)),
    );
    const maxWaitMs = Math.max(
      0,
      Math.floor(toFiniteNumber(context.maxWaitMs, 0)),
    );
    const maxAttemptsFromWait =
      maxWaitMs > 0 ? Math.ceil(maxWaitMs / intervalMs) : null;
    const configuredMaxAttempts = Math.floor(
      toFiniteNumber(context.maxAttempts, 5),
    );
    const maxAttempts = Math.max(
      2,
      Math.min(
        10,
        Number.isFinite(maxAttemptsFromWait)
          ? maxAttemptsFromWait
          : configuredMaxAttempts,
      ),
    );
    const freshnessGraceMs = Math.max(
      0,
      Math.floor(toFiniteNumber(context.freshnessGraceMs, 2500)),
    );
    const submittedAtMs = toTimestampMs(context.submittedAtMs);
    const useNotifications =
      context.useNotifications !== undefined
        ? Boolean(context.useNotifications)
        : true;
    const baselineOrderIdSet = new Set(uniqueStrings(context.baselineOrderIds));
    const baselineTradeIdSet = new Set(uniqueStrings(context.baselineTradeIds));
    const baselineNotificationIdSet = new Set(
      uniqueStrings(context.baselineNotificationIds),
    );
    const signerAddress = await this.clob.getSignerAddress().catch(() => null);
    const accountAddressesChecked = uniqueStrings(
      Array.isArray(context.makerAddresses) && context.makerAddresses.length > 0
        ? context.makerAddresses
        : [this.clob.funderAddress, signerAddress],
    );
    const expectedTokenId = normalizeTokenIdOrNull(intent?.tokenId);
    const rawExpectedConditionId = normalizeTokenIdOrNull(intent?.conditionId);
    const expectedConditionId = isConditionIdHash(rawExpectedConditionId)
      ? rawExpectedConditionId
      : null;
    const candidateOrderIds = uniqueStrings(context.candidateOrderIds);
    const afterSeconds =
      submittedAtMs !== null
        ? String(
            Math.max(0, Math.floor((submittedAtMs - freshnessGraceMs) / 1000)),
          )
        : undefined;
    const orderQueryBase = {
      ...(expectedTokenId ? { asset_id: expectedTokenId } : {}),
      ...(expectedConditionId ? { market: expectedConditionId } : {}),
    };
    const tradeQueryBase = {
      ...(expectedTokenId ? { asset_id: expectedTokenId } : {}),
      ...(expectedConditionId ? { market: expectedConditionId } : {}),
      ...(afterSeconds ? { after: afterSeconds } : {}),
    };
    const confirmAttempts = [];

    let latestMatchResult = {
      mode: "NO_MATCH",
      orderMatches: [],
      tradeMatches: [],
      notificationMatches: [],
      derivedOrderIds: [],
    };

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const attemptSummary = {
        attempt: attemptIndex + 1,
        directOrderChecks: [],
        openOrders: [],
        trades: [],
        notifications: null,
        errors: [],
        orderMatches: [],
        tradeMatches: [],
        notificationMatches: [],
        derivedOrderIds: [],
        filteredOut: [],
      };

      const orderMatches = [];
      const tradeMatches = [];
      const notificationMatches = [];
      const seenTradeKeys = new Set();

      for (const candidateOrderId of candidateOrderIds) {
        try {
          const order = await this.clob.getOrder(candidateOrderId);
          const match = this.matchOrderCandidate(order, intent, tickSize);
          attemptSummary.directOrderChecks.push({
            orderId: candidateOrderId,
            found: true,
            matched: match.matched,
            reason: match.reason,
          });
          if (match.matched) {
            orderMatches.push({
              source: "DIRECT_ORDER_LOOKUP",
              accountAddress: null,
              ...match,
              orderId: match.orderId ?? candidateOrderId,
            });
          }
        } catch (error) {
          attemptSummary.directOrderChecks.push({
            orderId: candidateOrderId,
            found: false,
            matched: false,
            reason: "LOOKUP_ERROR",
          });
          attemptSummary.errors.push({
            source: "direct_order_lookup",
            orderId: candidateOrderId,
            message: error?.message ?? String(error),
          });
        }
      }

      for (const accountAddress of accountAddressesChecked) {
        try {
          const orders = await this.clob.getOpenOrders(
            {
              ...orderQueryBase,
              maker_address: accountAddress,
            },
            true,
          );
          const list = Array.isArray(orders) ? orders : [];
          attemptSummary.openOrders.push({
            accountAddress,
            count: list.length,
          });
          for (const order of list) {
            const match = this.matchOrderCandidate(order, intent, tickSize);
            if (match.matched) {
              const seenBefore =
                match.orderId && baselineOrderIdSet.has(match.orderId);
              const staleRecord =
                submittedAtMs !== null &&
                match.createdAtMs !== null &&
                match.createdAtMs + freshnessGraceMs < submittedAtMs;
              if (seenBefore || staleRecord) {
                attemptSummary.filteredOut.push({
                  source: "order",
                  accountAddress,
                  orderId: match.orderId ?? null,
                  reason: seenBefore
                    ? "BASELINE_ORDER_ID"
                    : "STALE_ORDER_TIMESTAMP",
                  createdAtMs: match.createdAtMs ?? null,
                });
                continue;
              }
              orderMatches.push({
                source: "OPEN_ORDER",
                accountAddress,
                ...match,
              });
            }
          }
        } catch (error) {
          attemptSummary.errors.push({
            source: "sync_orders",
            accountAddress,
            message: error?.message ?? String(error),
          });
        }

        const tradeQueries = [
          {
            role: "maker",
            params: { ...tradeQueryBase, maker_address: accountAddress },
          },
          {
            role: "taker",
            params: { ...tradeQueryBase, taker: accountAddress },
          },
        ];

        for (const tradeQuery of tradeQueries) {
          try {
            const trades = await this.clob.getTrades(tradeQuery.params, true);
            const list = Array.isArray(trades) ? trades : [];
            attemptSummary.trades.push({
              accountAddress,
              role: tradeQuery.role,
              count: list.length,
            });
            for (const trade of list) {
              const match = this.matchTradeCandidate(trade, intent, tickSize, {
                accountAddresses: accountAddressesChecked,
              });
              if (!match.matched) continue;

              const dedupeKey =
                match.tradeId ??
                `${match.createdAtMs ?? "na"}:${match.price ?? "na"}:${match.size ?? "na"}:${match.side ?? "na"}`;
              if (seenTradeKeys.has(dedupeKey)) continue;
              seenTradeKeys.add(dedupeKey);

              const seenBefore =
                match.tradeId && baselineTradeIdSet.has(match.tradeId);
              const staleRecord =
                submittedAtMs !== null &&
                match.createdAtMs !== null &&
                match.createdAtMs + freshnessGraceMs < submittedAtMs;
              if (seenBefore || staleRecord) {
                attemptSummary.filteredOut.push({
                  source: "trade",
                  accountAddress,
                  role: tradeQuery.role,
                  tradeId: match.tradeId ?? null,
                  reason: seenBefore
                    ? "BASELINE_TRADE_ID"
                    : "STALE_TRADE_TIMESTAMP",
                  createdAtMs: match.createdAtMs ?? null,
                });
                continue;
              }
              tradeMatches.push({
                accountAddress,
                role: tradeQuery.role,
                ...match,
              });
            }
          } catch (error) {
            attemptSummary.errors.push({
              source: "sync_trades",
              accountAddress,
              role: tradeQuery.role,
              message: error?.message ?? String(error),
            });
          }
        }
      }

      if (useNotifications) {
        try {
          const notifications = await this.clob.getNotifications();
          const list = Array.isArray(notifications)
            ? notifications
            : Array.isArray(notifications?.data)
              ? notifications.data
              : [];
          attemptSummary.notifications = { count: list.length };
          for (const notification of list) {
            const match = this.matchNotificationCandidate(
              notification,
              intent,
              tickSize,
            );
            if (!match.matched) continue;

            const seenBefore =
              (match.notificationId &&
                baselineNotificationIdSet.has(match.notificationId)) ||
              (match.tradeId && baselineTradeIdSet.has(match.tradeId)) ||
              (match.orderId && baselineOrderIdSet.has(match.orderId));
            const staleRecord =
              submittedAtMs !== null &&
              match.createdAtMs !== null &&
              match.createdAtMs + freshnessGraceMs < submittedAtMs;
            if (seenBefore || staleRecord) {
              attemptSummary.filteredOut.push({
                source: "notification",
                notificationId: match.notificationId ?? null,
                orderId: match.orderId ?? null,
                tradeId: match.tradeId ?? null,
                reason: seenBefore
                  ? "BASELINE_NOTIFICATION_OR_ORDER"
                  : "STALE_NOTIFICATION_TIMESTAMP",
                createdAtMs: match.createdAtMs ?? null,
              });
              continue;
            }
            notificationMatches.push(match);
          }
        } catch (error) {
          attemptSummary.errors.push({
            source: "sync_notifications",
            message: error?.message ?? String(error),
          });
          attemptSummary.notifications = { count: 0 };
        }
      } else {
        attemptSummary.notifications = { count: 0, skipped: true };
      }

      const orderIds = uniqueStrings(orderMatches.map((item) => item.orderId));
      const tradeDerivedOrderIds = uniqueStrings(
        tradeMatches.flatMap((item) =>
          Array.isArray(item.candidateOrderIds) ? item.candidateOrderIds : [],
        ),
      );
      const notificationOrderIds = uniqueStrings(
        notificationMatches.map((item) => item.orderId),
      );
      const derivedOrderIds = uniqueStrings([
        ...orderIds,
        ...tradeDerivedOrderIds,
        ...notificationOrderIds,
      ]);

      attemptSummary.orderMatches = orderMatches.map((item) => ({
        source: item.source ?? "OPEN_ORDER",
        accountAddress: item.accountAddress,
        orderId: item.orderId ?? null,
        price: item.price,
        size: item.size,
        createdAtMs: item.createdAtMs ?? null,
      }));
      attemptSummary.tradeMatches = tradeMatches.map((item) => ({
        accountAddress: item.accountAddress,
        role: item.role ?? null,
        tradeId: item.tradeId ?? null,
        candidateOrderIds: Array.isArray(item.candidateOrderIds)
          ? item.candidateOrderIds
          : [],
        price: item.price,
        size: item.size,
        createdAtMs: item.createdAtMs ?? null,
      }));
      attemptSummary.notificationMatches = notificationMatches.map((item) => ({
        notificationId: item.notificationId ?? null,
        orderId: item.orderId ?? null,
        tradeId: item.tradeId ?? null,
        price: item.price ?? null,
        size: item.size ?? null,
        createdAtMs: item.createdAtMs ?? null,
      }));
      attemptSummary.derivedOrderIds = derivedOrderIds;
      confirmAttempts.push(attemptSummary);

      if (derivedOrderIds.length === 1) {
        const resolvedOrderId = derivedOrderIds[0];
        const evidenceSource = this.resolveEvidenceSource(
          resolvedOrderId,
          orderMatches,
          tradeMatches,
          notificationMatches,
        );
        return {
          confirmed: true,
          orderIds: [resolvedOrderId],
          evidenceSource,
          derivedOrderIds,
          makerAddressesChecked: accountAddressesChecked,
          confirmAttempts,
          matchResult: {
            mode: "UNIQUE_ORDER_ID_EVIDENCE",
            orderMatches: attemptSummary.orderMatches,
            tradeMatches: attemptSummary.tradeMatches,
            notificationMatches: attemptSummary.notificationMatches,
            derivedOrderIds: attemptSummary.derivedOrderIds,
          },
        };
      }

      latestMatchResult = {
        mode:
          derivedOrderIds.length > 1
            ? "AMBIGUOUS_ORDER_ID_EVIDENCE"
            : tradeMatches.length > 0
              ? "TRADE_MATCH_WITHOUT_ORDER_ID"
              : notificationMatches.length > 0
                ? "NOTIFICATION_MATCH_WITHOUT_ORDER_ID"
                : "NO_MATCH",
        orderMatches: attemptSummary.orderMatches,
        tradeMatches: attemptSummary.tradeMatches,
        notificationMatches: attemptSummary.notificationMatches,
        derivedOrderIds: attemptSummary.derivedOrderIds,
      };

      if (attemptIndex < maxAttempts - 1) {
        await sleep(intervalMs);
      }
    }

    return {
      confirmed: false,
      orderIds: [],
      evidenceSource: null,
      derivedOrderIds: latestMatchResult.derivedOrderIds ?? [],
      makerAddressesChecked: accountAddressesChecked,
      confirmAttempts,
      matchResult: latestMatchResult,
    };
  }

  async captureSubmissionBaseline() {
    const signerAddress = await this.clob.getSignerAddress().catch(() => null);
    const makerAddressesChecked = uniqueStrings([
      this.clob.funderAddress,
      signerAddress,
    ]);
    const orderIds = [];
    const tradeIds = [];
    const notificationIds = [];
    const errors = [];

    for (const makerAddress of makerAddressesChecked) {
      try {
        const orders = await this.clob.getOpenOrders(
          { maker_address: makerAddress },
          true,
        );
        for (const order of Array.isArray(orders) ? orders : []) {
          orderIds.push(...this.extractOrderIdsFromPayload(order));
        }
      } catch (error) {
        errors.push({
          source: "baseline_orders",
          makerAddress,
          message: error?.message ?? String(error),
        });
      }

      try {
        const trades = await this.clob.getTrades(
          { maker_address: makerAddress },
          true,
        );
        for (const trade of Array.isArray(trades) ? trades : []) {
          tradeIds.push(...this.extractTradeIdsFromPayload(trade));
        }
      } catch (error) {
        errors.push({
          source: "baseline_trades",
          makerAddress,
          message: error?.message ?? String(error),
        });
      }
    }

    try {
      const notifications = await this.clob.getNotifications();
      const list = Array.isArray(notifications)
        ? notifications
        : Array.isArray(notifications?.data)
          ? notifications.data
          : [];
      for (const notification of list) {
        const notificationId = normalizeTokenIdOrNull(notification?.id);
        if (notificationId) notificationIds.push(notificationId);
      }
    } catch (error) {
      errors.push({
        source: "baseline_notifications",
        message: error?.message ?? String(error),
      });
    }

    return {
      capturedAtMs: Date.now(),
      makerAddressesChecked,
      orderIds: uniqueStrings(orderIds),
      tradeIds: uniqueStrings(tradeIds),
      notificationIds: uniqueStrings(notificationIds),
      errors,
    };
  }

  async executeSkillSignal(signal, context = {}) {
    const startedAt = Date.now();
    const idempotencyKey =
      context.idempotencyKey ??
      `${signal.skillId}:${signal.marketSelector.tokenId}:${signal.side}`;

    if (this.idempotency.has(idempotencyKey)) {
      return this.idempotency.get(idempotencyKey);
    }

    const quoteContext = await this.buildQuoteContext(signal);
    const intent = this.compiler.compile(signal, {
      ...context,
      ...quoteContext,
    });
    const normalization = await this.normalizeIntentForMarket(
      intent,
      signal.side,
      {
        retries: 1,
        retryDelayMs: 120,
        priceOffsetTicks: context.marketCrossTicks ?? 3,
        executionMode: context.executionMode,
        marketDefaultTif: context.marketDefaultTif,
      },
    );
    const normalizedIntent = normalization.intent ?? intent;

    if (normalization.blocked) {
      const riskDecision = {
        decision: RiskDecisionKind.HARD_BLOCK,
        effectiveAction: RiskEffectiveAction.BLOCK,
        reasonCodes: [
          normalization.error?.code ?? "MARKET_METADATA_UNAVAILABLE",
        ],
        requiredActions: ["Retry after market metadata endpoints recover"],
        diagnostics: {
          metadataRetry:
            normalization.error?.retrySummary ??
            normalization.adjustments?.retries ??
            [],
        },
      };

      const executionPlan = {
        preChecks: [
          {
            name: "market-metadata",
            passed: false,
            diagnostics: normalization.error,
          },
        ],
        orders: [normalizedIntent],
        cancelRules: ["cancel-all-on-fatal-error", "cancel-stale-gtd-orders"],
        fallbackRules: [
          "retry-transient-errors",
          "fallback-to-market-order-if-configured",
        ],
        maxRetries: this.config.retry.retries,
      };

      const result = {
        accepted: false,
        orderIds: [],
        tradeIds: [],
        finalStatus: "BLOCKED",
        errorCode: normalization.error?.code ?? "MARKET_METADATA_UNAVAILABLE",
        warnings: uniqueWarnings(normalization.warnings),
        rawExchangePayload: {
          riskDecision,
          executionPlan,
          adjustments: normalization.adjustments,
        },
      };

      this.idempotency.set(idempotencyKey, result);
      this.metrics.inc("risk_blocked_total", 1, {
        decision: riskDecision.decision,
      });
      this.audit.write("execution.blocked", {
        signal,
        intent: normalizedIntent,
        riskDecision,
        normalization,
      });
      return result;
    }

    const riskDecision = await this.risk.evaluate(normalizedIntent, {
      skillId: signal.skillId,
      countryCode: context.countryCode,
    });

    const executionPlan = {
      preChecks: [
        {
          name: "market-metadata",
          passed: true,
          diagnostics: {
            retries: normalization.adjustments?.retries ?? [],
            metadata: normalization.metadata,
            adjustments: normalization.adjustments,
          },
        },
        {
          name: "risk",
          passed: riskDecision.effectiveAction === RiskEffectiveAction.CONTINUE,
          diagnostics: riskDecision,
        },
      ],
      orders: [normalizedIntent],
      cancelRules: ["cancel-all-on-fatal-error", "cancel-stale-gtd-orders"],
      fallbackRules: [
        "retry-transient-errors",
        "fallback-to-market-order-if-configured",
      ],
      maxRetries: this.config.retry.retries,
    };

    if (riskDecision.effectiveAction === RiskEffectiveAction.BLOCK) {
      const result = {
        accepted: false,
        orderIds: [],
        tradeIds: [],
        finalStatus: "BLOCKED",
        errorCode:
          riskDecision.decision === RiskDecisionKind.HARD_BLOCK
            ? "RISK_HARD_BLOCK"
            : "RISK_SOFT_BLOCK",
        warnings: uniqueWarnings([
          ...(riskDecision.reasonCodes ?? []),
          ...(normalization.warnings ?? []),
        ]),
        rawExchangePayload: {
          riskDecision,
          executionPlan,
          adjustments: normalization.adjustments,
        },
      };
      this.idempotency.set(idempotencyKey, result);
      this.metrics.inc("risk_blocked_total", 1, {
        decision: riskDecision.decision,
      });
      this.audit.write("execution.blocked", {
        signal,
        intent: normalizedIntent,
        riskDecision,
        normalization,
      });
      return result;
    }

    const warnings = uniqueWarnings([
      ...(riskDecision.reasonCodes ?? []),
      ...(normalization.warnings ?? []),
    ]);
    const result = await this.placeIntent(
      normalizedIntent,
      signal.skillId,
      warnings,
      riskDecision,
      normalization,
      context,
    );

    this.idempotency.set(idempotencyKey, result);
    this.metrics.observe("execution_latency_ms", Date.now() - startedAt);
    this.audit.write("execution.completed", {
      signal,
      intent: normalizedIntent,
      result,
    });

    return result;
  }

  async placeIntent(
    intent,
    skillId,
    warnings = [],
    riskDecision = undefined,
    normalization = undefined,
    context = {},
  ) {
    try {
      const nextWarnings = uniqueWarnings(warnings);
      const orderOptions = {};
      const tickSize = toOptionalNumber(normalization?.metadata?.tickSize);
      let negRisk = normalization?.metadata?.negRisk;
      // SDK TickSize type is "0.1" | "0.01" | "0.001" | "0.0001" — must be string, not number.
      if (tickSize !== null && tickSize > 0)
        orderOptions.tickSize = String(tickSize);

      // ── negRisk is CRITICAL: it determines the exchange contract used for signing ──
      // If metadata didn't resolve it, make one final attempt before giving up.
      if (typeof negRisk !== "boolean") {
        try {
          const fallbackNegRisk = await this.clob.getNegRisk(intent.tokenId);
          if (typeof fallbackNegRisk === "boolean") {
            negRisk = fallbackNegRisk;
            nextWarnings.push("NEG_RISK_RESOLVED_BY_FALLBACK");
          }
        } catch (_negRiskErr) {
          // swallow — warning below covers this
        }
      }
      if (typeof negRisk !== "boolean") {
        // Default to false (standard exchange) with a loud warning.
        // Most Polymarket markets are NOT neg-risk, so false is the safer default.
        negRisk = false;
        nextWarnings.push("NEG_RISK_UNRESOLVED_DEFAULTING_FALSE");
      }
      orderOptions.negRisk = negRisk;

      // ── Inject feeRateBps from metadata into intent ──
      // Prevents SDK from needing to fetch it again (which may fail in proxy envs).
      const metadataFeeRate = toOptionalNumber(
        normalization?.metadata?.feeRateBps,
      );
      if (metadataFeeRate !== null && intent.feeRateBps === undefined) {
        intent.feeRateBps = metadataFeeRate;
        nextWarnings.push("FEE_RATE_BPS_INJECTED_FROM_METADATA");
      }

      const resolvedOrderOptions =
        Object.keys(orderOptions).length > 0 ? orderOptions : undefined;
      const submissionBaseline = await this.captureSubmissionBaseline();
      const submissionStartedAtMs = Date.now();

      let payload;
      let localDerivedOrderId = null;
      let submissionTimeoutError = null;
      let submissionAttempts = [];
      try {
        if (intent.orderType === "MARKET") {
          const marketOrderType = normalizeMarketTimeInForce(
            intent.timeInForce,
            "FAK",
          );
          const marketOrder = await this.clob.createMarketOrder(
            this.clob.toUserMarketOrder(intent),
            resolvedOrderOptions,
          );
          localDerivedOrderId = normalizeTokenIdOrNull(
            this.clob.deriveOrderId(marketOrder, Boolean(negRisk)),
          );

          // ── Try direct submission first (bypasses patched transport) ──
          try {
            payload = await this.clob.postOrderDirect(
              marketOrder,
              marketOrderType,
              false,
              false,
            );
            submissionAttempts.push({ mode: "direct", success: true });
          } catch (directErr) {
            submissionAttempts.push({
              mode: "direct",
              success: false,
              error: directErr?.message ?? String(directErr),
              status: directErr?.status ?? directErr?.details?.status ?? null,
              responseBody:
                directErr?.details?.body ??
                directErr?.details?.submissionError ??
                null,
              upstreamResponseBody:
                directErr?.details?.upstreamResponseBody ?? null,
              orderPayloadSent: directErr?.details?.orderPayloadSent ?? null,
            });
            // ── Fallback to SDK path ──
            try {
              payload = await this.clob.postOrder(
                marketOrder,
                marketOrderType,
                false,
                false,
              );
              submissionAttempts.push({ mode: "sdk_fallback", success: true });
            } catch (sdkErr) {
              submissionAttempts.push({
                mode: "sdk_fallback",
                success: false,
                error: sdkErr?.message ?? String(sdkErr),
                status: sdkErr?.status ?? sdkErr?.details?.status ?? null,
                responseBody:
                  sdkErr?.details?.body ??
                  sdkErr?.details?.invalidSubmission ??
                  null,
              });
              throw sdkErr;
            }
          }
        } else {
          const limitOrder = await this.clob.createOrder(
            this.clob.toUserOrder(intent),
            resolvedOrderOptions,
          );
          localDerivedOrderId = normalizeTokenIdOrNull(
            this.clob.deriveOrderId(limitOrder, Boolean(negRisk)),
          );
          // SDK postOrder → orderToJson throws when postOnly=true + FAK/FOK.
          // FAK/FOK means "fill immediately or cancel" which contradicts postOnly
          // ("only add to book, never fill"). Force postOnly=false for FAK/FOK.
          const effectivePostOnly = isImmediateOrCancelTif(intent.timeInForce)
            ? false
            : Boolean(intent.postOnly);
          if (Boolean(intent.postOnly) && !effectivePostOnly) {
            nextWarnings.push("POST_ONLY_DOWNGRADED_FOR_FAK_FOK");
          }

          // ── Try direct submission first (bypasses patched transport) ──
          try {
            payload = await this.clob.postOrderDirect(
              limitOrder,
              intent.timeInForce,
              false,
              effectivePostOnly,
            );
            submissionAttempts.push({ mode: "direct", success: true });
          } catch (directErr) {
            submissionAttempts.push({
              mode: "direct",
              success: false,
              error: directErr?.message ?? String(directErr),
              status: directErr?.status ?? directErr?.details?.status ?? null,
              responseBody:
                directErr?.details?.body ??
                directErr?.details?.submissionError ??
                null,
              upstreamResponseBody:
                directErr?.details?.upstreamResponseBody ?? null,
              orderPayloadSent: directErr?.details?.orderPayloadSent ?? null,
            });
            // ── Fallback to SDK path ──
            try {
              payload = await this.clob.postOrder(
                limitOrder,
                intent.timeInForce,
                false,
                effectivePostOnly,
              );
              submissionAttempts.push({ mode: "sdk_fallback", success: true });
            } catch (sdkErr) {
              submissionAttempts.push({
                mode: "sdk_fallback",
                success: false,
                error: sdkErr?.message ?? String(sdkErr),
                status: sdkErr?.status ?? sdkErr?.details?.status ?? null,
                responseBody:
                  sdkErr?.details?.body ??
                  sdkErr?.details?.invalidSubmission ??
                  null,
              });
              throw sdkErr;
            }
          }
        }
      } catch (error) {
        if (this.isSubmissionTimeoutError(error)) {
          submissionTimeoutError = error;
          payload = {
            __openclawInvalidSubmission: true,
            operation: "postOrder.timeout",
            endpoint: "/order",
            initialPayload: null,
            timeoutError: {
              message: error?.message ?? String(error),
              code: error?.details?.code ?? error?.code ?? null,
            },
          };
          submissionAttempts.push({
            mode: "timeout",
            success: false,
            error: error?.message ?? String(error),
          });
          nextWarnings.push("ORDER_SUBMISSION_TIMEOUT_SYNC_CONFIRM");
        } else {
          throw error;
        }
      }

      let orderIds = this.extractOrderIdsFromPayload(payload);
      const tradeIds = this.extractTradeIdsFromPayload(payload);

      // ── FAK/FOK success detection without explicit orderID ──
      // SDK OrderResponse may have { success: true, status: "matched",
      // transactionsHashes: [...] } but orderID could be "" or missing.
      // If we can't extract an orderID but the response clearly indicates
      // a fill, use the locally-derived order hash as the canonical ID
      // so we don't enter the confirmation loop and falsely report
      // FAK_NOT_FILLED on a real fill (which would lose track of spent funds).
      let fakMatchedByResponse = false;
      if (
        isImmediateOrCancelTif(intent.timeInForce) &&
        orderIds.length === 0 &&
        !this.isInvalidSubmissionPayload(payload) &&
        this.isFakSuccessResponse(payload)
      ) {
        fakMatchedByResponse = true;
        if (localDerivedOrderId) {
          orderIds = [localDerivedOrderId];
        }
        nextWarnings.push("FAK_MATCHED_BY_RESPONSE_METADATA");
      }

      const confirmationCandidates = uniqueStrings(
        [...orderIds, localDerivedOrderId].filter(Boolean),
      );
      const confirmConfig = this.config?.submissionConfirm ?? {};
      const confirmationPolicy = normalizeConfirmationPolicy(
        context.confirmationPolicy ?? confirmConfig.policy,
        "unique_order_id_evidence",
      );
      const confirmationUseNotifications =
        context.confirmationUseNotifications !== undefined
          ? Boolean(context.confirmationUseNotifications)
          : Boolean(confirmConfig.useNotifications ?? true);
      const confirmationMaxWaitMs = Math.max(
        0,
        Math.floor(
          toFiniteNumber(
            context.confirmationMaxWaitMs ?? confirmConfig.maxWaitMs ?? 0,
            0,
          ),
        ),
      );
      if (intent.conditionId && !isConditionIdHash(intent.conditionId)) {
        nextWarnings.push("INVALID_CONDITION_ID_FILTER_SKIPPED");
      }
      const submissionDiagnostics = {
        initialPayload: payload?.__openclawInvalidSubmission
          ? payload.initialPayload
          : payload,
        baseline: submissionBaseline,
        submissionAttempts,
        confirmAttempts: [],
        evidenceSource: orderIds.length > 0 ? "UPSTREAM" : null,
        derivedOrderIds: confirmationCandidates,
        localDerivedOrderId,
        submissionTimeoutError: submissionTimeoutError
          ? {
              message:
                submissionTimeoutError?.message ??
                String(submissionTimeoutError),
              code:
                submissionTimeoutError?.details?.code ??
                submissionTimeoutError?.code ??
                null,
            }
          : null,
        matchResult: {
          mode: fakMatchedByResponse
            ? "FAK_MATCHED_BY_RESPONSE"
            : orderIds.length > 0
              ? "UPSTREAM_RESPONSE_WITH_ORDER_ID"
              : "UPSTREAM_RESPONSE_MISSING_ORDER_ID",
          orderMatches: [],
          tradeMatches: [],
          notificationMatches: [],
          derivedOrderIds: confirmationCandidates,
        },
        makerAddressesChecked: [],
      };
      let finalStatus = fakMatchedByResponse
        ? "FAK_MATCHED"
        : orderIds.length > 0
          ? (payload?.status ?? "SUBMITTED")
          : null;

      if (
        !fakMatchedByResponse &&
        (this.isInvalidSubmissionPayload(payload) || orderIds.length === 0)
      ) {
        if (confirmationPolicy === "strict_upstream_only") {
          throw new RiskBlockedError(
            "Order submission could not be confirmed",
            {
              errorCode: "ORDER_SUBMISSION_UNCONFIRMED",
              error:
                "Exchange submission response missing order id under strict_upstream_only confirmation policy",
              intent,
              warnings: nextWarnings,
              adjustments: normalization?.adjustments,
              submissionDiagnostics: {
                ...submissionDiagnostics,
                matchResult: {
                  ...submissionDiagnostics.matchResult,
                  mode: "STRICT_UPSTREAM_ONLY",
                },
              },
              rawExchangePayload: {
                exchange: payload,
                riskDecision,
                adjustments: normalization?.adjustments,
                submissionDiagnostics: {
                  ...submissionDiagnostics,
                  matchResult: {
                    ...submissionDiagnostics.matchResult,
                    mode: "STRICT_UPSTREAM_ONLY",
                  },
                },
              },
              recommendedActions: [
                "Retry pm_order_place with a new idempotencyKey",
                "Switch confirmationPolicy to unique_order_id_evidence for proxy environments",
              ],
            },
          );
        }

        const confirmation = await this.confirmSubmittedOrder(intent, {
          tickSize,
          maxAttempts: confirmConfig.maxAttempts ?? 5,
          intervalMs: confirmConfig.intervalMs ?? 2000,
          freshnessGraceMs: confirmConfig.freshnessGraceMs ?? 2500,
          maxWaitMs: confirmationMaxWaitMs,
          useNotifications: confirmationUseNotifications,
          confirmationPolicy,
          submittedAtMs: submissionStartedAtMs,
          baselineOrderIds: submissionBaseline.orderIds,
          baselineTradeIds: submissionBaseline.tradeIds,
          baselineNotificationIds: submissionBaseline.notificationIds,
          makerAddresses: submissionBaseline.makerAddressesChecked,
          candidateOrderIds: confirmationCandidates,
        });
        submissionDiagnostics.confirmAttempts =
          confirmation.confirmAttempts ?? [];
        submissionDiagnostics.matchResult =
          confirmation.matchResult ?? submissionDiagnostics.matchResult;
        submissionDiagnostics.makerAddressesChecked =
          confirmation.makerAddressesChecked ?? [];
        submissionDiagnostics.derivedOrderIds =
          confirmation.derivedOrderIds ?? [];
        submissionDiagnostics.evidenceSource =
          confirmation.evidenceSource ?? null;

        if (confirmation.confirmed && confirmation.orderIds.length === 1) {
          orderIds = confirmation.orderIds;
          finalStatus = "CONFIRMED_BY_SYNC";
          nextWarnings.push("ORDER_CONFIRMED_BY_SYNC_LOOKUP");
          if (submissionTimeoutError) {
            nextWarnings.push("ORDER_CONFIRMED_AFTER_SUBMISSION_TIMEOUT");
          }
          if (confirmation.evidenceSource === "TRADE_ORDER_ID") {
            nextWarnings.push("ORDER_CONFIRMED_BY_TRADE_ORDER_ID");
          } else if (confirmation.evidenceSource === "NOTIFICATION_ORDER_ID") {
            nextWarnings.push("ORDER_CONFIRMED_BY_NOTIFICATION_ORDER_ID");
          } else if (confirmation.evidenceSource === "DIRECT_ORDER_LOOKUP") {
            nextWarnings.push("ORDER_CONFIRMED_BY_DIRECT_ORDER_LOOKUP");
          }
        } else if (
          isImmediateOrCancelTif(intent.timeInForce) &&
          (confirmation.matchResult?.mode === "NO_MATCH" ||
            confirmation.matchResult?.mode ===
              "NOTIFICATION_MATCH_WITHOUT_ORDER_ID")
        ) {
          // FAK/FOK orders are ephemeral: they either fill immediately or are killed.
          // When the confirmation loop finds NO evidence (no open orders, no trades,
          // no notifications), the order was either never received or didn't match.
          // Both outcomes mean "no fill" for FAK/FOK — this is expected behavior,
          // NOT an error. Return a graceful result instead of blocking the agent.
          orderIds = [];
          finalStatus = submissionTimeoutError
            ? "FAK_TIMEOUT_NO_EVIDENCE"
            : "FAK_NOT_FILLED";
          nextWarnings.push("FAK_NO_FILL_EVIDENCE_AFTER_CONFIRMATION");
          if (submissionTimeoutError) {
            nextWarnings.push("FAK_SUBMISSION_TIMEOUT_ASSUMED_NO_FILL");
          }
        } else {
          throw new RiskBlockedError(
            "Order submission could not be confirmed",
            {
              errorCode: "ORDER_SUBMISSION_UNCONFIRMED",
              error:
                "Exchange submission response missing order id and sync lookup could not uniquely confirm the order",
              intent,
              warnings: nextWarnings,
              adjustments: normalization?.adjustments,
              submissionDiagnostics,
              rawExchangePayload: {
                exchange: payload,
                riskDecision,
                adjustments: normalization?.adjustments,
                submissionDiagnostics,
              },
              recommendedActions: [
                "Run pm_sync_orders and pm_sync_trades for signer/funder addresses",
                "Inspect pm_profile_get or notifications for fresh order_id/trade_id evidence",
                "Retry pm_order_place with a new idempotencyKey",
              ],
            },
          );
        }
      }

      if (!finalStatus) {
        finalStatus = "SUBMITTED";
      }

      const isFakNotFilled =
        finalStatus === "FAK_NOT_FILLED" ||
        finalStatus === "FAK_TIMEOUT_NO_EVIDENCE";

      if (!isFakNotFilled) {
        const notionalPrice = Number(
          intent.limitPrice ?? intent.referencePrice ?? 0,
        );
        let notional = Number(intent.size) * notionalPrice;
        if (intent.orderType === "MARKET") {
          if (intent.side === "BUY") {
            notional = Number(intent.amount ?? 0);
          } else {
            notional = Number(intent.amount ?? 0) * notionalPrice;
          }
        }
        this.risk.recordFilledIntent(
          skillId,
          intent.conditionId ?? intent.tokenId,
          notional,
        );
      }

      this.metrics.inc("orders_submitted_total", 1, { type: intent.orderType });

      return {
        accepted: true,
        orderIds: uniqueStrings(orderIds),
        tradeIds,
        finalStatus,
        warnings: uniqueWarnings(nextWarnings),
        rawExchangePayload: {
          exchange: payload,
          riskDecision,
          adjustments: normalization?.adjustments,
          submissionDiagnostics,
        },
      };
    } catch (error) {
      this.metrics.inc("orders_failed_total", 1, { type: intent.orderType });
      if (error instanceof RiskBlockedError) {
        throw error;
      }
      // \u2500\u2500 Surface the upstream response body in the thrown error \u2500\u2500
      // This is critical for diagnosing 400 errors from the CLOB API.
      const upstreamResponseBody =
        error?.details?.upstreamResponseBody ?? error?.details?.body ?? null;
      const orderPayloadSent = error?.details?.orderPayloadSent ?? null;
      throw new RiskBlockedError("Order placement failed", {
        errorCode:
          error?.details?.code ?? error?.code ?? "ORDER_PLACEMENT_FAILED",
        error: error?.message ?? String(error),
        upstreamResponseBody,
        orderPayloadSent,
        stack: error?.stack,
        intent,
        adjustments: normalization?.adjustments,
      });
    }
  }

  async buildQuoteContext(signal) {
    const tokenId = signal.marketSelector.tokenId;
    if (!tokenId) return {};

    const quoteBudgetMs = Math.min(
      12000,
      Math.max(
        2000,
        Math.floor(Number(this.config.requestTimeoutMs ?? 30000) * 0.4),
      ),
    );
    const quote = await this.withSoftTimeout(
      this.quote.getQuote(tokenId, signal.side),
      quoteBudgetMs,
      null,
    );
    if (!quote) {
      return {
        bestPrice: 0,
        midpoint: 0,
        referencePrice: 0,
      };
    }

    const pricePayload = quote.price;
    const midpointPayload = quote.midpoint;

    const bestPrice = Number(
      pricePayload?.price ?? pricePayload?.BUY ?? pricePayload?.SELL ?? 0,
    );
    const midpoint = Number(
      midpointPayload?.mid ??
        midpointPayload?.midpoint ??
        midpointPayload?.price ??
        0,
    );

    return {
      bestPrice,
      midpoint,
      referencePrice: bestPrice || midpoint,
    };
  }
}
