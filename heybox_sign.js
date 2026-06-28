/*
小黑盒 - 每日任务
账号环境变量:
  heybox_ck=pkey=xxx;x_xhh_tokenid=xxx;
*/
const { $, tools } = require("./src/core");
const {
  DATA_BASE,
  DATA_NAME,
  HeyboxAccount,
  HeyboxAppClient,
  OK_STATE,
  PATH_DATA_REPORT,
  sendShareEvents,
} = require("./src/heybox");

exports.name = "小黑盒.每日任务";

const WAITING_STATE = "waiting";
const FINISH_STATE = "finish";

const PATH_LIST = "/task/list_v2/";
const PATH_SIGN = "/task/sign_v3/sign";
const PATH_STATE = "/task/sign_v3/get_sign_state";
const PATH_FEEDS = "/bbs/app/feeds";
const PATH_GAME_RECOMMEND = "/game/all_recommend/v2";
const PATH_GAME_COMMENTS = "/bbs/app/link/game/comments";
const PATH_VIEW_TIME = "/bbs/app/link/view/time";

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
const GAME_RECOMMEND_QUERY_BASE = Object.freeze({ offset: "0", limit: "1" });
const GAME_COMMENTS_QUERY_BASE = Object.freeze({
  api_version: "4",
  offset: "0",
  limit: "30",
});

function isOkPayload(payload) {
  return tools.toText(payload?.status) === OK_STATE;
}

function extractTaskList(payload) {
  const result = payload && typeof payload.result === "object" ? payload.result : {};
  const user = result && typeof result.user === "object" ? result.user : {};
  const levelInfo = user && typeof user.level_info === "object" ? user.level_info : {};
  const groups = Array.isArray(result.task_list) ? result.task_list : [];

  const tasks = [];
  for (const group of groups) {
    const groupTitle = tools.toText(group?.title);
    const list = Array.isArray(group?.tasks) ? group.tasks : [];
    for (const item of list) {
      const reportExtra = item?.report_extra && typeof item.report_extra === "object" ? item.report_extra : {};
      const awardText = (Array.isArray(item?.award_desc_v2) ? item.award_desc_v2 : [])
        .map((award) => {
          const desc = tools.toText(award.desc);
          const icon = tools.toText(award.icon);
          if (icon.includes("b9aca51c")) return `${desc}H币`;
          if (icon.includes("c10d89ae")) return `${desc}经验`;
          if (icon.includes("e63b192a")) return `${desc}盒电`;
          return desc;
        })
        .filter(Boolean)
        .join(" ");
      tasks.push({
        groupTitle,
        title: tools.toText(item?.title),
        state: tools.toText(item?.state),
        stateDesc: tools.toText(item?.state_desc),
        taskId: tools.toText(reportExtra.task_id),
        taskType: tools.toText(item?.type),
        reportTaskType: tools.toText(reportExtra.task_type),
        awardText,
      });
    }
  }

  return {
    nickname: tools.toText(user.username),
    coin: tools.toText(levelInfo.coin),
    tasks,
  };
}

function collectObjects(root, matcher, limit = 20) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (matcher(node)) {
      out.push(node);
      if (out.length >= limit) break;
    }
    const values = Array.isArray(node) ? node : Object.values(node);
    for (let index = values.length - 1; index >= 0; index -= 1) stack.push(values[index]);
  }
  return out;
}

function extractFeedCandidates(payload) {
  const links = payload?.result?.links;
  if (!Array.isArray(links)) return [];
  const seen = new Set();
  const out = [];
  for (const item of links) {
    const linkId = tools.toText(item?.link_id);
    const hSrc = tools.toText(item?.h_src);
    if (!/^\d+$/.test(linkId) || !hSrc) continue;
    const key = `${linkId}|${hSrc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ linkId, hSrc });
  }
  return out;
}

function extractRecommendGameCandidates(payload) {
  const objects = collectObjects(
    payload?.result,
    (node) =>
      !Array.isArray(node) &&
      Object.prototype.hasOwnProperty.call(node, "appid") &&
      Object.prototype.hasOwnProperty.call(node, "h_src"),
    40,
  );
  const seen = new Set();
  const out = [];
  for (const obj of objects) {
    const appid = tools.toText(obj.appid);
    const hSrc = tools.toText(obj.h_src);
    if (!/^\d+$/.test(appid) || !hSrc) continue;
    const key = `${appid}|${hSrc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ appid, hSrc });
  }
  return out;
}

