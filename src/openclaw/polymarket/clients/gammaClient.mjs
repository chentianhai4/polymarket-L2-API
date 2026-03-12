import { HttpClient } from "../http/httpClient.mjs";

const TAG_DISCOVER_MAX_PAGES = 10;
const TAG_DISCOVER_PAGE_SIZE = 20;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTokenIds(market) {
  const direct = market?.clobTokenIds ?? market?.clob_token_ids ?? market?.outcomeTokenIds ?? [];
  if (Array.isArray(direct)) return direct.map((x) => String(x));
  if (typeof direct === "string" && direct.trim()) {
    try {
      const parsed = JSON.parse(direct);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      // ignore invalid json
    }
  }
  if (Array.isArray(market?.tokens)) {
    return market.tokens
      .map((x) => x?.id ?? x?.tokenId ?? x?.token_id ?? x?.asset ?? x?.asset_id)
      .filter(Boolean)
      .map((x) => String(x));
  }
  return [];
}

function isTradableMarket(market) {
  if (!market || typeof market !== "object") return false;
  if (market.closed === true) return false;
  if (market.archived === true) return false;
  return normalizeTokenIds(market).length > 0;
}

function marketDedupKey(market) {
  const id = market?.id;
  if (id !== undefined && id !== null && String(id) !== "") return `id:${String(id)}`;

  const conditionId = market?.conditionId ?? market?.condition_id;
  if (conditionId !== undefined && conditionId !== null && String(conditionId) !== "") {
    return `condition:${String(conditionId)}`;
  }

  const slug = market?.slug;
  if (slug !== undefined && slug !== null && String(slug) !== "") return `slug:${String(slug)}`;
  return null;
}

function dedupeMarkets(markets) {
  const seen = new Set();
  const out = [];
  for (const market of asArray(markets)) {
    const key = marketDedupKey(market);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(market);
  }
  return out;
}

function extractSearchMarkets(searchPayload) {
  if (Array.isArray(searchPayload)) return dedupeMarkets(searchPayload);

  const payload = searchPayload?.data ?? searchPayload ?? {};
  if (Array.isArray(payload)) return dedupeMarkets(payload);

  const directMarkets = asArray(payload?.markets);
  const eventMarkets = asArray(payload?.events).flatMap((event) => asArray(event?.markets));
  return dedupeMarkets([...directMarkets, ...eventMarkets]);
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
        // Ignore invalid serialized tag payload and continue.
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

function eventTagList(event) {
  const tags = [];
  const seen = new Set();

  const push = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    tags.push(normalized);
  };

  for (const tag of asArray(event?.tags)) {
    if (tag && typeof tag === "object") {
      if (tag.slug !== undefined && tag.slug !== null && String(tag.slug).trim() !== "") {
        push(tag.slug);
      } else if (tag.id !== undefined && tag.id !== null) {
        push(tag.id);
      } else if (tag.label !== undefined && tag.label !== null && String(tag.label).trim() !== "") {
        push(tag.label);
      }
      continue;
    }

    const normalized = String(tag ?? "").trim().toLowerCase();
    if (normalized) push(normalized);
  }

  return tags;
}

function eventMatchesRequestedTags(event, requestedTags) {
  if (!(requestedTags instanceof Set) || requestedTags.size === 0) return true;

  const eventTags = normalizeTagSet(event?.tags);
  for (const requested of requestedTags) {
    if (eventTags.has(requested)) return true;
  }
  return false;
}

function mergeMarketTags({ market, inheritedTags = [] }) {
  const merged = normalizeTagSet(market?.tags);
  for (const tag of inheritedTags) {
    const normalized = String(tag ?? "").trim().toLowerCase();
    if (normalized) merged.add(normalized);
  }
  return Array.from(merged);
}

export class GammaClient {
  constructor({ config }) {
    this.config = config;
    this.http = new HttpClient({
      rateLimit: config.rateLimits.gamma,
      retry: config.retry,
      adapter: "fetch",
      fallbackToCurl: true,
      timeoutMs: config.requestTimeoutMs,
      proxyUrl: config.proxyUrl,
    });
  }

