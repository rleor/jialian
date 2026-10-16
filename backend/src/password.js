import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(rawScrypt);
let active = 0;
const waiting = [];
async function derive(password, salt) {
  if (active >= 2) {
    if (waiting.length >= 24)
      throw Object.assign(new Error("请求过多，请稍后重试"), {
        statusCode: 429,
      });
    await new Promise((resolve) => waiting.push(resolve));
  } else active++;
  try {
    return await scrypt(password, salt, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt:32768:8:1:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, hex] = String(encoded).split(":");
  if (
    algorithm !== "scrypt" ||
    n !== "32768" ||
    r !== "8" ||
    p !== "1" ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hex)
  )
    return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(hex, "hex"));
}
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
export function equalText(a, b) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