function extractGameCommentCandidate(payload) {
  const links = payload?.result?.links;
  if (!Array.isArray(links)) return null;
  for (const item of links) {
    const linkId = tools.toText(item?.linkid || item?.link_id);
    const hSrc = tools.toText(item?.h_src);
    const userId = tools.toText(item?.userid);
    if (/^\d+$/.test(linkId) && /^\d+$/.test(userId) && hSrc) return { linkId, hSrc, userId };
  }
  return null;
}

function taskKey(task) {
  return `${task.taskId}|${task.title}`;
}

function findTaskByKey(snapshot, key) {
  return snapshot.tasks.find((task) => taskKey(task) === key);
}

function isSignTask(task) {
  return task.taskType === "sign";
}

function isDailyTask(task) {
  return isSignTask(task) || task.reportTaskType === "daily";
}

async function settleShareTask(task, fetchSnapshotFn, detail) {
  await tools.sleep(SHARE_TASK_SETTLE_MS);
  const snapshot = await fetchSnapshotFn();
  const after = findTaskByKey(snapshot, taskKey(task));
  if (after && after.state === FINISH_STATE) {
    return { ok: true, message: `${task.title} 完成${detail ? ` ${detail}` : ""}`, snapshot };
  }
  return { ok: false, message: `${task.title} 未完成` };
}

async function executeSign(client) {
  const signResp = await client.getJson(PATH_SIGN);
  const firstState = tools.toText(signResp?.result?.state);
  if (firstState === "ignore") return { ok: true, message: "今日已签到" };
  await tools.sleep(800);
  const finalPayload = await client.getJson(PATH_STATE);
  const status = tools.toText(finalPayload.status);
  const result = finalPayload?.result || {};
  const state = tools.toText(result.state);
  if ((status === OK_STATE && state === OK_STATE) || state === "ignore") {
    const parts = [];
    if (result.sign_in_coin) parts.push(`+${result.sign_in_coin}H币`);
    if (result.sign_in_exp) parts.push(`+${result.sign_in_exp}经验`);
    if (result.sign_in_streak) parts.push(`连签${result.sign_in_streak}天`);
    return { ok: true, message: parts.length ? parts.join(" ") : "签到完成" };
  }
  return { ok: false, message: tools.toText(finalPayload.msg) || state || "签到失败" };
}

async function executeSharePost(task, client, fetchSnapshotFn) {
  const feedPayload = await client.getJson(PATH_FEEDS, FEEDS_QUERY_BASE);
  if (!isOkPayload(feedPayload)) return { ok: false, message: `${task.title} 拉取帖子流失败` };
  const posts = extractFeedCandidates(feedPayload);
  if (!posts.length) return { ok: false, message: `${task.title} 没有可用帖子` };
  const post = posts[0];

  await tools.sleep(1000);
  const viewTimeResp = await client.postEncryptedForm(
    PATH_VIEW_TIME,
    JSON.stringify({
      duration: [{
        id: Number(post.linkId),
        duration: POST_SHARE_VIEW_SECONDS,
        duration_ms: POST_SHARE_VIEW_MILLISECONDS,
        type: "link",
        time: Math.floor(Date.now() / 1000),
        h_src: post.hSrc,
      }],
      shows: [],
      disappear: [],
    }),
    {},
    { baseUrl: DATA_BASE },
  );
  if (!isOkPayload(viewTimeResp)) return { ok: false, message: `${task.title} view_time 上报失败` };

  await sendShareEvents(client, "link", { link_id: post.linkId, h_src: post.hSrc });
  return settleShareTask(task, fetchSnapshotFn, `link_id=${post.linkId}`);
}

async function executeShareGameDetail(task, client, fetchSnapshotFn) {
  const payload = await client.getJson(PATH_GAME_RECOMMEND, GAME_RECOMMEND_QUERY_BASE);
  if (!isOkPayload(payload)) return { ok: false, message: `${task.title} 拉取游戏列表失败` };
  const games = extractRecommendGameCandidates(payload);
  if (!games.length) return { ok: false, message: `${task.title} 没有可用游戏` };
  const game = games[0];
  await tools.sleep(1000);
  await sendShareEvents(client, "game_detail", { app_id: game.appid, h_src: game.hSrc });
  return settleShareTask(task, fetchSnapshotFn, `appid=${game.appid}`);
}

