/*
小黑盒 - 0元抽奖盒券任务
账号环境变量:
  heybox_ck=pkey=xxx;x_xhh_tokenid=xxx;
*/
const { $, tools } = require("./src/core");
const {
  API_BASE,
  DATA_NAME,
  HeyboxAccount,
  HeyboxAppClient,
  HeyboxWebClient,
  OK_STATE,
  sendShareEvents,
  sendWebShareEvent,
} = require("./src/heybox");

exports.name = "小黑盒.抽奖盒券";

const PATH_HOME = "/store/roll_room_v2/get_home_info";
const PATH_TICKET_LIST = "/store/roll_room_v2/ticket_list";
const PATH_JOIN = "/store/roll_room_v2/join";
const PATH_SHARED = "/task/shared/";
const PATH_ROOM_LIST = "/store/roll_room_v2/room_list";
const PATH_DATA_REPORT = "/store/roll_room_v2/data_report";
const PATH_GAME_JSDATA = "/game/jsdata";

const CONFIG = Object.freeze({
  roomListLimit: 15,
  maxRoomListPages: 10,
  autoPreTasks: true,
  autoJoin: true,
  autoShare: true,
  printTickets: true,
  injectViewSeconds: 18,
  injectVerifyIntervalMs: 5000,
  injectVerifyMaxTimes: 4,
  shareVerifyIntervalMs: 5000,
  shareVerifyMaxTimes: 4,
});

const PRE_JOIN_TASK_KEYS = new Set([
  "add_to_wish_list",
  "follow_game",
  "inject_js_for_count",
  "focus_on_homeowner",
  "own_game",
  "buy_game_spu",
]);

const DIRECT_REPORT_TASK_KEYS = new Set([
  "inject_js_for_count",
  "focus_on_homeowner",
]);

const WISHLIST_TASK_KEYS = new Set([
  "add_to_wish_list",
  "follow_game",
]);

function getTaskSummary(task) {
  const progress = Array.isArray(task.progress) ? ` ${task.progress[0]}/${task.progress[1]}` : "";
  return `${task.task_key || task.task_id}: ${task.task_name} +${task.award_ticket || 0}盒券 ` +
    `${task.finished ? "已完成" : "未完成"}${progress}`;
}

function normalizeAward(item) {
  const awardId = tools.toText(item?.award_id);
  if (!awardId) return null;
  return {
    awardId,
    awardName: tools.toText(item?.award_name),
    status: item?.status,
    statusMsg: tools.toText(item?.status_msg),
    joinedTotal: item?.joined_total,
    awardEndTime: tools.toText(item?.award_end_time),
  };
}

function isActiveAward(award) {
  return String(award.status) === "0" || /进行中/.test(award.statusMsg);
}

async function discoverAwardIds(webClient) {
  const awards = [];
  const seen = new Set();
  for (let page = 0; page < CONFIG.maxRoomListPages; page += 1) {
    const payload = await webClient.getJson(PATH_ROOM_LIST, {
      query: {
        limit: CONFIG.roomListLimit,
        offset: page * CONFIG.roomListLimit,
      },
      retries: 1,
    });
    const list = Array.isArray(payload?.result) ? payload.result : [];
    if (!list.length) break;
    for (const item of list) {
      const award = normalizeAward(item);
      if (!award || !isActiveAward(award) || seen.has(award.awardId)) continue;
      seen.add(award.awardId);
      awards.push(award);
    }
    if (list.length < CONFIG.roomListLimit) break;
  }
  return awards;
}

async function fetchHome(webClient, awardId) {
  return webClient.getJson(PATH_HOME, {
    query: { award_id: awardId },
    retries: 1,
  });
}

async function fetchTicketList(webClient, account, awardId) {
  return webClient.getJson(PATH_TICKET_LIST, {
    query: {
      offset: 0,
      limit: 20,
      award_id: awardId,
      other_heybox_id: account.heyboxId,
    },
    retries: 1,
  });
}

async function joinRollRoom(webClient, awardId) {
  return webClient.postJson(PATH_JOIN, {
    query: { osType: "web" },
    body: { award_id: awardId },
    retries: 0,
  });
}

async function reportRollTask(webClient, task) {
  return webClient.postJson(PATH_DATA_REPORT, {
    body: {
      report_type: 1,
      task_type: tools.toText(task.task_key),
      task_id: task.task_id,
    },
    retries: 0,
  });
}

