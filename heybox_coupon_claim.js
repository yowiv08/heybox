const crypto = require("crypto");
const got = require("got");
const { URLSearchParams } = require("url");

const API_BASE = "https://api.xiaoheihe.cn";
const WEB_VERSION = "999.0.4";
const PATH_DETAIL = "/mall/coupon/center/detail/";
const PATH_GET = "/mall/coupon/center/get/";

const CONFIG = Object.freeze({
  delayMs: 300,
  appVersion: "1.3.389",
  pageLimit: 20,
  maxPages: 5,
  sessionRetry: 1,
});

const WEB_PROFILE = Object.freeze({
  app: "heybox",
  os_type: "web",
  x_app: "heybox",
  x_client_type: "web",
  x_os_type: "Android",
  x_client_version: CONFIG.appVersion,
});

const WEB_UA =
  "Mozilla/5.0 (Linux; Android 16; 23113RKC6C Build/BP2A.250605.031.A3; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.192 Mobile Safari/537.36";

function toText(input) {
  if (input === undefined || input === null) return "";
  return String(input).trim();
}

function pickCookie(cookie, key) {
  for (const raw of cookie.split(";")) {
    const item = raw.trim();
    if (!item) continue;
    const pos = item.indexOf("=");
    if (pos === -1) continue;
    if (item.slice(0, pos).trim() === key) {
      return item.slice(pos + 1).trim();
    }
  }
  return "";
}

