import { Wallet } from "ethers";
import { ClobClient } from "@polymarket/clob-client";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137; // Polygon mainnet

const pk = process.env.PRIVATE_KEY;
if (!pk) throw new Error("Missing env var PRIVATE_KEY");

const signer = new Wallet(pk);
console.log("Signer:", await signer.getAddress());

const client = new ClobClient(HOST, CHAIN_ID, signer);

// 生成或派生 L2 creds
const creds = await client.createOrDeriveApiKey();

// clob-client 常用字段名是 key/secret/passphrase
console.log("\nL2 API creds:\n", JSON.stringify(creds, null, 2));
