const API_BASE = "https://api.xiaoheihe.cn";
const DATA_BASE = "https://data.xiaoheihe.cn";
const HKEY_API = "https://hkey.qcciii.com/hkey";

const APP_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36 ApiMaxJia/1.0";
const APP_REFERER = "http://api.maxjia.com/";

const WEB_VERSION = "999.0.4";
const WEB_UA =
  "Mozilla/5.0 (Linux; Android 16; 23113RKC6C Build/BP2A.250605.031.A3; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.192 Mobile Safari/537.36";

const APP_PROFILE = Object.freeze({
  os_type: "Android",
  x_os_type: "Android",
  x_client_type: "mobile",
  os_version: "12",
  dw: "360",
  channel: "heybox",
  x_app: "heybox",
  time_zone: "Asia/Shanghai",
  device_info: "HBP-AL00",
});

const WEB_PROFILE = Object.freeze({
  app: "heybox",
  os_type: "web",
  x_app: "heybox",
  x_client_type: "web",
  x_os_type: "Android",
  x_client_version: "1.3.389",
});

module.exports = {
  API_BASE,
  DATA_BASE,
  HKEY_API,
  APP_UA,
  APP_REFERER,
  WEB_VERSION,
  WEB_UA,
  APP_PROFILE,
  WEB_PROFILE,
  DATA_NAME: "heybox_ck",
  OK_STATE: "ok",
};
