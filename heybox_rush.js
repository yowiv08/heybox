/*
小黑盒 - 定时抢券
账号环境变量:
  heybox_ck=pkey=xxx;x_xhh_tokenid=xxx;
*/
const { $, tools } = require("./src/core");
const {
  DATA_NAME,
  HeyboxAccount,
  HeyboxWebClient,
} = require("./src/heybox");

exports.name = "小黑盒.定时抢券";

const PATH_DETAIL = "/mall/coupon/center/detail/";
const PATH_SPECIAL = "/mall/coupon/center/detail_special/";
const PATH_RUSH = "/mall/coupon/center/get_time_limit/";

const CONFIG = Object.freeze({
  targets: [],
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

function resultMessage(payload) {
  const status = tools.toText(payload?.status);
  const msg = tools.toText(payload?.msg);
  const rawResult = payload?.result;
  if (typeof rawResult === "string") return rawResult;
  const result = rawResult && typeof rawResult === "object" ? rawResult : {};
  if (status && status !== "ok") return msg || status;
  if (result.success === 1) return "success";
  if (result.success === 2) return "pending";
  return tools.toText(result.error_msg) || msg || JSON.stringify(payload).slice(0, 200);
}

function normalizeRushTarget(item, source) {
  if (!item) return null;
  const actId = item.act_id || item.actId;
  const poolId = item.id !== undefined && item.id !== null ? item.id : item.pool_id || item.poolId;
  if (!actId || poolId === undefined || poolId === null) return null;
  return {
    actId: String(actId),
    poolId: String(poolId),
    name: tools.toText(item.name),
    tag: tools.toText(item.tag),
    value: item.value,
    count: item.count,
    leftPercent: item.left_percent,
    state: item.state,
    description: tools.toText(item.description || item.sub_title),
    source,
  };
}

function flattenSpecialTargets(payload) {
  const special = payload?.result?.special || {};
  const groups = ["processing", "closed", "not_start", "coming", "items"];
  const targets = [];
  const seen = new Set();
  for (const group of groups) {
    const list = Array.isArray(special[group]) ? special[group] : [];
    for (const item of list) {
      const target = normalizeRushTarget(item, group);
      if (!target) continue;
      const key = `${target.actId}:${target.poolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
  }
  return targets;
}

async function discoverFlashSaleTargets(client) {
  const payload = await client.getJson(PATH_DETAIL, {
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
  const result = payload?.result && typeof payload.result === "object" ? payload.result : {};
  const lists = [
    ...(Array.isArray(result.items) ? result.items : []),
    ...(Array.isArray(result.games) ? result.games : []),
  ];
  const targets = [];
  const seen = new Set();
  for (const item of lists) {
    if (item?.is_limit !== true) continue;
    const target = normalizeRushTarget(item, "flash_sale");
    if (!target) continue;
    const key = `${target.actId}:${target.poolId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return { targets, payload };
}

async function discoverSpecialTargets(client) {
  const payload = await client.getJson(PATH_SPECIAL, { retries: 1 });
  const targets = flattenSpecialTargets(payload);
  const special = payload?.result?.special;
  if (special && typeof special === "object") {
    const groups = Object.keys(special).map((key) => {
      const value = special[key];
      return `${key}=${Array.isArray(value) ? value.length : typeof value}`;
    });
    $.log(`Special coupon groups: ${groups.join(", ") || "empty"}`);
  }
  if (targets.length) return targets;
  const fallback = await discoverFlashSaleTargets(client).catch((error) => {
    $.log(`Discover flash_sale coupons failed: ${error.message}`);
    return { targets: [] };
  });
  if (fallback.targets.length) $.log(`Flash sale fallback targets: ${fallback.targets.length}`);
  return fallback.targets;
}

function normalizeConfiguredTarget(raw) {
  if (raw && typeof raw === "object" && raw.actId && raw.poolId) {
    return { actId: String(raw.actId), poolId: String(raw.poolId) };
  }
  const parts = String(raw).split(/[:/|]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length !== 2) throw new Error(`Invalid configured target '${raw}', expected act_id:pool_id`);
  return { actId: parts[0], poolId: parts[1] };
}

function parseStartTime(value, nowMs = Date.now()) {
  const raw = tools.toText(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const hms = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (hms) {
    const now = new Date(nowMs);
    const target = new Date(now);
    target.setHours(Number(hms[1]), Number(hms[2]), Number(hms[3] || 0), Number((hms[4] || "0").padEnd(3, "0")));
    if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
    return target.getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseTagStartTime(tag, nowMs = Date.now()) {
  const text = tools.toText(tag);
  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return null;
  const now = new Date(nowMs);
  const target = new Date(now);
  target.setHours(Number(time[1]), Number(time[2]), Number(time[3] || 0), 0);
  if (/明日|明天/.test(text)) target.setDate(target.getDate() + 1);
  else if (/后天/.test(text)) target.setDate(target.getDate() + 2);
  else if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function isTerminalMessage(message) {
  return /已抢光|活动已结束|已领取|已抢过|资格|库存不足/.test(message);
}

function isTerminalTarget(target) {
  return isTerminalMessage(tools.toText(target.tag));
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
      $.log(`Skip pool=${target.poolId}: ${target.tag || "terminal"}`);
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

function formatDateTime(inputMs) {
  return tools.time("yyyy-MM-dd hh:mm:ss.S", inputMs);
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
  $.log("\n抢券计划:");
  $.log(`  时间: ${formatDateTime(plan.atMs)} (${plan.targets.length}张券)`);
  for (const target of plan.targets) $.log(`  - ${formatTarget(target)}`);
  $.log(`  刷新session: ${formatDateTime(timing.prewarmAtMs)}`);
  $.log(`  请求窗口: ${formatDateTime(timing.startMs)} -> ${formatDateTime(timing.endMs)}`);
  $.log(`  间隔: ${CONFIG.intervalMs}ms, 轮数: ${timing.maxRounds}, 并发: ${timing.parallel}`);
  return timing;
}

async function waitUntil(timeMs) {
  const delay = timeMs - Date.now();
  if (delay > 0) await tools.sleep(delay);
}

async function refreshSession(client) {
  const payload = await client.getJson(PATH_DETAIL, {
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
  const session = tools.toText(payload?.result?.session);
  if (!session) throw new Error(`detail response missing session: ${JSON.stringify(payload).slice(0, 300)}`);
  return session;
}

async function rushCoupon(client, target, session) {
  return client.postJson(PATH_RUSH, {
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
  return payload?.status === "ok" && payload?.result?.success === 1;
}

async function runAttemptWindow(account, client, targets, config) {
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
          return { target, payload: await rushCoupon(client, target, session) };
        } catch (error) {
          return { target, error };
        }
      }));
      for (const result of results) {
        const key = `${result.target.actId}:${result.target.poolId}`;
        if (result.error) {
          account.log(`round=${rounds} pool=${result.target.poolId}: ERROR ${result.error.message}`);
          continue;
        }
        const message = resultMessage(result.payload);
        account.log(`round=${rounds} pool=${result.target.poolId}: ${message}`);
        if (isSuccess(result.payload) || isTerminalMessage(message)) done.add(key);
        if (message.includes("页面已过期")) {
          session = await refreshSession(client);
          account.log(`session refreshed: ${session}`);
        }
      }
    }
  }
  return { doneCount: done.size, rounds };
}

async function executePlan(accounts, clients, plan, shouldPrint = true) {
  const timing = shouldPrint ? printPlan(plan) : buildPlanTiming(plan);
  await waitUntil(timing.prewarmAtMs);
  const sessions = [];
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    const client = clients[index];
    account.log(`预热 session heybox_id=${account.heyboxId}`);
    const session = await refreshSession(client);
    sessions.push({ account, client, session });
    account.log(`session: ${session}`);
  }
  await waitUntil(timing.startMs);
  const results = await Promise.all(sessions.map(async ({ account, client, session }) => ({
    account,
    result: await runAttemptWindow(account, client, plan.targets, {
      session,
      startMs: timing.startMs,
      endMs: timing.endMs,
      maxRounds: timing.maxRounds,
      parallel: timing.parallel,
    }),
  })));
  for (const { account, result } of results) {
    account.log(`done: rounds=${result.rounds}, closed=${result.doneCount}/${plan.targets.length}`);
  }
}

async function run() {
  if (!await $.read_env(HeyboxAccount, DATA_NAME)) return;
  const accounts = $.userList;
  const clients = accounts.map((account) => new HeyboxWebClient(account));
  let targets = CONFIG.targets.map(normalizeConfiguredTarget);
  const discovered = await discoverSpecialTargets(clients[0]).catch((error) => {
    $.log(`Discover special coupons failed: ${error.message}`);
    return [];
  });
  if (!targets.length) targets = discovered;
  else if (discovered.length) targets = mergeMetadata(targets, discovered);
  if (!targets.length) {
    $.log("No rush targets found from current coupon list");
    return;
  }
  const plans = buildPlans(targets);
  if (!plans.length) throw new Error("No usable rush targets after filtering ended or sold-out coupons");
  $.log(`Loaded ${targets.length} rush target(s), ${plans.length} plan(s).`);
  for (const plan of plans) printPlan(plan);
  for (const plan of plans) await executePlan(accounts, clients, plan, false);
}

exports.run = run;

if (require.main === module) $.start(exports);
