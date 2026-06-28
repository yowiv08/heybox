const { BasicAccount } = require("../core");
const { APP_PROFILE } = require("./constants");
const {
  buildAppCookie,
  buildWebCookie,
  decodePkeyToUserId,
  makeImei,
} = require("./cookie");

class HeyboxAccount extends BasicAccount {
  constructor(rawData) {
    super(rawData);
    const heyboxId = decodePkeyToUserId(rawData);
    if (!heyboxId) throw new Error("无法从pkey解析heybox_id");
    this.heyboxId = heyboxId;
    this.name = heyboxId;
    this.imei = makeImei(rawData);
    this.deviceInfo = APP_PROFILE.device_info;
    this.appCookie = buildAppCookie(rawData);
    this.webCookie = buildWebCookie(rawData, heyboxId);
  }
}

module.exports = {
  HeyboxAccount,
};