function parseCookieMap(cookie) {
  const map = new Map();
  for (const raw of cookie.split(";")) {
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

function buildWebCookie(cookie, heyboxId) {
  const cookieMap = parseCookieMap(cookie);
  const pkey = cookieMap.get("pkey") || "";
  const tokenId = cookieMap.get("x_xhh_tokenid") || "";
  if (!pkey) {
    throw new Error("cookie缺少pkey");
  }
  if (!tokenId) {
    throw new Error("cookie缺少x_xhh_tokenid");
  }
  if (!cookieMap.has("x_pkey")) cookieMap.set("x_pkey", pkey);
  if (!cookieMap.has("x_heybox_id")) cookieMap.set("x_heybox_id", heyboxId);
  return serializeCookie(cookieMap);
}

function parseAccountEnv() {
  const source = toText(process.env.heybox_ck || "");
  if (!source) {
    throw new Error("缺少环境变量 heybox_ck");
  }

  const rows = source
    .replace(/\r/g, "\n")
    .split(/[&\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    throw new Error("heybox_ck 为空");
  }

  return rows.map((cookie, idx) => {
    const heyboxId = decodePkeyToUserId(cookie);
    if (!heyboxId) {
      throw new Error(`账号${idx + 1}无法从pkey解析heybox_id`);
    }
    return {
      index: idx + 1,
      cookie: buildWebCookie(cookie, heyboxId),
      heyboxId,
    };
  });
}

function md5(input) {
  return crypto.createHash("md5").update(String(input)).digest("hex");
}

function mul2(value) {
  return 128 & value ? 255 & ((value << 1) ^ 27) : value << 1;
}

function mixX(value) {
  return mul2(value) ^ value;
}

function mixK(value) {
  return mixX(mul2(value));
}

function mixC(value) {
  return mixK(mixX(mul2(value)));
}

function mixS(value) {
  return mixC(value) ^ mixK(value) ^ mixX(value);
}

function mixArray(input) {
  const output = [0, 0, 0, 0];
  output[0] = mixS(input[0]) ^ mixC(input[1]) ^ mixK(input[2]) ^ mixX(input[3]);
  output[1] = mixX(input[0]) ^ mixS(input[1]) ^ mixC(input[2]) ^ mixK(input[3]);
  output[2] = mixK(input[0]) ^ mixX(input[1]) ^ mixS(input[2]) ^ mixC(input[3]);
  output[3] = mixC(input[0]) ^ mixK(input[1]) ^ mixX(input[2]) ^ mixS(input[3]);
  input[0] = output[0];
  input[1] = output[1];
  input[2] = output[2];
  input[3] = output[3];
  return input;
}

function remapByAlphabet(input, alphabet, endOffset) {
  let output = "";
  const base = alphabet.slice(0, endOffset);
  for (let index = 0; index < input.length; index += 1) {
    output += base[input.charCodeAt(index) % base.length];
  }
  return output;
}

function remapFull(input, alphabet) {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    output += alphabet[input.charCodeAt(index) % alphabet.length];
  }
  return output;
}

function interleave(parts) {
  let output = "";
  const maxLength = Math.max(...parts.map((part) => part.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const part of parts) {
      if (index < part.length) output += part[index];
    }
  }
  return output;
}

function normalizePath(path) {
  return `/${String(path).split("/").filter(Boolean).join("/")}/`;
}

function makeWebHkey(path, timeSec, nonce) {
  const alphabet = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
  const timePart = remapByAlphabet(String(timeSec), alphabet, -2);
  const pathPart = remapFull(normalizePath(path), alphabet);
  const noncePart = remapFull(nonce, alphabet);
  const mixed = interleave([timePart, pathPart, noncePart]).slice(0, 20);
  const digest = md5(mixed);
  let suffix = String(
    mixArray(digest.slice(-6).split("").map((char) => char.charCodeAt(0))).reduce(
      (sum, value) => sum + value,
      0,
    ) % 100,
  );
  if (suffix.length < 2) suffix = `0${suffix}`;
  return `${remapByAlphabet(digest.substring(0, 5), alphabet, -4)}${suffix}`;
}

function makeNonce() {
  return md5(`${Date.now()}${Math.random()}${crypto.randomBytes(8).toString("hex")}`).toUpperCase();
}

function makeWebSignature(path, timeSec = Math.floor(Date.now() / 1000), nonce = makeNonce()) {
  return {
    version: WEB_VERSION,
    hkey: makeWebHkey(path, timeSec + 1, nonce),
    _time: String(timeSec),
    nonce,
  };
}

function buildQueryString(source) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function makeHeaders(account) {
  return {
    "User-Agent": WEB_UA,
    Accept: "application/json, text/plain, */*",
    Origin: "https://web.xiaoheihe.cn",
    "X-Requested-With": "com.max.xiaoheihe",
    Referer: "https://web.xiaoheihe.cn/",
    Cookie: account.cookie,
  };
}

function isRetryable(error) {
  const code = error && error.code;
  const message = toText(error && error.message);
  return (
    error && error.name === "TimeoutError" ||
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ECONNABORTED"].includes(code) ||
    message.includes("socket hang up")
  );
}

async function requestWebJson(account, path, options = {}) {
  const query = {
    ...WEB_PROFILE,
    heybox_id: account.heyboxId,
    ...makeWebSignature(path),
    ...(options.query || {}),
  };
  const url = `${API_BASE}${path}?${buildQueryString(query)}`;
  const retries = Number.isInteger(options.retries) ? options.retries : 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await got(url, {
        method: "GET",
        headers: makeHeaders(account),
        timeout: { request: options.timeoutMs || 15000 },
        throwHttpErrors: false,
        retry: 0,
        decompress: true,
      });
      const text = response.body || "";
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`HTTP ${response.statusCode}: ${text.slice(0, 300)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON: ${text.slice(0, 300)}`);
      }
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await wait(500 * (attempt + 1));
    }
  }
  throw new Error("request failed");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function resultMessage(payload) {
  const status = toText(payload && payload.status);
  const msg = toText(payload && payload.msg);
  const rawResult = payload && payload.result;
  if (typeof rawResult === "string") return rawResult;
  const result = rawResult && typeof rawResult === "object" ? rawResult : {};
  const errorMsg = toText(result.error_msg);
  const success = result.success;
  if (status && status !== "ok") return msg || status;
  if (success === 1) return "success";
  if (success === 2) return "pending";
  return errorMsg || msg || JSON.stringify(payload).slice(0, 200);
}

