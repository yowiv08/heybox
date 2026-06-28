const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const cacheRoot = path.join(root, "cache");
const tempRoot = path.join(root, "tmp");

function getCachePath(projectName, accountName) {
  return path.join(cacheRoot, projectName, `${accountName}.cache`);
}

module.exports = {
  root,
  cacheRoot,
  tempRoot,
  getCachePath,
};