function extractShareInfo(task, awardId) {
  const parsed = parseProtocol(task?.jump_protocol) || {};
  const fallbackUrl = `${API_BASE}/store/roll_room_v2?award_id=${encodeURIComponent(awardId)}`;
  return {
    actId: tools.toText(parsed.act_id) || `_rollroomv2_${awardId}`,
    shareUrl: tools.toText(parsed.share_url) || fallbackUrl,
    title: tools.toText(parsed.title),
  };
}

async function shareRollTask(account, webClient, appClient, awardId, task) {
  const shareInfo = extractShareInfo(task, awardId);
  const payload = await appClient.getJson(PATH_SHARED, {
    act_id: shareInfo.actId,
    shared_type: "web",
    share_plat: "WechatSession",
    web_url: shareInfo.shareUrl,
  });
  account.log(`${task.task_name || "分享活动"}: shared接口 ${JSON.stringify(payload).slice(0, 180)}`);
  if (!isOkPayload(payload)) return false;

  try {
    await sendShareEvents(appClient, "roll_room_v2", {
      act_id: shareInfo.actId,
      award_id: String(awardId),
      title: shareInfo.title,
    });
    account.log(`${task.task_name || "分享活动"}: 分享行为上报 ok`);
  } catch (error) {
    account.log(`${task.task_name || "分享活动"}: 分享行为上报失败 ${error.message}`);
  }

  try {
    for (const action of ["visit", "click", "success"]) {
      await sendWebShareEvent(webClient, action, "/store/roll_room_v2", {
        act_id: shareInfo.actId,
        award_id: String(awardId),
        share_url: shareInfo.shareUrl,
      });
      await tools.sleep(500);
    }
    account.log(`${task.task_name || "分享活动"}: web_share上报 ok`);
  } catch (error) {
    account.log(`${task.task_name || "分享活动"}: web_share上报失败 ${error.message}`);
  }
  return true;
}