  url(path) {
    return `${this.config.gammaHost}${path}`;
  }

  withPathParam(pathTemplate, key, value) {
    return pathTemplate.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  async getEvents(query = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.gamma.events), query);
    return res.data;
  }

  async getEventById(id, query = {}) {
    const path = `${this.config.endpoints.gamma.events}/{id}`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getEventBySlug(slug, query = {}) {
    const path = `${this.config.endpoints.gamma.events}/slug/{slug}`;
    const res = await this.http.get(this.url(this.withPathParam(path, "slug", slug)), query);
    return res.data;
  }

  async getEventTags(id, query = {}) {
    const path = `${this.config.endpoints.gamma.events}/{id}/tags`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getMarkets(query = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.gamma.markets), query);
    return res.data;
  }

  async getTags(query = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.gamma.tags), query);
    return res.data;
  }

  async getTagById(id, query = {}) {
    const path = `${this.config.endpoints.gamma.tags}/{id}`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getTagBySlug(slug, query = {}) {
    const path = `${this.config.endpoints.gamma.tags}/slug/{slug}`;
    const res = await this.http.get(this.url(this.withPathParam(path, "slug", slug)), query);
    return res.data;
  }

  async getTagRelatedRelationsById(id, query = {}) {
    const path = `${this.config.endpoints.gamma.tags}/{id}/related-tags`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getTagRelatedRelationsBySlug(slug, query = {}) {
    const path = `${this.config.endpoints.gamma.tags}/slug/{slug}/related-tags`;
    const res = await this.http.get(this.url(this.withPathParam(path, "slug", slug)), query);
    return res.data;
  }

  async getTagRelatedTagsById(id, query = {}) {
    const path = `${this.config.endpoints.gamma.tags}/{id}/related-tags/tags`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getTagRelatedTagsBySlug(slug, query = {}) {
    const path = `${this.config.endpoints.gamma.tags}/slug/{slug}/related-tags/tags`;
    const res = await this.http.get(this.url(this.withPathParam(path, "slug", slug)), query);
    return res.data;
  }

  async getSeries(query = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.gamma.series), query);
    return res.data;
  }

  async getSeriesById(id, query = {}) {
    const path = `${this.config.endpoints.gamma.series}/{id}`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getComments(query = {}) {
    const res = await this.http.get(this.url(this.config.endpoints.gamma.comments), query);
    return res.data;
  }

  async getCommentById(id, query = {}) {
    const path = `${this.config.endpoints.gamma.comments}/{id}`;
    const res = await this.http.get(this.url(this.withPathParam(path, "id", id)), query);
    return res.data;
  }

  async getCommentsByUserAddress(userAddress, query = {}) {
    const path = `${this.config.endpoints.gamma.comments}/user_address/{user_address}`;
    const patched = this.withPathParam(path, "user_address", userAddress);
    const res = await this.http.get(this.url(patched), query);
    return res.data;
  }

  async getPublicProfile(query = {}) {
    const path = this.config.endpoints.gamma.publicProfile;
    const res = await this.http.get(this.url(path), query);
    return res.data;
  }

  async getSportsMeta(query = {}) {
    const path = this.config.endpoints.gamma.sports;
    const res = await this.http.get(this.url(path), query);
    return res.data;
  }

  async getSportsMarketTypes(query = {}) {
    const path = this.config.endpoints.gamma.sportsMarketTypes;
    const res = await this.http.get(this.url(path), query);
    return res.data;
  }

  async getTeams(query = {}) {
    const path = this.config.endpoints.gamma.teams;
    const res = await this.http.get(this.url(path), query);
    return res.data;
  }

  async search(query = {}) {
    const path = this.config.endpoints.gamma.search;
    const params = { ...(query ?? {}) };
    if (params.limit !== undefined && params.limit_per_type === undefined) {
      params.limit_per_type = params.limit;
    }
    const res = await this.http.get(this.url(path), params);
    return res.data;
  }

  async discoverByEventTags({
    query,
    tags,
    eventSlug,
    limit = 200,
    active = undefined,
    closed = undefined,
    archived = undefined,
    tradableOnly = true,
  } = {}) {
    const requestedTags = normalizeTagSet(tags);
    if (requestedTags.size === 0) return [];

    const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 200;
    const needle = query ? String(query).toLowerCase() : "";
    const slugNeedle = eventSlug ? String(eventSlug).toLowerCase() : "";
    const collected = [];
    const seen = new Set();

    for (
      let page = 0;
      page < TAG_DISCOVER_MAX_PAGES && collected.length < safeLimit;
      page += 1
    ) {
      const params = {
        limit: TAG_DISCOVER_PAGE_SIZE,
        offset: page * TAG_DISCOVER_PAGE_SIZE,
      };
      if (active !== undefined) params.active = active;
      if (closed !== undefined) {
        params.closed = closed;
      } else if (active === true) {
        params.closed = false;
      }
      if (archived !== undefined) params.archived = archived;

      const eventsPayload = await this.getEvents(params);
      const events = Array.isArray(eventsPayload) ? eventsPayload : (eventsPayload?.data ?? []);
      if (events.length === 0) break;

      for (const event of events) {
        if (!eventMatchesRequestedTags(event, requestedTags)) continue;
        const inheritedTags = eventTagList(event);

        for (const market of asArray(event?.markets)) {
          const normalizedMarket = {
            ...market,
            tags: mergeMarketTags({ market, inheritedTags }),
          };

          if (needle) {
            const slug = String(normalizedMarket.slug ?? "").toLowerCase();
            const question = String(normalizedMarket.question ?? normalizedMarket.title ?? "").toLowerCase();
            if (!slug.includes(needle) && !question.includes(needle)) continue;
          }

          if (slugNeedle) {
            const slug = String(normalizedMarket.slug ?? "").toLowerCase();
            if (slug !== slugNeedle) continue;
          }

          if (tradableOnly && !isTradableMarket(normalizedMarket)) continue;

          const dedupeKey = marketDedupKey(normalizedMarket);
          if (dedupeKey && seen.has(dedupeKey)) continue;
          if (dedupeKey) seen.add(dedupeKey);

          collected.push(normalizedMarket);
          if (collected.length >= safeLimit) break;
        }

        if (collected.length >= safeLimit) break;
      }

    }

    return collected;
  }

  async discover({ query, tags, eventSlug, limit = 200, active = undefined, closed = undefined, archived = undefined, tradableOnly = true } = {}) {
    if (tags?.length) {
      return await this.discoverByEventTags({
        query,
        tags,
        eventSlug,
        limit,
        active,
        closed,
        archived,
        tradableOnly,
      });
    }

    const params = { limit };
    if (active !== undefined) params.active = active;
    if (closed !== undefined) {
      params.closed = closed;
    } else if (active === true) {
      // Gamma's "active=true" can still include closed historical markets; force tradable default.
      params.closed = false;
    }
    if (archived !== undefined) params.archived = archived;
    if (eventSlug) params.slug = eventSlug;

    const markets = await this.getMarkets(params);
    let primary = Array.isArray(markets) ? markets : (markets?.data ?? []);
    if (query) {
      const needle = String(query).toLowerCase();
      primary = primary.filter((m) => {
        const slug = String(m.slug ?? "").toLowerCase();
        const question = String(m.question ?? m.title ?? "").toLowerCase();
        return slug.includes(needle) || question.includes(needle);
      });
    }
    if (tradableOnly) {
      primary = primary.filter((m) => isTradableMarket(m));
    }
    if (primary.length > 0) return primary;

    if (query) {
      const search = await this.search({ q: query, limit });
      let fallback = extractSearchMarkets(search);
      if (tradableOnly) {
        fallback = fallback.filter((m) => isTradableMarket(m));
      }
      return fallback;
    }

    return primary;
  }
}
