/*
小黑盒 - 普通领券
账号环境变量:
  heybox_ck=pkey=xxx;x_xhh_tokenid=xxx;
*/
const { $, tools } = require("./src/core");
const {
  DATA_NAME,
  HeyboxAccount,
  HeyboxWebClient,
} = require("./src/heybox");

exports.name = "小黑盒.普通领券";

const PATH_DETAIL = "/mall/coupon/center/detail/";
const PATH_GET = "/mall/coupon/center/get/";

const CONFIG = Object.freeze({
  delayMs: 300,
  appVersion: "1.3.389",
  pageLimit: 20,
  maxPages: 5,
  sessionRetry: 1,
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

async function loadTargets(client) {
  const targets = [];
  const seen = new Set();
  let lastval = "";

  for (let page = 1; page <= CONFIG.maxPages; page += 1) {
    const payload = await client.getJson(PATH_DETAIL, {
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
    const result = payload?.result && typeof payload.result === "object" ? payload.result : {};
    const session = tools.toText(result.session);
    const games = Array.isArray(result.games) ? result.games : [];
    for (const item of games) {
      if (!isClaimableCoupon(item)) continue;
      const itemId = String(item.id);
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      targets.push({
        itemId,
        session,
        name: tools.toText(item.name),
        description: tools.toText(item.description),
      });
    }
    const nextLastval = tools.toText(result.lastval);
    if (!nextLastval || nextLastval === lastval || games.length === 0) break;
    lastval = nextLastval;
  }

  return targets;
}

async function claimCoupon(client, itemId, session) {
  return client.getJson(PATH_GET, {
    query: { item_id: itemId, session },
    retries: 1,
  });
}

async function refreshClaimSession(client) {
  const payload = await client.getJson(PATH_DETAIL, {
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
  const session = tools.toText(payload?.result?.session);
  if (!session) throw new Error(`detail response missing session: ${JSON.stringify(payload).slice(0, 300)}`);
  return session;
}

function isLoginRequired(message) {
  return /请登录|登录后|未登录|登录态/.test(message);
}

function isPageExpired(message) {
  return /页面已过期|刷新当前页面|session/i.test(message);
}

async function claimWithFreshSession(client, target) {
  let lastPayload = null;
  for (let attempt = 0; attempt <= CONFIG.sessionRetry; attempt += 1) {
    const session = await refreshClaimSession(client);
    const payload = await claimCoupon(client, target.itemId, session);
    const message = resultMessage(payload);
    lastPayload = payload;
    if (!isPageExpired(message) || attempt >= CONFIG.sessionRetry) {
      return { payload, message, refreshed: attempt > 0 };
    }
    await tools.sleep(200);
  }
  return { payload: lastPayload, message: resultMessage(lastPayload), refreshed: true };
}

async function runAccount(account) {
  const client = new HeyboxWebClient(account);
  account.log(`开始领券 heybox_id=${account.heyboxId}`);
  const targets = await loadTargets(client);
  if (!targets.length) {
    account.log("No claimable coupon found");
    return;
  }

  account.log(`Claim targets: ${targets.map((target) => target.itemId).join(", ")}`);
  for (const target of targets) {
    const result = await claimWithFreshSession(client, target);
    const ok = result.payload?.status === "ok" && result.payload?.result?.success === 1;
    const title = target.name ? ` ${target.name}` : "";
    account.log(`item_id=${target.itemId}${title}: ${ok ? "OK" : "FAIL"} ${result.message}`);
    if (!ok && isLoginRequired(result.message)) {
      account.log("Stop: heybox_ck login state is invalid or expired");
      break;
    }
    if (CONFIG.delayMs > 0) await tools.sleep(CONFIG.delayMs);
  }
}

async function run() {
  if (!await $.read_env(HeyboxAccount, DATA_NAME)) return;
  for (const account of $.userList) {
    try {
      await runAccount(account);
    } catch (error) {
      account.log(`领券失败: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

exports.run = run;

if (require.main === module) $.start(exports);