function isClaimableCoupon(item) {
  return (
    item &&
    item.id !== undefined &&
    item.id !== null &&
    item.is_get !== true &&
    item.is_limit !== true &&
    String(item.state) === "0"
  );
}

async function loadTargets(account) {
  const targets = [];
  const seen = new Set();
  let lastval = "";

  for (let page = 1; page <= CONFIG.maxPages; page += 1) {
    const payload = await requestWebJson(account, PATH_DETAIL, {
      query: {
        primary_id: "",
        sub_id: "",
        cate: "game",
        app_version: CONFIG.appVersion,
        limit: String(CONFIG.pageLimit),
        lastval,
        need_is_get: "0",
      },
      retries: 1,
    });

    const result = payload && payload.result && typeof payload.result === "object" ? payload.result : {};
    const session = toText(result.session);
    const games = Array.isArray(result.games) ? result.games : [];

    for (const item of games) {
      if (!isClaimableCoupon(item)) continue;
      const itemId = String(item.id);
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      targets.push({
        itemId,
        session,
        name: toText(item.name),
        description: toText(item.description),
      });
    }

    const nextLastval = toText(result.lastval);
    if (!nextLastval || nextLastval === lastval || games.length === 0) break;
    lastval = nextLastval;
  }

  return targets;
}

async function claimCoupon(account, itemId, session) {
  return requestWebJson(account, PATH_GET, {
    query: { item_id: itemId, session },
    retries: 1,
  });
}

async function refreshClaimSession(account) {
  const payload = await requestWebJson(account, PATH_DETAIL, {
    query: {
      primary_id: "",
      sub_id: "",
      cate: "game",
      app_version: CONFIG.appVersion,
      limit: "20",
      lastval: "0",
      need_is_get: "0",
    },
    retries: 1,
  });
  const session = toText(payload && payload.result && payload.result.session);
  if (!session) {
    throw new Error(`detail response missing session: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return session;
}

function isLoginRequired(message) {
  return /请登录|登录后|未登录|登录态/.test(message);
}

function isPageExpired(message) {
  return /页面已过期|刷新当前页面|session/i.test(message);
}

async function claimWithFreshSession(account, target) {
  let session = "";
  let lastPayload = null;

  for (let attempt = 0; attempt <= CONFIG.sessionRetry; attempt += 1) {
    session = await refreshClaimSession(account);
    const payload = await claimCoupon(account, target.itemId, session);
    const message = resultMessage(payload);
    lastPayload = payload;

    if (!isPageExpired(message) || attempt >= CONFIG.sessionRetry) {
      return { payload, message, refreshed: attempt > 0 };
    }

    console.log(`item_id=${target.itemId}: session expired, refresh and retry`);
    await wait(200);
  }

  return { payload: lastPayload, message: resultMessage(lastPayload), refreshed: true };
}

async function run() {
  const accounts = parseAccountEnv();

  for (const account of accounts) {
    console.log(`\nAccount ${account.index}: heybox_id=${account.heyboxId}`);
    const targets = await loadTargets(account);

    if (targets.length === 0) {
      console.log("No claimable coupon found");
      continue;
    }

    console.log(`Claim targets: ${targets.map((target) => target.itemId).join(", ")}`);

    for (const target of targets) {
      const result = await claimWithFreshSession(account, target);
      const payload = result.payload;
      const ok = payload && payload.status === "ok" && payload.result && payload.result.success === 1;
      const title = target.name ? ` ${target.name}` : "";
      const message = result.message;
      console.log(`item_id=${target.itemId}${title}: ${ok ? "OK" : "FAIL"} ${message}`);
      if (!ok && isLoginRequired(message)) {
        console.log("Stop: heybox_ck login state is invalid or expired");
        break;
      }
      if (CONFIG.delayMs > 0) await wait(CONFIG.delayMs);
    }
  }
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exitCode = 1;
});
