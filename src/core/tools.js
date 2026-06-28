function toText(input) {
  if (input === undefined || input === null) return "";
  return String(input).trim();
}

function splitEnv(value) {
  return toText(value)
    .replace(/\r/g, "\n")
    .split(/[&\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function time(format = "yyyy-MM-dd hh:mm:ss", input = Date.now()) {
  const date = new Date(input);
  return format
    .replace("yyyy", String(date.getFullYear()))
    .replace("MM", pad(date.getMonth() + 1))
    .replace("dd", pad(date.getDate()))
    .replace("hh", pad(date.getHours()))
    .replace("mm", pad(date.getMinutes()))
    .replace("ss", pad(date.getSeconds()))
    .replace("S", pad(date.getMilliseconds(), 3));
}

function log(message, options = {}) {
  const prefix = options.time ? `[${time()}] ` : "";
  console.log(`${prefix}${message}`);
}

function safeFileName(input) {
  return toText(input).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 120) || "default";
}

function mask(input) {
  return toText(input)
    .replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, "$1****$2")
    .replace(/(pkey=)[^;]+/gi, "$1<redacted>")
    .replace(/(x_xhh_tokenid=)[^;]+/gi, "$1<redacted>")
    .replace(/(hkey=)[^&\s]+/gi, "$1<redacted>")
    .replace(/(nonce=)[^&\s]+/gi, "$1<redacted>");
}

module.exports = {
  toText,
  splitEnv,
  sleep,
  time,
  log,
  safeFileName,
  mask,
};
