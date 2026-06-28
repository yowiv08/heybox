const { HttpClient, tools } = require("../core");
const {
  API_BASE,
  APP_PROFILE,
  APP_REFERER,
  APP_UA,
  DATA_BASE,
  HKEY_API,
  WEB_PROFILE,
  WEB_UA,
  WEB_VERSION,
  OK_STATE,
} = require("./constants");
const {
  buildQueryString,
  makeNonce,
  makeWebSignature,
} = require("./signature");

class HeyboxAppClient extends HttpClient {
  constructor(account, options = {}) {
    super({ timeoutMs: options.timeoutMs || 15000, retries: options.retries || 0 });
    this.account = account;
    this.runtime = options.runtime || { version: "", build: "" };
  }

  appHeaders(extra = {}) {
    return {
      "User-Agent": APP_UA,
      Referer: APP_REFERER,
      Cookie: this.account.appCookie,
      Accept: "application/json",
      ...extra,
    };
  }

  async requestHkey(path, timeSec = Math.floor(Date.now() / 1000)) {
    const query = buildQueryString({
      mode: "request",
      path,
      time: String(timeSec),
      imei: this.account.imei,
      heybox_id: this.account.heyboxId,
    });
    const response = await this.get({
      url: `${HKEY_API}?${query}`,
      headers: { "User-Agent": APP_UA, Accept: "application/json" },
    });
    const data = response.result;
    const status = tools.toText(data?.status);
    if (status && status !== OK_STATE) {
      throw new Error(`hkey接口失败 status=${status} msg=${tools.toText(data?.msg) || "无"}`);
    }
    const result = data?.result && typeof data.result === "object" ? data.result : data;
    const hkey = tools.toText(result?.hkey);
    const version = tools.toText(result?.version);
    const build = tools.toText(result?.build);
    if (!hkey) throw new Error("hkey接口未返回hkey");
    if (!version) throw new Error("hkey接口未返回version");
    if (!/^\d+$/.test(build)) throw new Error("hkey接口未返回有效build");
    return { hkey, version, build, time: String(timeSec) };
  }

  buildSignedQuery(path, hkeyResult, extraQuery = {}) {
    this.runtime.version = hkeyResult.version || this.runtime.version;
    this.runtime.build = hkeyResult.build || this.runtime.build;
    return {
      heybox_id: this.account.heyboxId,
      imei: this.account.imei,
      device_info: this.account.deviceInfo,
      nonce: makeNonce(),
      hkey: hkeyResult.hkey,
      os_type: APP_PROFILE.os_type,
      x_os_type: APP_PROFILE.x_os_type,
      x_client_type: APP_PROFILE.x_client_type,
      os_version: APP_PROFILE.os_version,
      version: this.runtime.version,
      build: this.runtime.build,
      _time: String(hkeyResult.time),
      dw: APP_PROFILE.dw,
      channel: APP_PROFILE.channel,
      x_app: APP_PROFILE.x_app,
      time_zone: APP_PROFILE.time_zone,
      ...extraQuery,
    };
  }

  async getJson(path, extraQuery = {}, options = {}) {
    const timeSec = Math.floor(Date.now() / 1000);
    const hk = await this.requestHkey(path, timeSec);
    const query = buildQueryString(this.buildSignedQuery(path, hk, extraQuery));
    const response = await this.get({
      url: `${options.baseUrl || API_BASE}${path}?${query}`,
      headers: this.appHeaders(options.headers),
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return response.result;
  }

  async postJson(path, extraQuery = {}, bodyData = undefined, options = {}) {
    const timeSec = Math.floor(Date.now() / 1000);
    const hk = await this.requestHkey(path, timeSec);
    const query = buildQueryString(this.buildSignedQuery(path, hk, extraQuery));
    const body = bodyData ? buildQueryString(bodyData) : undefined;
    const response = await this.post({
      url: `${options.baseUrl || API_BASE}${path}?${query}`,
      headers: this.appHeaders({
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(options.headers || {}),
      }),
      body,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return response.result;
  }

  async postEncryptedForm(path, textPayload, extraQuery = {}, options = {}) {
    const timeSec = String(Math.floor(Date.now() / 1000));
    const hkeyResponse = await this.post({
      url: HKEY_API,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "report",
        path,
        text: textPayload,
        time: timeSec,
        imei: this.account.imei,
        heybox_id: this.account.heyboxId,
      }),
    });
    const rp = hkeyResponse.result?.result || {};
    if (rp.version) this.runtime.version = rp.version;
    if (rp.build) this.runtime.build = rp.build;
    const query = buildQueryString(this.buildSignedQuery(path, {
      hkey: rp.hkey,
      version: this.runtime.version,
      build: this.runtime.build,
      time: rp.time,
    }, { time_: rp.time, ...extraQuery }));
    const body = buildQueryString({ data: rp.data, key: rp.key, sid: rp.sid });
    const response = await this.post({
      url: `${options.baseUrl || DATA_BASE}${path}?${query}`,
      headers: this.appHeaders({ "Content-Type": "application/x-www-form-urlencoded", ...(options.headers || {}) }),
      body,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return response.result;
  }
}

class HeyboxWebClient extends HttpClient {
  constructor(account, options = {}) {
    super({ timeoutMs: options.timeoutMs || 15000, retries: Number.isInteger(options.retries) ? options.retries : 1 });
    this.account = account;
    this.version = options.version || WEB_VERSION;
    this.clientVersion = options.clientVersion || WEB_PROFILE.x_client_version;
  }

  headers(hasBody = false, extra = {}) {
    const headers = {
      "User-Agent": WEB_UA,
      Accept: "application/json, text/plain, */*",
      Origin: "https://web.xiaoheihe.cn",
      "X-Requested-With": "com.max.xiaoheihe",
      Referer: "https://web.xiaoheihe.cn/",
      Cookie: this.account.webCookie,
      ...extra,
    };
    if (hasBody) headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
    return headers;
  }

  buildQuery(path, query = {}) {
    return {
      ...WEB_PROFILE,
      x_client_version: this.clientVersion,
      heybox_id: this.account.heyboxId,
      ...makeWebSignature(path, this.version),
      ...query,
    };
  }

  async getJson(path, options = {}) {
    const query = buildQueryString(this.buildQuery(path, options.query));
    const response = await this.get({
      url: `${options.baseUrl || API_BASE}${path}?${query}`,
      headers: this.headers(false, options.headers),
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return response.result;
  }

  async postJson(path, options = {}) {
    const query = buildQueryString(this.buildQuery(path, options.query));
    const body = options.body ? buildQueryString(options.body) : undefined;
    const response = await this.post({
      url: `${options.baseUrl || API_BASE}${path}?${query}`,
      headers: this.headers(Boolean(body), options.headers),
      body,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    return response.result;
  }
}

module.exports = {
  HeyboxAppClient,
  HeyboxWebClient,
};
