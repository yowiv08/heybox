const crypto = require("crypto");
const { URLSearchParams } = require("url");
const got = require("got");


const API_BASE = "https://api.xiaoheihe.cn";
const DATA_BASE = "https://data.xiaoheihe.cn";
const HKEY_API = "https://hkey.qcciii.com/hkey";

const PATH_DATA_REPORT = "/account/data_report/";
const PATH_LIST = "/task/list_v2/";
const PATH_SIGN = "/task/sign_v3/sign";
const PATH_STATE = "/task/sign_v3/get_sign_state";
const PATH_FEEDS = "/bbs/app/feeds";
const PATH_GAME_RECOMMEND = "/game/all_recommend/v2";
const PATH_GAME_COMMENTS = "/bbs/app/link/game/comments";
const PATH_VIEW_TIME = "/bbs/app/link/view/time";
const PATH_SHARE_TAP = "/share/behavior/tap";
const PATH_SHARE_SUCCESS = "/share/behavior/success";
 
const UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36 ApiMaxJia/1.0";
const REFERER = "http://api.maxjia.com/";
const TIMEOUT_MS = 15000;

const CLIENT_PROFILE = {
  os_type: "Android",
  x_os_type: "Android",
  x_client_type: "mobile",
  os_version: "12",
  dw: "360",
  channel: "heybox",
  x_app: "heybox",
  time_zone: "Asia/Shanghai",
  device_info: "HBP-AL00",
};
const WAITING_STATE = "waiting";
const FINISH_STATE = "finish";
const OK_STATE = "ok";
const SHARE_EVENT_PLATFORM = "WechatSession";
const POST_SHARE_VIEW_SECONDS = 5;
const POST_SHARE_VIEW_MILLISECONDS = 5000;
const SHARE_TASK_SETTLE_MS = 2200;
const FEEDS_QUERY_BASE = Object.freeze({
  pull: "1",
  last_pull: "1",
  is_first: "0",
  list_ver: "2",
  has_cache: "1",
  netmode: "wifi",
});
const GAME_RECOMMEND_QUERY_BASE = Object.freeze({
  offset: "0",
  limit: "1",
});
const GAME_COMMENTS_QUERY_BASE = Object.freeze({
  api_version: "4",
  offset: "0",
  limit: "30",
});

function toText(input) {
  if (input === undefined || input === null) {
    return "";
  }
  return String(input).trim();
}

function pickCookie(cookie, key) {
  const parts = cookie.split(";");
  for (const raw of parts) {
    const item = raw.trim();
    if (!item) {
      continue;
    }
    const pos = item.indexOf("=");
    if (pos === -1) {
      continue;
    }
    const name = item.slice(0, pos).trim();
    const value = item.slice(pos + 1).trim();
    if (name === key) {
      return value;
    }
  }
  return "";
}

function decodePkeyToUserId(cookie) {
  const pkey = pickCookie(cookie, "pkey");
  if (!pkey) {
    return "";
  }

  let encoded;
  try {
    encoded = decodeURIComponent(pkey);
  } catch {
    return "";
  }

  const compact = encoded.replace(/_+$/, "") || encoded;
  const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");

  let plain = "";
  try {
    plain = Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return "";
  }

  const m = plain.match(/_(\d{5,})/);
  return m ? m[1] : "";
}

function makeImei(cookie) {
  const pkey = pickCookie(cookie, "pkey");
  if (!pkey) {
    throw new Error("cookie缺少pkey");
  }
  return crypto.createHash("md5").update(pkey, "utf8").digest("hex").slice(0, 16);
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
    const pkey = pickCookie(cookie, "pkey");
    const tokenId = pickCookie(cookie, "x_xhh_tokenid");
    const cleanCookie = `pkey=${pkey};x_xhh_tokenid=${tokenId}`;
    return {
      index: idx + 1,
      cookie: cleanCookie,
      heyboxId,
      imei: makeImei(cookie),
      deviceInfo: CLIENT_PROFILE.device_info,
    };
  });
}

function nonce(len = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQueryString(source) {
  const params = new URLSearchParams();
  const input = source && typeof source === "object" ? source : {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    const view = String(value);
    if (view === "") {
      continue;
    }
    params.set(key, view);
  }
  return params.toString();
}

async function requestJson(options) {
  const resp = await got(options.url, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body ?? undefined,
    timeout: { request: TIMEOUT_MS },
    decompress: true,
    throwHttpErrors: false,
    retry: 0,
  });
  const text = resp.body;
  if (resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error(`HTTP错误 ${resp.statusCode} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON解析失败 ${text.slice(0, 300)}`);
  }
}

