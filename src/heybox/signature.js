const crypto = require("crypto");
const { URLSearchParams } = require("url");

function md5(input) {
  return crypto.createHash("md5").update(String(input)).digest("hex");
}

function makeNonce(length = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += chars[bytes[index] % chars.length];
  }
  return out;
}

function makeWebNonce() {
  return md5(`${Date.now()}${Math.random()}${crypto.randomBytes(8).toString("hex")}`).toUpperCase();
}

function buildQueryString(source) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function mul2(value) {
  return 128 & value ? 255 & ((value << 1) ^ 27) : value << 1;
}

function mixX(value) {
  return mul2(value) ^ value;
}

function mixK(value) {
  return mixX(mul2(value));
}

function mixC(value) {
  return mixK(mixX(mul2(value)));
}

function mixS(value) {
  return mixC(value) ^ mixK(value) ^ mixX(value);
}

function mixArray(input) {
  const output = [0, 0, 0, 0];
  output[0] = mixS(input[0]) ^ mixC(input[1]) ^ mixK(input[2]) ^ mixX(input[3]);
  output[1] = mixX(input[0]) ^ mixS(input[1]) ^ mixC(input[2]) ^ mixK(input[3]);
  output[2] = mixK(input[0]) ^ mixX(input[1]) ^ mixS(input[2]) ^ mixC(input[3]);
  output[3] = mixC(input[0]) ^ mixK(input[1]) ^ mixX(input[2]) ^ mixS(input[3]);
  input[0] = output[0];
  input[1] = output[1];
  input[2] = output[2];
  input[3] = output[3];
  return input;
}

function remapByAlphabet(input, alphabet, endOffset) {
  let output = "";
  const base = alphabet.slice(0, endOffset);
  for (let index = 0; index < input.length; index += 1) {
    output += base[input.charCodeAt(index) % base.length];
  }
  return output;
}

function remapFull(input, alphabet) {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    output += alphabet[input.charCodeAt(index) % alphabet.length];
  }
  return output;
}

function interleave(parts) {
  let output = "";
  const maxLength = Math.max(...parts.map((part) => part.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const part of parts) {
      if (index < part.length) output += part[index];
    }
  }
  return output;
}

function normalizePath(path) {
  return `/${String(path).split("/").filter(Boolean).join("/")}/`;
}

function makeWebHkey(path, timeSec, nonce) {
  const alphabet = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
  const timePart = remapByAlphabet(String(timeSec), alphabet, -2);
  const pathPart = remapFull(normalizePath(path), alphabet);
  const noncePart = remapFull(nonce, alphabet);
  const mixed = interleave([timePart, pathPart, noncePart]).slice(0, 20);
  const digest = md5(mixed);
  let suffix = String(
    mixArray(digest.slice(-6).split("").map((char) => char.charCodeAt(0))).reduce(
      (sum, value) => sum + value,
      0,
    ) % 100,
  );
  if (suffix.length < 2) suffix = `0${suffix}`;
  return `${remapByAlphabet(digest.substring(0, 5), alphabet, -4)}${suffix}`;
}

function makeWebSignature(path, version, timeSec = Math.floor(Date.now() / 1000), nonce = makeWebNonce()) {
  return {
    version,
    hkey: makeWebHkey(path, timeSec + 1, nonce),
    _time: String(timeSec),
    nonce,
  };
}

module.exports = {
  md5,
  makeNonce,
  makeWebNonce,
  buildQueryString,
  makeWebHkey,
  makeWebSignature,
};
