const crypto = require("crypto");
const { toText } = require("../core").tools;

function pickCookie(cookie, key) {
  for (const raw of String(cookie || "").split(";")) {
    const item = raw.trim();
    if (!item) continue;
    const pos = item.indexOf("=");
    if (pos === -1) continue;
    if (item.slice(0, pos).trim() === key) return item.slice(pos + 1).trim();
  }
  return "";
}

function parseCookieMap(cookie) {
  const map = new Map();
  for (const raw of String(cookie || "").split(";")) {
    const item = raw.trim();
    if (!item) continue;
    const pos = item.indexOf("=");
    if (pos === -1) continue;
    const key = item.slice(0, pos).trim();
    const value = item.slice(pos + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}

function serializeCookie(map) {
  return Array.from(map.entries())
    .filter(([key, value]) => key && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(";");
}

function decodePkeyToUserId(cookie) {
  const pkey = pickCookie(cookie, "pkey");
  if (!pkey) return "";

  let encoded;
  try {
    encoded = decodeURIComponent(pkey);
  } catch {
    return "";
  }

  const compact = encoded.replace(/_+$/, "") || encoded;
  const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");

  try {
    const plain = Buffer.from(base64, "base64").toString("utf8");
    const match = plain.match(/_(\d{5,})/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function makeImei(cookie) {
  const pkey = pickCookie(cookie, "pkey");
  if (!pkey) throw new Error("cookie缺少pkey");
  return crypto.createHash("md5").update(pkey, "utf8").digest("hex").slice(0, 16);
}

function buildAppCookie(cookie) {
  const pkey = pickCookie(cookie, "pkey");
  const tokenId = pickCookie(cookie, "x_xhh_tokenid");
  if (!pkey) throw new Error("cookie缺少pkey");
  if (!tokenId) throw new Error("cookie缺少x_xhh_tokenid");
  return `pkey=${pkey};x_xhh_tokenid=${tokenId}`;
}

function buildWebCookie(cookie, heyboxId) {
  const cookieMap = parseCookieMap(cookie);
  const pkey = toText(cookieMap.get("pkey"));
  const tokenId = toText(cookieMap.get("x_xhh_tokenid"));
  if (!pkey) throw new Error("cookie缺少pkey");
  if (!tokenId) throw new Error("cookie缺少x_xhh_tokenid");
  if (!cookieMap.has("x_pkey")) cookieMap.set("x_pkey", pkey);
  if (!cookieMap.has("x_heybox_id")) cookieMap.set("x_heybox_id", heyboxId);
  return serializeCookie(cookieMap);
}

module.exports = {
  pickCookie,
  parseCookieMap,
  serializeCookie,
  decodePkeyToUserId,
  makeImei,
  buildAppCookie,
  buildWebCookie,
};
