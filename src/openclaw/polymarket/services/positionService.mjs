import { ValidationError } from "../errors.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function issueLabel(name) {
  switch (name) {
    case "openOrders":
      return "openOrders";
    case "clobTrades":
      return "clobTrades";
    case "notifications":
      return "notifications";
    case "positions":
      return "positions";
    case "activity":
      return "activity";
    case "value":
      return "value";
    default:
      return name;
  }
}

export class PositionService {
  constructor({ clobService, dataApiClient }) {
    this.clob = clobService;
    this.dataApi = dataApiClient;
  }

  async syncAccountState({
    address,
    market,
    assetId,
    includeOpenOrders = false,
    includeClobTrades = false,
    includeNotifications = false,
  } = {}) {
    if (!address) {
      throw new ValidationError("address is required for syncAccountState");
    }

    const taskMap = {
      openOrders: includeOpenOrders
        ? () => this.clob.getOpenOrders({ market, asset_id: assetId }, true)
        : null,
      clobTrades: includeClobTrades
        ? () => this.clob.getTrades({ maker_address: address, market, asset_id: assetId }, true)
        : null,
      notifications: includeNotifications ? () => this.clob.getNotifications() : null,
      positions: () => this.dataApi.getPositions({ user: address, market, asset: assetId }),
      activity: () => this.dataApi.getActivity({ user: address, market, asset: assetId }),
      value: () => this.dataApi.getValue({ user: address }),
    };

    const entries = Object.entries(taskMap);
    const settled = await Promise.all(
      entries.map(async ([name, fn]) => {
        if (!fn) return { name, status: "skipped", value: undefined };
        try {
          const value = await fn();
          return { name, status: "fulfilled", value };
        } catch (error) {
          return { name, status: "rejected", error };
        }
      }),
    );

    const sourceStatus = {};
    const syncIssues = [];
    const values = {
      openOrders: [],
      clobTrades: [],
      notifications: [],
      positions: [],
      activity: [],
      value: null,
    };

    for (const item of settled) {
      if (item.status === "skipped") {
        sourceStatus[item.name] = "skipped";
        continue;
      }

      if (item.status === "fulfilled") {
        sourceStatus[item.name] = "ok";
        values[item.name] = item.value;
        continue;
      }

      sourceStatus[item.name] = "error";
      syncIssues.push({
        source: issueLabel(item.name),
        message: item.error?.message ?? String(item.error),
      });
    }

    const dataApiFailed =
      sourceStatus.positions === "error" &&
      sourceStatus.activity === "error" &&
      sourceStatus.value === "error";

    if (dataApiFailed) {
      const primary = settled.find((item) => item.name === "positions" && item.status === "rejected");
      throw primary?.error ?? new Error("syncAccountState failed: data API unavailable");
    }

    return {
      openOrders: asArray(values.openOrders),
      trades: asArray(values.clobTrades),
      notifications: asArray(values.notifications),
      positions: asArray(values.positions),
      activity: asArray(values.activity),
      value: values.value,
      sourceStatus,
      syncIssues,
      degraded: syncIssues.length > 0,
      syncedAt: Date.now(),
    };
  }

  async syncTrades({ address, market, assetId, before, after } = {}) {
    const clobTrades = await this.clob.getTrades(
      {
        maker_address: address,
        market,
        asset_id: assetId,
        before,
        after,
      },
      true,
    );

    const dataApiTrades = await this.dataApi.getTrades({
      user: address,
      market,
      asset: assetId,
      before,
      after,
    });

    return {
      clobTrades,
      dataApiTrades,
      syncedAt: Date.now(),
    };
  }
}
