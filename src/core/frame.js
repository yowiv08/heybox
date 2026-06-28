const path = require("path");
const fs = require("fs");
const tools = require("./tools");

function loadSendNotify() {
  const mainDir = require.main?.filename ? path.dirname(require.main.filename) : process.cwd();
  const candidates = [
    path.join(mainDir, "sendNotify.js"),
    path.join(process.cwd(), "sendNotify.js"),
    path.join(mainDir, "..", "sendNotify.js"),
    path.join(process.cwd(), "..", "sendNotify.js"),
    "/ql/data/scripts/sendNotify.js",
    "/ql/scripts/sendNotify.js",
  ];
  const checked = new Set();
  for (const file of candidates) {
    if (checked.has(file)) continue;
    checked.add(file);
    if (!fs.existsSync(file)) continue;
    const mod = require(file);
    const sendNotify = mod?.sendNotify || mod;
    if (typeof sendNotify === "function") return sendNotify;
  }
  throw new Error("sendNotify.js not found");
}

const $ = {
  ...tools,
  name: "",
  startTime: Date.now(),
  env: {},
  args: [],
  userIdx: 0,
  userList: [],
  userCount: 0,
  notifyFlag: true,
  notifyTitle: "",
  notifyStr: [],

  parse_env() {
    const scriptName = require.main ? path.basename(require.main.filename, ".js") : "";
    if (scriptName) {
      const prefix = `${scriptName}_`;
      for (const key of Object.keys(process.env)) {
        if (key.startsWith(prefix)) this.env[key.slice(prefix.length)] = process.env[key];
      }
    }
    this.args.push(...process.argv.slice(2));
  },

  print_env(detail = false) {
    this.log("-------------------------");
    this.log("读取到的脚本变量:");
    const keys = Object.keys(this.env);
    for (const key of keys) {
      if (!detail && (key === "data" || key.endsWith("_data") || key.includes("ck") || key.includes("token"))) {
        this.log(`${key}: 已隐藏详细信息`);
      } else {
        this.log(`${key}: ${tools.mask(this.env[key])}`);
      }
    }
    this.log("-------------------------");
  },

  async read_env(AccountClass, dataName = null) {
    this.print_env(false);
    const keys = Array.isArray(dataName) ? dataName : [dataName].filter(Boolean);
    const values = [];
    for (const key of keys) values.push(...this.splitEnv(process.env[key]));
    if (this.env.data) values.push(...this.splitEnv(this.env.data));
    if (!values.length && this.args.length) values.push(...this.args);

    for (const value of values) {
      const user = new AccountClass(value);
      user.index = ++this.userIdx;
      this.userList.push(user);
    }
    this.userCount = this.userList.length;
    this.log(`共读取到${this.userCount}个账号`);
    this.log("-------------------------");
    return this.userCount > 0;
  },

  start(script) {
    this.name = script.name || "";
    this.log(`[${this.name}]开始运行\n`, { time: true });
    this.parse_env();
    script
      .run()
      .catch((error) => {
        console.log(error);
        process.exitCode = 1;
      })
      .finally(() => this.exitNow());
  },

  async showmsg() {
    if (!this.notifyFlag) return;
    const list = [];
    list.push(...this.notifyStr.filter(Boolean));
    for (const user of this.userList || []) {
      if (Array.isArray(user.notifyStr)) list.push(...user.notifyStr.filter(Boolean));
    }
    if (!list.length) return;
    try {
      const sendNotify = loadSendNotify();
      await sendNotify(tools.mask(this.notifyTitle || `${this.name}通知`), list.map(tools.mask).join("\n"));
      this.log(`通知已发送: ${list.length}条`);
    } catch (error) {
      this.log(`通知发送失败: ${error.message}`);
    }
  },

  async exitNow() {
    const consumeTime = (Date.now() - this.startTime) / 1000;
    this.log(`\n[${this.name}]运行结束，共运行了${consumeTime}秒`, { time: true });
    await this.showmsg();
  },
};

module.exports = $;
