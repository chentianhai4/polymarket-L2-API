function getFirst(obj, keys, defaultValue = undefined) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  }
  return defaultValue;
}

function normalizeTokenIds(market) {
  const direct = getFirst(market, ["clobTokenIds", "clob_token_ids", "tokenIds", "token_ids"], []);
  if (Array.isArray(direct) && direct.length > 0) return direct.map(String);
  if (typeof direct === "string" && direct.trim()) {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
    } catch {
      // Ignore parse failure and keep trying other shapes.
    }
  }

  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map((x) => getFirst(x, ["id", "tokenId", "token_id", "clobTokenId", "clob_token_id"], undefined))
      .filter(Boolean)
      .map(String);
  }

  if (Array.isArray(market?.outcomes) && Array.isArray(market?.outcomeTokenIds)) {
    return market.outcomeTokenIds.map(String);
  }

  return [];
}

function addTagCandidates(out, value) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    for (const item of value) addTagCandidates(out, item);
    return;
  }

  if (typeof value === "object") {
    for (const key of ["slug", "id", "label", "name"]) {
      const candidate = value?.[key];
      if (candidate === undefined || candidate === null) continue;
      const normalized = String(candidate).trim().toLowerCase();
      if (normalized) out.add(normalized);
    }
    return;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;

    const looksJsonArray = text.startsWith("[") && text.endsWith("]");
    const looksJsonObject = text.startsWith("{") && text.endsWith("}");
    if (looksJsonArray || looksJsonObject) {
      try {
        addTagCandidates(out, JSON.parse(text));
        return;
      } catch {
        // Ignore malformed serialized tags and continue.
      }
    }

    if (text.includes(",")) {
      for (const part of text.split(",")) addTagCandidates(out, part);
      return;
    }

    out.add(text.toLowerCase());
    return;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized) out.add(normalized);
}

function normalizeTagSet(value) {
  const out = new Set();
  addTagCandidates(out, value);
  return out;
}

export class MarketDiscoveryService {
  constructor({ gammaClient }) {
    this.gamma = gammaClient;
    this.cache = {
      eventsById: new Map(),
      marketsByConditionId: new Map(),
      marketsByTokenId: new Map(),
      refreshedAt: 0,
    };
  }

  async refresh(filters = {}) {
    const markets = await this.gamma.discover(filters);

    for (const market of markets) {
      const eventId = getFirst(market, ["eventId", "event_id"]);
      const conditionId = getFirst(market, ["conditionId", "condition_id", "conditionIdHex"]);
      const tokenIds = normalizeTokenIds(market);

      if (eventId) this.cache.eventsById.set(String(eventId), market);
      if (conditionId) this.cache.marketsByConditionId.set(String(conditionId), market);
      for (const tokenId of tokenIds) {
        this.cache.marketsByTokenId.set(String(tokenId), market);
      }
    }

    this.cache.refreshedAt = Date.now();
    return {
      count: markets.length,
      refreshedAt: this.cache.refreshedAt,
    };
  }

  getByTokenId(tokenId) {
    return this.cache.marketsByTokenId.get(String(tokenId));
  }

  getByConditionId(conditionId) {
    return this.cache.marketsByConditionId.get(String(conditionId));
  }

  search({ tokenId, conditionId, query, tags, eventSlug } = {}) {
    if (tokenId) {
      const market = this.getByTokenId(tokenId);
      return market ? [market] : [];
    }

    if (conditionId) {
      const market = this.getByConditionId(conditionId);
      return market ? [market] : [];
    }

    const requestedTags = normalizeTagSet(tags);
    const all = Array.from(new Set(this.cache.marketsByTokenId.values()));
    return all.filter((market) => {
      const slug = String(market.slug ?? "").toLowerCase();
      const question = String(market.question ?? market.title ?? "").toLowerCase();
      const q = String(query ?? "").toLowerCase();

      if (q && !slug.includes(q) && !question.includes(q)) return false;
      if (eventSlug && slug !== eventSlug.toLowerCase()) return false;
      if (requestedTags.size > 0) {
        const marketTags = normalizeTagSet(market.tags);
        let matched = false;
        for (const tag of requestedTags) {
          if (marketTags.has(tag)) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      return true;
    });
  }
}