async function requestHkey(path, ts, account) {
  const query = buildQueryString({
    mode: "request",
    path,
    time: String(ts),
    imei: account.imei,
    heybox_id: account.heyboxId,
  });

  const data = await requestJson({
    url: `${HKEY_API}?${query}`,
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });

  const status = toText(data.status);
  if (status && status !== OK_STATE) {
    throw new Error(`hkey接口失败 status=${status} msg=${toText(data.msg) || "无"}`);
  }

  const result = data.result && typeof data.result === "object" ? data.result : data;
  const hkey = toText(result.hkey);
  const version = toText(result.version);
  const build = toText(result.build);

  if (!hkey) {
    throw new Error("hkey接口未返回hkey");
  }
  if (!version) {
    throw new Error("hkey接口未返回version");
  }
  if (!/^\d+$/.test(build)) {
    throw new Error("hkey接口未返回有效build");
  }

  return { hkey, version, build };
}

function buildSignedQueryObject(account, runtime, hkey, ts, extraQuery = {}) {
  return {
    heybox_id: account.heyboxId,
    imei: account.imei,
    device_info: account.deviceInfo,
    nonce: nonce(),
    hkey,
    os_type: CLIENT_PROFILE.os_type,
    x_os_type: CLIENT_PROFILE.x_os_type,
    x_client_type: CLIENT_PROFILE.x_client_type,
    os_version: CLIENT_PROFILE.os_version,
    version: runtime.version,
    build: runtime.build,
    _time: String(ts),
    dw: CLIENT_PROFILE.dw,
    channel: CLIENT_PROFILE.channel,
    x_app: CLIENT_PROFILE.x_app,
    time_zone: CLIENT_PROFILE.time_zone,
    ...extraQuery,
  };
}

async function callSignedGet(baseUrl, path, account, runtime, extraQuery = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const hk = await requestHkey(path, ts, account);
  runtime.version = hk.version;
  runtime.build = hk.build;
  const query = buildQueryString(buildSignedQueryObject(account, runtime, hk.hkey, ts, extraQuery));
  return requestJson({
    url: `${baseUrl}${path}?${query}`,
    method: "GET",
    headers: { "User-Agent": UA, Referer: REFERER, Cookie: account.cookie, Accept: "application/json" },
  });
}

async function callSignedApi(path, account, runtime, extraQuery = {}) {
  return callSignedGet(API_BASE, path, account, runtime, extraQuery);
}

async function postEncryptedForm(baseUrl, path, account, runtime, textPayload, extraQuery = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await got(HKEY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "report", path, text: textPayload, time: ts,
      imei: account.imei, heybox_id: account.heyboxId,
    }),
  });
  const rp = JSON.parse(r.body).result;
  if (rp.version) runtime.version = rp.version;
  if (rp.build) runtime.build = rp.build;
  const qs = buildQueryString(buildSignedQueryObject(account, runtime, rp.hkey, rp.time, {
    time_: rp.time, ...extraQuery,
  }));
  const body = buildQueryString({ data: rp.data, key: rp.key, sid: rp.sid });
  const res = await got(`${baseUrl}${path}?${qs}`, {
    method: "POST",
    headers: {
      "User-Agent": UA, Referer: REFERER, Cookie: account.cookie,
      Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return JSON.parse(res.body);
}

function extractTaskList(payload) {
  const result = payload && typeof payload.result === "object" ? payload.result : {};
  const user = result && typeof result.user === "object" ? result.user : {};
  const levelInfo = user && typeof user.level_info === "object" ? user.level_info : {};
  const groups = Array.isArray(result.task_list) ? result.task_list : [];

  const tasks = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") {
      continue;
    }
    const groupTitle = toText(group.title);
    const list = Array.isArray(group.tasks) ? group.tasks : [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const reportExtra = item.report_extra && typeof item.report_extra === "object" ? item.report_extra : {};
      const awardList = Array.isArray(item.award_desc_v2) ? item.award_desc_v2 : [];
      const awardText = awardList
        .map((a) => {
          const desc = toText(a.desc);
          const icon = toText(a.icon);
          if (icon.includes("b9aca51c")) return `${desc}H币`;
          if (icon.includes("c10d89ae")) return `${desc}经验`;
          if (icon.includes("e63b192a")) return `${desc}盒电`;
          return desc;
        })
        .filter(Boolean)
        .join(" ");
      tasks.push({
        groupTitle,
        title: toText(item.title),
        state: toText(item.state),
        stateDesc: toText(item.state_desc),
        taskId: toText(reportExtra.task_id),
        taskType: toText(item.type),
        reportTaskType: toText(reportExtra.task_type),
        awardText,
      });
    }
  }

  return {
    nickname: toText(user.username),
    coin: toText(levelInfo.coin),
    tasks,
  };
}