async function executeShareGameComment(task, client, fetchSnapshotFn) {
  const recommendPayload = await client.getJson(PATH_GAME_RECOMMEND, GAME_RECOMMEND_QUERY_BASE);
  if (!isOkPayload(recommendPayload)) return { ok: false, message: `${task.title} 拉取游戏列表失败` };
  const games = extractRecommendGameCandidates(recommendPayload);
  if (!games.length) return { ok: false, message: `${task.title} 没有可用游戏` };
  const game = games[0];
  const commentsPayload = await client.getJson(PATH_GAME_COMMENTS, {
    ...GAME_COMMENTS_QUERY_BASE,
    appid: game.appid,
  });
  if (!isOkPayload(commentsPayload)) return { ok: false, message: `${task.title} 拉取游戏评论失败` };
  const comment = extractGameCommentCandidate(commentsPayload);
  if (!comment) return { ok: false, message: `${task.title} 评论列表缺少关键字段` };
  await sendShareEvents(client, "game_comment", { link_id: comment.linkId });
  return settleShareTask(task, fetchSnapshotFn, `appid=${game.appid}`);
}

const TASK_HANDLERS = {
  "1": executeSharePost,
  "19": executeShareGameDetail,
  "31": executeShareGameComment,
};

async function executeTask(task, client, fetchSnapshotFn) {
  if (!isDailyTask(task)) return { ok: false, unsupported: true, message: "不是脚本处理的每日任务" };
  const handler = isSignTask(task) ? (t, c) => executeSign(c) : TASK_HANDLERS[task.taskId];
  if (!handler) return { ok: false, unsupported: true, message: `未支持任务 task_id=${task.taskId}` };
  try {
    return await handler(task, client, fetchSnapshotFn);
  } catch (error) {
    return { ok: false, message: `${task.title} 请求异常 ${error.message}` };
  }
}

async function fetchSnapshot(client) {
  return extractTaskList(await client.getJson(PATH_LIST));
}

async function runAccount(account, runtime) {
  account.log("开始每日任务");
  const client = new HeyboxAppClient(account, { runtime });
  let snapshot = await fetchSnapshot(client);
  account.log(`账号=${snapshot.nickname || account.heyboxId} 黑盒ID=${account.heyboxId} IMEI=${account.imei}`);

  const unsupported = new Set();
  const done = new Set();
  const dailyTasks = snapshot.tasks.filter(isDailyTask);
  for (const task of dailyTasks) {
    if (task.state === FINISH_STATE) {
      done.add(task.title || taskKey(task));
      const award = task.awardText ? ` (${task.awardText})` : "";
      account.log(`${task.title}: 已完成${award}`);
    }
  }

  for (const task of dailyTasks.filter((item) => item.state === WAITING_STATE)) {
    const key = taskKey(task);
    snapshot = await fetchSnapshot(client);
    const latestTask = findTaskByKey(snapshot, key);
    if (!latestTask || latestTask.state !== WAITING_STATE) continue;

    const result = await executeTask(latestTask, client, () => fetchSnapshot(client));
    if (result.unsupported) {
      unsupported.add(latestTask.title || key);
      continue;
    }

    snapshot = result.snapshot || await fetchSnapshot(client);
    const after = findTaskByKey(snapshot, key);
    if (after && after.state === FINISH_STATE) {
      done.add(after.title || key);
      const award = latestTask.awardText ? ` 奖励: ${latestTask.awardText}` : "";
      const extra = result.message ? ` (${result.message})` : "";
      account.log(`${after.title}: 已完成${award}${extra}`);
    } else {
      account.log(`${latestTask.title}: 未完成，${result.message}`);
    }
  }

  snapshot = await fetchSnapshot(client);
  account.log(`当前总H币: ${snapshot.coin || "未知"}`);
  if (unsupported.size) account.log(`未支持任务: ${Array.from(unsupported).join(" | ")}`);
  const waiting = snapshot.tasks.filter((task) => isDailyTask(task) && task.state === WAITING_STATE);
  return { ok: waiting.length === 0, doneCount: done.size };
}

async function run() {
  if (!await $.read_env(HeyboxAccount, DATA_NAME)) return;

  const runtime = { version: "", build: "" };
  const bootClient = new HeyboxAppClient($.userList[0], { runtime });
  const boot = await bootClient.requestHkey(PATH_LIST);
  runtime.version = boot.version;
  runtime.build = boot.build;
  $.log(`当前版本: ${runtime.version} build=${runtime.build}`);

  let okCount = 0;
  for (const account of $.userList) {
    try {
      const result = await runAccount(account, runtime);
      if (result.ok) okCount += 1;
    } catch (error) {
      account.log(`任务执行失败: ${error.message}`);
    }
  }

  $.log(`\n完成: ${okCount}/${$.userList.length}`);
  process.exitCode = okCount === $.userList.length ? 0 : 1;
}

exports.run = run;

if (require.main === module) $.start(exports);