function decodeProtocol(input) {
  let text = tools.toText(input).replace(/^heybox:\/\//, "");
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return text;
}

function parseProtocol(input) {
  const text = decodeProtocol(input);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractAppId(task) {
  const protocol = tools.toText(task?.jump_protocol);
  const decoded = decodeProtocol(protocol);
  const urlAppidMatch = decoded.match(/[?&]appid=(\d+)/i);
  if (urlAppidMatch) return urlAppidMatch[1];
  const appMatch = decoded.match(/"app_id"\s*:?\s*"?(\d+)"?/i);
  if (appMatch) return appMatch[1];

  const parsed = parseProtocol(protocol);
  const stack = [parsed];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (node.appid && /^\d+$/.test(String(node.appid))) return String(node.appid);
    if (node.app_id && /^\d+$/.test(String(node.app_id))) return String(node.app_id);
    if (node.url) {
      const urlMatch = tools.toText(node.url).match(/[?&]appid=(\d+)/i);
      if (urlMatch) return urlMatch[1];
    }
    const values = Array.isArray(node) ? node : Object.values(node);
    for (let index = values.length - 1; index >= 0; index -= 1) stack.push(values[index]);
  }
  return "";
}

function isOkPayload(payload) {
  return tools.toText(payload?.status) === OK_STATE;
}

function toTaskList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

function getTaskIdentity(task) {
  return tools.toText(task?.task_id) || tools.toText(task?.task_key);
}

function getTasks(payload) {
  const result = payload?.result || {};
  const tasks = [
    ...toTaskList(result.front_task),
    ...toTaskList(result.task_list),
  ];
  const seen = new Set();
  return tasks.filter((task) => {
    const identity = getTaskIdentity(task);
    if (!identity) return false;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function isRunnableTask(task) {
  return ["share_act"].includes(tools.toText(task?.task_key));
}

function getPendingRunnableTasks(payload) {
  return getTasks(payload).filter((task) => !task.finished && isRunnableTask(task));
}

function getPendingUnsupportedTasks(payload) {
  return getTasks(payload).filter((task) => !task.finished && !isRunnableTask(task));
}

function getPendingPreJoinTasks(payload) {
  return getTasks(payload).filter((task) => !task.finished && PRE_JOIN_TASK_KEYS.has(tools.toText(task?.task_key)));
}

function isActivityDone(payload) {
  const result = payload?.result || {};
  const tasks = getTasks(payload);
  return Boolean(result.joined) && (tasks.length === 0 || tasks.every((task) => task.finished));
}

function printHome(account, payload) {
  const result = payload?.result || {};
  account.log(`奖品: ${tools.toText(result.award_info?.award_name) || "未知"}`);
  account.log(`help_code=${result.help_code || "-"} my_ticket=${result.my_ticket ?? 0} joined=${result.joined}`);
  const tasks = getTasks(payload);
  if (!tasks.length) {
    account.log("未发现盒券任务");
    return;
  }
  account.log("盒券任务:");
  for (const task of tasks) account.log(`- ${getTaskSummary(task)}`, { noPrefix: true });
}

function printTicketList(account, payload) {
  const result = payload?.result || {};
  account.log(`盒券合计: ${result.total_ticket ?? 0}, 空白券: ${result.blank_ticket_count ?? 0}`);
  const list = Array.isArray(result.list) ? result.list : [];
  for (const item of list) {
    account.log(
      `${item.gain_time || "-"} +${item.ticket_count || 0} ${tools.toText(item.ticket_source)} ${item.serial_number || ""}`,
    );
  }
}

async function executeDirectReportTask(account, webClient, task) {
  const payload = await reportRollTask(webClient, task);
  account.log(`${task.task_name}: 上报 ${JSON.stringify(payload).slice(0, 180)}`);
  return isOkPayload(payload);
}

function extractProtocolField(task, fieldName) {
  const parsed = parseProtocol(task?.jump_protocol);
  if (!parsed || typeof parsed !== "object") return "";
  return tools.toText(parsed[fieldName]);
}

function extractInjectKey(task) {
  return extractProtocolField(task, "key");
}

async function fetchInjectJsData(appClient, key) {
  return appClient.postJson(PATH_GAME_JSDATA, { key }, undefined, { retries: 0 });
}

async function executeInjectJsTask(account, webClient, appClient, awardId, task) {
  const key = extractInjectKey(task);
  const reportPayload = await reportRollTask(webClient, task);
  account.log(`${task.task_name}: 前置上报 ${JSON.stringify(reportPayload).slice(0, 180)}`);
  if (!isOkPayload(reportPayload)) return false;

  if (!key) {
    account.log(`${task.task_name}: 未解析到 openInjectJSWindow key`);
  } else {
    const jsPayload = await fetchInjectJsData(appClient, key);
    const targetUrl = tools.toText(jsPayload?.result?.url);
    account.log(`${task.task_name}: 注入配置 ${isOkPayload(jsPayload) ? "ok" : "失败"}${targetUrl ? ` ${targetUrl}` : ""}`);
    if (!isOkPayload(jsPayload)) return false;
  }

  account.log(`${task.task_name}: 模拟停留${CONFIG.injectViewSeconds}秒后回查`);
  await tools.sleep(CONFIG.injectViewSeconds * 1000);
  for (let index = 0; index < CONFIG.injectVerifyMaxTimes; index += 1) {
    const home = await fetchHome(webClient, awardId);
    const latest = getTasks(home).find((item) => String(item.task_id) === String(task.task_id));
    if (latest?.finished) return true;
    if (index < CONFIG.injectVerifyMaxTimes - 1) await tools.sleep(CONFIG.injectVerifyIntervalMs);
  }
  account.log(`${task.task_name}: 回查仍未完成，可能还需要 App 原生加密停留行为上报`);
  return false;
}

async function skipWishlistTask(account, task) {
  const appid = extractAppId(task);
  account.log(`${task.task_name}: 心愿单类任务目前不支持，跳过${appid ? ` appid=${appid}` : ""}`);
  return false;
}

async function executePreJoinTask(account, webClient, appClient, task) {
  const taskKey = tools.toText(task.task_key);
  try {
    if (WISHLIST_TASK_KEYS.has(taskKey)) return await skipWishlistTask(account, task);
    if (taskKey === "inject_js_for_count") {
      const awardId = tools.toText(task.award_id);
      return await executeInjectJsTask(account, webClient, appClient, awardId, task);
    }
    if (DIRECT_REPORT_TASK_KEYS.has(taskKey)) return await executeDirectReportTask(account, webClient, task);
    account.log(`${task.task_name}: 暂不支持自动完成 task_key=${taskKey}`);
    return false;
  } catch (error) {
    account.log(`${task.task_name}: 执行失败 ${error.message}`);
    return false;
  }
}

async function runPreJoinTasks(account, webClient, appClient, awardId, home) {
  if (!CONFIG.autoPreTasks || home?.result?.joined) return home;
  let current = home;
  for (const task of getPendingPreJoinTasks(current)) {
    await executePreJoinTask(account, webClient, appClient, { ...task, award_id: task.award_id || awardId });
    await tools.sleep(1000);
    current = await fetchHome(webClient, awardId);
    const latest = getTasks(current).find((item) => String(item.task_id) === String(task.task_id));
    if (latest?.finished) account.log(`${latest.task_name}: 已完成`);
  }
  return current;
}

async function runAward(account, webClient, appClient, award) {
  const awardId = award.awardId;
  account.log(`抽奖活动 award_id=${awardId} ${award.awardName || ""}`.trim());
  let home = await fetchHome(webClient, awardId);
  if (isActivityDone(home)) {
    account.log("活动已完成，跳过");
    if (CONFIG.printTickets) {
      const tickets = await fetchTicketList(webClient, account, awardId);
      printTicketList(account, tickets);
    }
    return { skipped: true };
  }

  home = await runPreJoinTasks(account, webClient, appClient, awardId, home);

  if (CONFIG.autoJoin && !home?.result?.joined) {
    const blockers = getPendingPreJoinTasks(home);
    if (blockers.length) {
      account.log(`前置参与任务未完成，跳过参与抽奖: ${blockers.map((task) => task.task_key || task.task_id).join(", ")}`);
    } else {
      const joinPayload = await joinRollRoom(webClient, awardId);
      account.log(`参与抽奖: ${JSON.stringify(joinPayload).slice(0, 300)}`);
      await tools.sleep(800);
      home = await fetchHome(webClient, awardId);
    }
  }

  const shouldShare = CONFIG.autoShare && home?.result?.joined && getPendingRunnableTasks(home)
    .some((task) => tools.toText(task.task_key) === "share_act");
  if (shouldShare) {
    const shareTask = getPendingRunnableTasks(home).find((task) => tools.toText(task.task_key) === "share_act");
    await shareRollTask(account, webClient, appClient, awardId, shareTask);
    for (let index = 0; index < CONFIG.shareVerifyMaxTimes; index += 1) {
      await tools.sleep(index === 0 ? 1200 : CONFIG.shareVerifyIntervalMs);
      home = await fetchHome(webClient, awardId);
      const latest = getTasks(home).find((task) => tools.toText(task.task_key) === "share_act");
      if (latest?.finished) {
        account.log("分享活动: 已完成");
        break;
      }
    }
  }

  printHome(account, home);
  const unsupported = getPendingUnsupportedTasks(home);
  if (unsupported.length) {
    account.log(`未自动处理任务: ${unsupported.map((task) => task.task_key || task.task_id).join(", ")}`);
  }
  if (CONFIG.printTickets) {
    const tickets = await fetchTicketList(webClient, account, awardId);
    printTicketList(account, tickets);
  }
  return { skipped: false, done: isActivityDone(home), unsupportedCount: unsupported.length };
}

async function runAccount(account, awards) {
  const webClient = new HeyboxWebClient(account);
  const appClient = new HeyboxAppClient(account);
  let runCount = 0;
  let skipCount = 0;
  let doneCount = 0;

  for (const award of awards) {
    try {
      const result = await runAward(account, webClient, appClient, award);
      if (result.skipped) skipCount += 1;
      else runCount += 1;
      if (result.done) doneCount += 1;
      await tools.sleep(500);
    } catch (error) {
      account.log(`award_id=${award.awardId} 处理失败: ${error.message}`);
      process.exitCode = 1;
    }
  }

  account.log(`抽奖活动处理完成: 跑=${runCount}, 跳过=${skipCount}, 当前完成=${doneCount}/${awards.length}`);
}

async function run() {
  if (!await $.read_env(HeyboxAccount, DATA_NAME)) return;
  const discoveryClient = new HeyboxWebClient($.userList[0]);
  const awards = await discoverAwardIds(discoveryClient);
  if (!awards.length) {
    $.log("未发现当前进行中的抽奖活动");
    return;
  }
  $.log(`发现进行中抽奖活动: ${awards.length} 个`);
  for (const award of awards) {
    $.log(`- award_id=${award.awardId} ${award.awardName || ""} ${award.statusMsg || ""}`.trim());
  }
  for (const account of $.userList) {
    try {
      await runAccount(account, awards);
    } catch (error) {
      account.log(`抽奖盒券任务失败: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

exports.run = run;

if (require.main === module) $.start(exports);