function taskKey(task) {
  return `${task.taskId}|${task.title}`;
}

function findTaskByKey(snapshot, key) {
  return snapshot.tasks.find((task) => taskKey(task) === key);
}

function isDailyTask(task) {
  return isSignTask(task) || task.reportTaskType === "daily";
}

function isSignTask(task) {
  return task.taskType === "sign";
}

function isOkPayload(payload) {
  return toText(payload?.status) === OK_STATE;
}

function collectObjects(root, matcher, limit = 20) {
  const out = [];
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }

    if (matcher(node)) {
      out.push(node);
      if (out.length >= limit) {
        break;
      }
    }

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        stack.push(node[i]);
      }
    } else {
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        stack.push(node[keys[i]]);
      }
    }
  }

  return out;
}

function extractFeedCandidates(payload) {
  const links = payload?.result?.links;
  if (!Array.isArray(links)) {
    return [];
  }

  const seen = new Set();
  const out = [];
  for (const item of links) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const linkId = toText(item.link_id);
    const hSrc = toText(item.h_src);
    if (!/^\d+$/.test(linkId) || !hSrc) {
      continue;
    }

    const key = `${linkId}|${hSrc}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ linkId, hSrc });
  }
  return out;
}

function extractRecommendGameCandidates(payload) {
  const result = payload?.result;
  const objects = collectObjects(
    result,
    (node) =>
      !Array.isArray(node) &&
      Object.prototype.hasOwnProperty.call(node, "appid") &&
      Object.prototype.hasOwnProperty.call(node, "h_src"),
    40,
  );

  const seen = new Set();
  const out = [];
  for (const obj of objects) {
    const appid = toText(obj.appid);
    const hSrc = toText(obj.h_src);
    if (!/^\d+$/.test(appid) || !hSrc) {
      continue;
    }

    const key = `${appid}|${hSrc}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ appid, hSrc });
  }
  return out;
}

function extractGameCommentUserId(payload) {
  const links = payload?.result?.links;
  if (!Array.isArray(links) || links.length === 0) {
    return "";
  }

  for (const item of links) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const userId = toText(item.userid);
    if (/^\d+$/.test(userId)) {
      return userId;
    }
  }
  return "";
}

function extractGameCommentCandidate(payload) {
  const links = payload?.result?.links;
  if (!Array.isArray(links) || links.length === 0) {
    return null;
  }

  for (const item of links) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const linkId = toText(item.linkid || item.link_id);
    const hSrc = toText(item.h_src);
    const userId = toText(item.userid);
    if (/^\d+$/.test(linkId) && /^\d+$/.test(userId) && hSrc) {
      return { linkId, hSrc, userId };
    }
  }

  return null;
}

function buildShareEventReport(action, source, extra = {}) {
  return JSON.stringify({
    events: [
      {
        type: action === "tap" ? "4" : "3",
        path: action === "tap" ? PATH_SHARE_TAP : PATH_SHARE_SUCCESS,
        time: String(Math.floor(Date.now() / 1000)),
        addition: {
          ...extra,
          src: source,
          plat: SHARE_EVENT_PLATFORM,
        },
      },
    ],
  });
}

async function sendShareEvents(source, extra, account, runtime) {
  const sessionId = crypto.randomUUID();
  for (const action of ["tap", "success"]) {
    const resp = await postEncryptedForm(
      DATA_BASE, PATH_DATA_REPORT, account, runtime,
      buildShareEventReport(action, source, extra),
      { type: "104", session_id: sessionId },
    );
    if (!isOkPayload(resp)) {
      throw new Error(`分享 ${action} 上报失败 status=${toText(resp?.status)} msg=${toText(resp?.msg)}`);
    }
    if (action === "tap") await wait(2000);
  }
}

async function settleShareTask(task, fetchSnapshotFn, detail) {
  await wait(SHARE_TASK_SETTLE_MS);
  const snapshot = await fetchSnapshotFn();
  const after = findTaskByKey(snapshot, taskKey(task));
  if (after && after.state === FINISH_STATE) {
    return { ok: true, message: `${task.title} 完成${detail ? " " + detail : ""}`, snapshot };
  }
  return { ok: false, message: `${task.title} 未完成` };
}

