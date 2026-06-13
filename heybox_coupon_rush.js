const crypto = require("crypto");
const got = require("got");
const { URLSearchParams } = require("url");

const API_BASE = "https://api.xiaoheihe.cn";
const WEB_VERSION = "999.0.4";
const PATH_DETAIL = "/mall/coupon/center/detail/";
const PATH_SPECIAL = "/mall/coupon/center/detail_special/";
const PATH_RUSH = "/mall/coupon/center/get_time_limit/";

const CONFIG = Object.freeze({
  // Empty means discover current limited coupons from detail_special.
  // You can hardcode values here if needed: ["65a10f0780892136f23065ac:1250"].
  targets: [],
  // Empty means auto-plan from coupon tag, such as "明日10:00开抢".
  // You can hardcode one anchor for all targets if needed: "10:00:00".
  rushAt: "",
  appVersion: "1.3.389",
  prewarmMs: 1500,
  windowBeforeMs: 300,
  windowAfterMs: 5000,
  intervalMs: 250,
  maxRounds: 20,
  parallel: 6,
  skipTerminalTargets: true,
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

function makeHeaders(account, hasBody = false) {
  const headers = {
    "User-Agent": WEB_UA,
    Accept: "application/json, text/plain, */*",
    Origin: "https://web.xiaoheihe.cn",
    "X-Requested-With": "com.max.xiaoheihe",
    Referer: "https://web.xiaoheihe.cn/",
    Cookie: account.cookie,
  };
  if (hasBody) {
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  }
  return headers;
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
  const method = options.method || "GET";
  const body = options.body || null;
  const query = {
    ...WEB_PROFILE,
    heybox_id: account.heyboxId,
    ...makeWebSignature(path),
    ...(options.query || {}),
  };
  const url = `${API_BASE}${path}?${buildQueryString(query)}`;
  const bodyText = body ? buildQueryString(body) : undefined;
  const retries = Number.isInteger(options.retries) ? options.retries : 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await got(url, {
        method,
        headers: makeHeaders(account, Boolean(bodyText)),
        body: bodyText,
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

function formatDateTime(inputMs) {
  const date = new Date(inputMs);
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function flattenSpecialTargets(payload) {
  const special = payload && payload.result && payload.result.special || {};
  const groups = ["processing", "closed", "not_start", "coming", "items"];
  const targets = [];
  const seen = new Set();

  for (const group of groups) {
    const list = Array.isArray(special[group]) ? special[group] : [];
    for (const item of list) {
      if (!item) continue;
      const actId = item.act_id || item.actId;
      const poolId = item.id !== undefined && item.id !== null ? item.id : item.pool_id || item.poolId;
      if (!actId || poolId === undefined || poolId === null) continue;
      const key = `${actId}:${poolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        actId: String(actId),
        poolId: String(poolId),
        name: toText(item.name),
        tag: toText(item.tag),
        value: item.value,
        count: item.count,
        leftPercent: item.left_percent,
        state: item.state,
        description: toText(item.description || item.sub_title),
        source: group,
      });
    }
  }

  return targets;
}

function normalizeRushTarget(item, source) {
  if (!item) return null;
  const actId = item.act_id || item.actId;
  const poolId = item.id !== undefined && item.id !== null ? item.id : item.pool_id || item.poolId;
  if (!actId || poolId === undefined || poolId === null) return null;
  return {
    actId: String(actId),
    poolId: String(poolId),
    name: toText(item.name),
    tag: toText(item.tag),
    value: item.value,
    count: item.count,
    leftPercent: item.left_percent,
    state: item.state,
    description: toText(item.description || item.sub_title),
    source,
  };
}

async function discoverFlashSaleTargets(account) {
  const payload = await requestWebJson(account, PATH_DETAIL, {
    query: {
      primary_id: "",
      sub_id: "",
      cate: "flash_sale",
      app_version: CONFIG.appVersion,
      limit: "20",
      lastval: "",
      need_is_get: "0",
    },
    retries: 1,
  });
  const result = payload && payload.result && typeof payload.result === "object" ? payload.result : {};
  const lists = [
    ...(Array.isArray(result.items) ? result.items : []),
    ...(Array.isArray(result.games) ? result.games : []),
  ];
  const targets = [];
  const seen = new Set();
  for (const item of lists) {
    if (!item || item.is_limit !== true) continue;
    const target = normalizeRushTarget(item, "flash_sale");
    if (!target) continue;
    const key = `${target.actId}:${target.poolId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return { targets, payload };
}

function normalizeConfiguredTarget(raw) {
  if (raw && typeof raw === "object" && raw.actId && raw.poolId) {
    return { actId: String(raw.actId), poolId: String(raw.poolId) };
  }

  const parts = String(raw).split(/[:/|]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Invalid configured target '${raw}', expected act_id:pool_id`);
  }
  return { actId: parts[0], poolId: parts[1] };
}

async function loadTargets() {
  if (CONFIG.targets.length > 0) {
    return CONFIG.targets.map(normalizeConfiguredTarget);
  }
  return [];
}

function parseStartTime(value, nowMs = Date.now()) {
  const raw = toText(value);
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const hms = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (hms) {
    const now = new Date(nowMs);
    const target = new Date(now);
    target.setHours(
      Number(hms[1]),
      Number(hms[2]),
      Number(hms[3] || 0),
      Number((hms[4] || "0").padEnd(3, "0")),
    );
    if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
    return target.getTime();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseTagStartTime(tag, nowMs = Date.now()) {
  const text = toText(tag);
  if (!text) return null;

  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return null;

  const now = new Date(nowMs);
  const target = new Date(now);
  target.setHours(Number(time[1]), Number(time[2]), Number(time[3] || 0), 0);

  if (/明日|明天/.test(text)) {
    target.setDate(target.getDate() + 1);
    return target.getTime();
  }
  if (/后天/.test(text)) {
    target.setDate(target.getDate() + 2);
    return target.getTime();
  }

  const md = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    target.setMonth(Number(md[1]) - 1, Number(md[2]));
    if (target.getTime() <= nowMs) target.setFullYear(target.getFullYear() + 1);
    return target.getTime();
  }

  if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
  return target.getTime();
}

async function refreshSession(account) {
  const payload = await requestWebJson(account, PATH_DETAIL, {
    query: {
      primary_id: "",
      sub_id: "",
      cate: "flash_sale",
      app_version: CONFIG.appVersion,
      limit: "20",
      lastval: "",
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

async function discoverSpecialTargets(account) {
  const payload = await requestWebJson(account, PATH_SPECIAL, { retries: 1 });
  const targets = flattenSpecialTargets(payload);
  const special = payload && payload.result && payload.result.special;
  if (special && typeof special === "object") {
    const groups = Object.keys(special).map((key) => {
      const value = special[key];
      return `${key}=${Array.isArray(value) ? value.length : typeof value}`;
    });
    console.log(`Special coupon groups: ${groups.join(", ") || "empty"}`);
  } else {
    const status = toText(payload && payload.status);
    const msg = toText(payload && payload.msg);
    const result = payload && payload.result && typeof payload.result === "object" ? payload.result : {};
    console.log(`Special coupon groups: none (status=${status || "unknown"}, msg=${msg || "-"}, resultKeys=${Object.keys(result).join(",") || "-"})`);
  }
  if (targets.length > 0) return targets;

  const fallback = await discoverFlashSaleTargets(account).catch((error) => {
    console.log(`Discover flash_sale coupons failed: ${error.message}`);
    return { targets: [] };
  });
  if (fallback.targets.length > 0) {
    console.log(`Flash sale fallback targets: ${fallback.targets.length}`);
  }
  return fallback.targets;
}

async function rushCoupon(account, target, session) {
  return requestWebJson(account, PATH_RUSH, {
    method: "POST",
    body: {
      act_id: target.actId,
      pool_id: target.poolId,
      session,
    },
    retries: 0,
    timeoutMs: 8000,
  });
}

function isSuccess(payload) {
  return payload && payload.status === "ok" && payload.result && payload.result.success === 1;
}

function isTerminalMessage(message) {
  return /已抢光|活动已结束|已领取|已抢过|资格|库存不足/.test(message);
}

function isTerminalTarget(target) {
  return isTerminalMessage(toText(target.tag));
}

function mergeMetadata(targets, discovered) {
  const metaByKey = new Map(discovered.map((item) => [`${item.actId}:${item.poolId}`, item]));
  return targets.map((target) => ({ ...metaByKey.get(`${target.actId}:${target.poolId}`), ...target }));
}

function buildPlans(targets) {
  const nowMs = Date.now();
  const fixedAt = parseStartTime(CONFIG.rushAt, nowMs);
  const plans = new Map();

  for (const target of targets) {
    if (CONFIG.skipTerminalTargets && isTerminalTarget(target)) {
      console.log(`Skip pool=${target.poolId}: ${target.tag || "terminal"}`);
      continue;
    }

    const atMs = fixedAt || parseTagStartTime(target.tag, nowMs) || nowMs;
    const key = String(atMs);
    if (!plans.has(key)) plans.set(key, []);
    plans.get(key).push(target);
  }

  return Array.from(plans.entries())
    .map(([atMs, groupTargets]) => ({ atMs: Number(atMs), targets: groupTargets }))
    .sort((a, b) => a.atMs - b.atMs);
}

function buildPlanTiming(plan) {
  const anchorMs = plan.atMs;
  const prewarmAtMs = Math.max(Date.now(), anchorMs - CONFIG.prewarmMs);
  const startMs = Math.max(Date.now(), anchorMs - CONFIG.windowBeforeMs);
  const endMs = Math.max(startMs, anchorMs + CONFIG.windowAfterMs);
  const derivedRounds = Math.floor((CONFIG.windowBeforeMs + CONFIG.windowAfterMs) / CONFIG.intervalMs) + 1;
  const maxRounds = Math.max(1, Math.min(CONFIG.maxRounds, derivedRounds));
  const parallel = Math.max(1, Math.min(Math.max(1, plan.targets.length), CONFIG.parallel));
  return { prewarmAtMs, startMs, endMs, maxRounds, parallel };
}

function formatTarget(target) {
  const value = target.value !== undefined && target.value !== null && target.value !== "" ? `￥${target.value}` : "券";
  const desc = target.description || target.name || "";
  const stock = target.count !== undefined && target.count !== null ? ` 库存=${target.count}` : "";
  const left = target.leftPercent ? ` 剩余=${target.leftPercent}%` : "";
  return `${value} ${desc} pool=${target.poolId} act=${target.actId}${stock}${left}`;
}

function printPlan(plan) {
  const timing = buildPlanTiming(plan);

  console.log("\n抢券计划:");
  console.log(`  时间: ${formatDateTime(plan.atMs)} (${plan.targets.length}张券)`);
  for (const target of plan.targets) {
    console.log(`  - ${formatTarget(target)}`);
  }
  console.log(`  刷新session: ${formatDateTime(timing.prewarmAtMs)}`);
  console.log(`  请求窗口: ${formatDateTime(timing.startMs)} -> ${formatDateTime(timing.endMs)}`);
  console.log(`  间隔: ${CONFIG.intervalMs}ms, 轮数: ${timing.maxRounds}, 并发: ${timing.parallel}`);

  return timing;
}

async function waitUntil(timeMs) {
  const delay = timeMs - Date.now();
  if (delay > 0) await wait(delay);
}

async function runAttemptWindow(account, targets, config) {
  const done = new Set();
  let session = config.session;
  let rounds = 0;

  while (Date.now() <= config.endMs && rounds < config.maxRounds && done.size < targets.length) {
    rounds += 1;
    await waitUntil(config.startMs + (rounds - 1) * CONFIG.intervalMs);

    const pending = targets.filter((target) => !done.has(`${target.actId}:${target.poolId}`));
    for (let index = 0; index < pending.length; index += config.parallel) {
      const batch = pending.slice(index, index + config.parallel);
      const results = await Promise.all(batch.map(async (target) => {
        try {
          const payload = await rushCoupon(account, target, session);
          return { target, payload };
        } catch (error) {
          return { target, error };
        }
      }));

      for (const result of results) {
        const key = `${result.target.actId}:${result.target.poolId}`;
        if (result.error) {
          console.log(`account=${account.index} round=${rounds} pool=${result.target.poolId}: ERROR ${result.error.message}`);
          continue;
        }

        const message = resultMessage(result.payload);
        console.log(`account=${account.index} round=${rounds} pool=${result.target.poolId}: ${message}`);

        if (isSuccess(result.payload)) {
          done.add(key);
          continue;
        }
        if (message.includes("页面已过期")) {
          session = await refreshSession(account);
          console.log(`account=${account.index} session refreshed: ${session}`);
          continue;
        }
        if (isTerminalMessage(message)) {
          done.add(key);
        }
      }
    }
  }

  return { doneCount: done.size, rounds };
}

async function executePlan(accounts, plan, shouldPrint = true) {
  const timing = shouldPrint ? printPlan(plan) : buildPlanTiming(plan);
  await waitUntil(timing.prewarmAtMs);

  const sessions = [];
  for (const account of accounts) {
    console.log(`\nAccount ${account.index}: heybox_id=${account.heyboxId}`);
    const session = await refreshSession(account);
    sessions.push({ account, session });
    console.log(`Account ${account.index} session: ${session}`);
  }

  await waitUntil(timing.startMs);

  const results = await Promise.all(sessions.map(async ({ account, session }) => {
    const result = await runAttemptWindow(account, plan.targets, {
      session,
      startMs: timing.startMs,
      endMs: timing.endMs,
      maxRounds: timing.maxRounds,
      parallel: timing.parallel,
    });
    return { account, result };
  }));

  for (const { account, result } of results) {
    console.log(`Account ${account.index} done: rounds=${result.rounds}, closed=${result.doneCount}/${plan.targets.length}`);
  }
}

async function run() {
  const accounts = parseAccountEnv();
  let targets = await loadTargets();

  const discovered = await discoverSpecialTargets(accounts[0]).catch((error) => {
    console.log(`Discover special coupons failed: ${error.message}`);
    return [];
  });

  if (targets.length === 0) {
    targets = discovered;
  } else if (discovered.length > 0) {
    targets = mergeMetadata(targets, discovered);
  }

  if (targets.length === 0) {
    console.log("No rush targets found from current coupon list");
    return;
  }

  const plans = buildPlans(targets);
  if (plans.length === 0) {
    throw new Error("No usable rush targets after filtering ended or sold-out coupons");
  }

  console.log(`Loaded ${targets.length} rush target(s), ${plans.length} plan(s).`);
  for (const plan of plans) {
    printPlan(plan);
  }
  for (const plan of plans) {
    await executePlan(accounts, plan, false);
  }
}

run().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exitCode = 1;
});
