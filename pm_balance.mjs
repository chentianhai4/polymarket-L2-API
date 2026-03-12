import { Wallet } from "ethers";
import { ClobClient } from "@polymarket/clob-client";
import { AssetType } from "@polymarket/clob-client";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

const pk = process.env.PRIVATE_KEY;
const apiKey = process.env.API_KEY;
const secret = process.env.SECRET;
const passphrase = process.env.PASSPHRASE;

// 资金在 Polymarket 的 proxy walle
const FUNDER = process.env.FUNDER_ADDRESS;
// 大多数用户 proxy 是 GNOSIS_SAFE = 2
const SIGNATURE_TYPE = Number(process.env.SIGNATURE_TYPE ?? "2");

if (!pk || !apiKey || !secret || !passphrase || !FUNDER) {
throw new Error("Missing env vars: PRIVATE_KEY/API_KEY/SECRET/PASSPHRASE/FUNDER_ADDRESS");
}

const signer = new Wallet(pk);
const creds = { key: apiKey, secret, passphrase };

const client = new ClobClient(HOST, CHAIN_ID, signer, creds, SIGNATURE_TYPE, FUNDER);

// 先更新缓存（有时需要）
await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });

// 再读取
const res = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
console.log(JSON.stringify(res, null, 2));