async function executeSign(account, runtime) {
  const signResp = await callSignedApi(PATH_SIGN, account, runtime);
  const firstState = toText(signResp?.result?.state);
  if (firstState === "ignore") {
    return { ok: true, message: "今日已签到" };
  }
  await wait(800);
  const finalPayload = await callSignedApi(PATH_STATE, account, runtime);
  const status = toText(finalPayload.status);
  const r = finalPayload?.result || {};
  const state = toText(r.state);

  if ((status === OK_STATE && state === OK_STATE) || state === "ignore") {
    const parts = [];
    if (r.sign_in_coin) parts.push(`+${r.sign_in_coin}H币`);
    if (r.sign_in_exp) parts.push(`+${r.sign_in_exp}经验`);
    if (r.sign_in_streak) parts.push(`连签${r.sign_in_streak}天`);
    return { ok: true, message: parts.length ? parts.join(" ") : "签到完成" };
  }

  return { ok: false, message: toText(finalPayload.msg) || state || "签到失败" };
}

async function executeSharePost(task, account, runtime, fetchSnapshotFn) {
  const feedPayload = await callSignedApi(PATH_FEEDS, account, runtime, FEEDS_QUERY_BASE);
  if (!isOkPayload(feedPayload)) return { ok: false, message: `${task.title} 拉取帖子流失败` };
  const posts = extractFeedCandidates(feedPayload);
  if (posts.length === 0) return { ok: false, message: `${task.title} 没有可用帖子` };
  const post = posts[0];

  await wait(1000);
  const viewTimeResp = await postEncryptedForm(DATA_BASE, PATH_VIEW_TIME, account, runtime, JSON.stringify({
    duration: [{ id: Number(post.linkId), duration: POST_SHARE_VIEW_SECONDS, duration_ms: POST_SHARE_VIEW_MILLISECONDS, type: "link", time: Math.floor(Date.now() / 1000), h_src: post.hSrc }],
    shows: [], disappear: [],
  }));
  if (!isOkPayload(viewTimeResp)) return { ok: false, message: `${task.title} view_time 上报失败` };

  await sendShareEvents("link", { link_id: post.linkId, h_src: post.hSrc }, account, runtime);
  return settleShareTask(task, fetchSnapshotFn, `link_id=${post.linkId}`);
}

async function executeShareGameDetail(task, account, runtime, fetchSnapshotFn) {
  const recommendPayload = await callSignedApi(PATH_GAME_RECOMMEND, account, runtime, GAME_RECOMMEND_QUERY_BASE);
  if (!isOkPayload(recommendPayload)) return { ok: false, message: `${task.title} 拉取游戏列表失败` };
  const games = extractRecommendGameCandidates(recommendPayload);
  if (games.length === 0) return { ok: false, message: `${task.title} 没有可用游戏` };

  const game = games[0];
  await wait(1000);
  await sendShareEvents("game_detail", { app_id: game.appid, h_src: game.hSrc }, account, runtime);
  return settleShareTask(task, fetchSnapshotFn, `appid=${game.appid}`);
}

async function executeShareGameComment(task, account, runtime, fetchSnapshotFn) {
  const recommendPayload = await callSignedApi(PATH_GAME_RECOMMEND, account, runtime, GAME_RECOMMEND_QUERY_BASE);
  if (!isOkPayload(recommendPayload)) return { ok: false, message: `${task.title} 拉取游戏列表失败` };
  const games = extractRecommendGameCandidates(recommendPayload);
  if (games.length === 0) return { ok: false, message: `${task.title} 没有可用游戏` };

  const game = games[0];
  const commentsPayload = await callSignedApi(PATH_GAME_COMMENTS, account, runtime, { ...GAME_COMMENTS_QUERY_BASE, appid: game.appid });
  if (!isOkPayload(commentsPayload)) return { ok: false, message: `${task.title} 拉取游戏评论失败` };

  const comment = extractGameCommentCandidate(commentsPayload);
  if (!comment) return { ok: false, message: `${task.title} 评论列表缺少关键字段` };

  await sendShareEvents("game_comment", { link_id: comment.linkId }, account, runtime);
  return settleShareTask(task, fetchSnapshotFn, `appid=${game.appid}`);
}

const TASK_HANDLERS = {
  "1":  executeSharePost,        // 分享帖子
  "19": executeShareGameDetail,  // 分享游戏详情
  "31": executeShareGameComment, // 分享游戏评价
};

async function executeTask(task, account, runtime, fetchSnapshotFn) {
  if (!isDailyTask(task)) {
    return { ok: false, unsupported: true, message: "不是脚本处理的每日任务" };
  }
  const handler = isSignTask(task)
    ? (t, a, r) => executeSign(a, r)
    : TASK_HANDLERS[task.taskId];
  if (!handler) {
    return { ok: false, unsupported: true, message: `未支持任务 task_id=${task.taskId}` };
  }
  try {
    return await handler(task, account, runtime, fetchSnapshotFn);
  } catch (error) {
    return { ok: false, message: `${task.title} 请求异常 ${error.message}` };
  }
}

