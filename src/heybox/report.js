const crypto = require("crypto");
const { DATA_BASE, OK_STATE } = require("./constants");
const { tools } = require("../core");

const PATH_DATA_REPORT = "/account/data_report/";
const PATH_DATA_REPORT_WEB = "/account/data_report_web/";
const PATH_SHARE_TAP = "/share/behavior/tap";
const PATH_SHARE_SUCCESS = "/share/behavior/success";
const SHARE_EVENT_PLATFORM = "WechatSession";
const WEB_REPORT_PUBLIC_KEY = [
  "-----BEGIN PUBLIC KEY-----",
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDZgjVwAiKTjZ55nG+mW6r3TSU4",
  "ECvNYqDMIS/bhCj2QaH5GI/KZb2TBp+CBvUj9SLFnmJQ0kzHzHoGZCQ88VevCffF7JePGF9cmKQqotlfTKbV4oxV5iLz7JSG6b/Vg7AXtrTolNtWsa8HiB0tI0YClYaQlOXm4UxLeSxQwSFETwIDAQAB",
  "-----END PUBLIC KEY-----",
].join("\n");
const WEB_REPORT_IV = "abcdefghijklmnop";
const WEB_REPORT_KEY_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

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

function isOkPayload(payload) {
  return tools.toText(payload?.status) === OK_STATE;
}

function randomWebReportKey() {
  let key = "";
  while (key.length < 16) {
    key += WEB_REPORT_KEY_CHARS[Math.floor(Math.random() * WEB_REPORT_KEY_CHARS.length)];
  }
  return key;
}

function sha1(input) {
  return crypto.createHash("sha1").update(String(input)).digest("hex");
}

function encryptWebReport(payload, reverseSid = true) {
  const aesKey = randomWebReportKey();
  const timeSec = Math.floor(Date.now() / 1000);
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(aesKey),
    Buffer.from(WEB_REPORT_IV),
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]).toString("base64");
  const key = crypto.publicEncrypt(
    {
      key: WEB_REPORT_PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(aesKey),
  ).toString("base64");
  return {
    sid: reverseSid ? sha1(data + timeSec) + sha1(key) : sha1(key + timeSec) + sha1(data),
    key,
    data,
    timeSec,
  };
}

async function postWebEncryptedReport(webClient, reportPayload, extraQuery = {}) {
  const encrypted = encryptWebReport(reportPayload, true);
  return webClient.postJson(PATH_DATA_REPORT_WEB, {
    query: {
      type: 104,
      time_: encrypted.timeSec,
      ...extraQuery,
    },
    body: {
      sid: encrypted.sid,
      key: encrypted.key,
      data: encrypted.data,
    },
    retries: 0,
  });
}

async function sendShareEvents(appClient, source, extra = {}) {
  const sessionId = crypto.randomUUID();
  for (const action of ["tap", "success"]) {
    const resp = await appClient.postEncryptedForm(
      PATH_DATA_REPORT,
      buildShareEventReport(action, source, extra),
      { type: "104", session_id: sessionId },
      { baseUrl: DATA_BASE },
    );
    if (!isOkPayload(resp)) {
      throw new Error(`分享 ${action} 上报失败 status=${tools.toText(resp?.status)} msg=${tools.toText(resp?.msg)}`);
    }
    if (action === "tap") await tools.sleep(2000);
  }
}

async function sendWebShareEvent(webClient, action = "visit", source = "/store/roll_room_v2", extra = {}) {
  const timeSec = String(Math.floor(Date.now() / 1000));
  const payload = {
    events: [
      {
        time: timeSec,
        path: `/web_share/${action}`,
        type: "1",
        addition: {
          open_source: source,
          page_identifier: JSON.stringify(extra),
        },
      },
    ],
  };
  const resp = await postWebEncryptedReport(webClient, payload);
  if (!isOkPayload(resp)) {
    throw new Error(`web_share ${action} 上报失败 status=${tools.toText(resp?.status)} msg=${tools.toText(resp?.msg)}`);
  }
  return resp;
}

module.exports = {
  PATH_DATA_REPORT,
  PATH_DATA_REPORT_WEB,
  PATH_SHARE_TAP,
  PATH_SHARE_SUCCESS,
  SHARE_EVENT_PLATFORM,
  buildShareEventReport,
  encryptWebReport,
  postWebEncryptedReport,
  isOkPayload,
  sendShareEvents,
  sendWebShareEvent,
};
