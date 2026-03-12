import fs from "node:fs";
import path from "node:path";

export function loadDotEnv(dotenvPath = ".env") {
  const abs = path.isAbsolute(dotenvPath) ? dotenvPath : path.resolve(process.cwd(), dotenvPath);
  if (!fs.existsSync(abs)) return;

  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine) continue;
    const lineWithBomStripped = rawLine.replace(/^\uFEFF/, "");
    let line = lineWithBomStripped.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }

    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}
