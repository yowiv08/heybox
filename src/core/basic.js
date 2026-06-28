const tools = require("./tools");

class BasicAccount {
  constructor(rawData, options = {}) {
    this.raw_data = rawData || "";
    this.index = options.index || 0;
    this.name = options.name || "";
    this.notifyStr = [];
  }

  log(message, options = {}) {
    let prefix = "";
    if (!options.noPrefix) {
      if (this.index) prefix += `账号[${this.index}]`;
      if (this.name) prefix += `[${this.name}]`;
    }
    const text = `${prefix}${message}`;
    if (options.notify) this.notifyStr.push(text);
    tools.log(text, options);
  }
}

module.exports = BasicAccount;
