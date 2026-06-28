const fs = require("fs");
const path = require("path");
const paths = require("./paths");
const tools = require("./tools");

class Cache {
  static getCachePath(projectName, key) {
    return paths.getCachePath(projectName, tools.safeFileName(key));
  }

  static read(projectName, key) {
    const file = this.getCachePath(projectName, key);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, "utf8");
  }

  static write(projectName, key, data) {
    const file = this.getCachePath(projectName, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(data), "utf8");
    return true;
  }
}

module.exports = Cache;