async function fetchSnapshot(account, runtime) {
  const payload = await callSignedApi(PATH_LIST, account, runtime);
  return extractTaskList(payload);
}

async function runAccount(account, runtime) {
  console.log(`\n========== 账号${account.index} ==========`);
  let snapshot = await fetchSnapshot(account, runtime);
  console.log(`账号=${snapshot.nickname || account.heyboxId} 黑盒ID=${account.heyboxId} IMEI=${account.imei}`);

  const unsupported = new Set();
  const done = new Set();

  const dailyTasks = snapshot.tasks.filter((task) => isDailyTask(task));
  for (const task of dailyTasks) {
    if (task.state === FINISH_STATE) {
      done.add(task.title || taskKey(task));
      const award = task.awardText ? ` (${task.awardText})` : "";
      console.log(`${task.title}: 已完成${award}`);
    }
  }

  const waitingTasks = dailyTasks.filter((task) => task.state === WAITING_STATE);
  for (const task of waitingTasks) {
    const key = taskKey(task);
    snapshot = await fetchSnapshot(account, runtime);
    const latestTask = findTaskByKey(snapshot, key);
    if (!latestTask) {
      console.log(`${task.title} (task_id=${task.taskId || "none"}): 任务已不存在，跳过`);
      continue;
    }
    if (latestTask.state === FINISH_STATE) {
      done.add(latestTask.title || key);
      console.log(`${latestTask.title}: 已完成`);
      continue;
    }
    if (latestTask.state !== WAITING_STATE) {
      const currentState = latestTask.stateDesc || latestTask.state || "unknown";
      console.log(`${latestTask.title} (task_id=${latestTask.taskId || "none"}): 当前状态 ${currentState}，跳过`);
      continue;
    }

    const result = await executeTask(latestTask, account, runtime, () =>
      fetchSnapshot(account, runtime),
    );

    if (result.unsupported) {
      unsupported.add(latestTask.title || key);
      continue;
    }

    if (result.snapshot) {
      snapshot = result.snapshot;
    } else {
      await wait(900);
      snapshot = await fetchSnapshot(account, runtime);
    }
    const after = findTaskByKey(snapshot, key);

    if (after && after.state === FINISH_STATE) {
      done.add(after.title || key);
      const award = latestTask.awardText ? ` 奖励: ${latestTask.awardText}` : "";
      const extra = result.message ? ` (${result.message})` : "";
      console.log(`${after.title}: 已完成${award}${extra}`);
    } else {
      console.log(`${latestTask.title}: 未完成，${result.message}`);
    }
  }

  snapshot = await fetchSnapshot(account, runtime);
  console.log(`当前总H币: ${snapshot.coin || "未知"}`);

  if (unsupported.size > 0) {
    console.log(`未支持任务: ${Array.from(unsupported).join(" | ")}`);
  }

  const coreWaiting = snapshot.tasks.filter(
    (task) => isDailyTask(task) && task.state === WAITING_STATE,
  );
  return {
    ok: coreWaiting.length === 0,
    doneCount: done.size,
  };
}

async function main() {
  let accounts;
  try {
    accounts = parseAccountEnv();
  } catch (error) {
    console.log(`初始化失败: ${error.message}`);
    console.log("示例: heybox_ck='pkey=xxx; x_xhh_tokenid=xxx;'");
    process.exit(1);
    return;
  }

  const runtime = {
    version: "",
    build: "",
  };

  try {
    const boot = await requestHkey(PATH_LIST, Math.floor(Date.now() / 1000), accounts[0]);
    runtime.version = boot.version;
    runtime.build = boot.build;
    console.log(`当前版本: ${runtime.version} build=${runtime.build}`);
  } catch (error) {
    console.log(`初始化失败: ${error.message}`);
    process.exit(1);
    return;
  }

  let okCount = 0;
  for (const account of accounts) {
    try {
      const result = await runAccount(account, runtime);
      if (result.ok) {
        okCount += 1;
      }
    } catch (error) {
      console.log(`\n========== 账号${account.index} ==========`);
      console.log("任务执行失败");
      console.log(`失败信息: ${error.message}`);
    }
  }

  console.log(`\n完成: ${okCount}/${accounts.length}`);
  process.exit(okCount === accounts.length ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.log(`脚本异常: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildShareEventReport,
  decodePkeyToUserId,
  executeSharePost,
  executeShareGameDetail,
  executeShareGameComment,
  parseAccountEnv,
  requestHkey,
};
