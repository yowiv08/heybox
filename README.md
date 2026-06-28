# heybox

小黑盒自动化脚本集合，基于 Node.js 实现，支持小黑盒每日任务、普通领券、定时抢券、0 元抽奖盒券等功能。

> 仅供学习交流使用。请自行承担使用风险，并遵守小黑盒平台规则。Cookie 属于敏感信息，请勿泄露给他人或提交到公开仓库。

## 功能概览

| 脚本                | 功能                                | npm script             |
| ----------------- | --------------------------------- | ---------------------- |
| `heybox_sign.js`  | 每日签到、每日分享任务、H 币信息输出               | `npm run heybox_sign`  |
| `heybox_claim.js` | 普通游戏优惠券自动领取                       | `npm run heybox_claim` |
| `heybox_rush.js`  | 限时券/抢券任务，支持自动发现目标、定时窗口、多轮并发请求     | `npm run heybox_rush`  |
| `heybox_roll.js`  | 0 元抽奖盒券任务，支持活动发现、前置任务处理、参与抽奖、分享任务 | `npm run heybox_roll`  |

## 已支持任务

### 每日任务：`heybox_sign.js`

支持自动完成：

| 任务          | 处理方式                 |
| ----------- | -------------------- |
| 签到          | 请求签到接口，并回查签到状态与奖励    |
| 分享任意帖子到社交平台 | 拉取帖子流，模拟浏览时长，上报分享事件  |
| 分享游戏详情到社交平台 | 拉取推荐游戏，发送游戏详情分享事件    |
| 分享游戏评价到社交平台 | 拉取推荐游戏和评论，发送游戏评价分享事件 |

其他能力：

* 自动读取单账号或多账号 Cookie
* 从 `pkey` 中解析 `heybox_id`
* 根据 `pkey` 生成请求所需 `imei`
* 通过 hkey 服务生成小黑盒 App 接口签名参数
* 自动跳过已完成任务
* 对未支持任务输出提示
* 输出当前账号 H 币数量
* 根据任务完成情况返回退出码

### 普通领券：`heybox_claim.js`

支持自动完成：

* 拉取普通游戏券列表
* 筛选可领取、未领取、未受限的券
* 自动刷新领取所需 session
* 逐个领取可领取优惠券
* 登录态失效时停止当前账号任务

### 定时抢券：`heybox_rush.js`

支持自动完成：

* 自动发现当前限时/特殊优惠券目标
* 支持配置指定抢券目标
* 从券标签中解析开抢时间
* 支持统一指定抢券时间
* 开抢前预热 session
* 在开抢窗口内多轮请求
* 支持多账号并发、单账号内多目标并发
* 自动跳过已抢光、已结束、已领取、库存不足等终态目标

默认抢券参数：

| 参数               | 默认值    | 说明                  |
| ---------------- | ------ | ------------------- |
| `prewarmMs`      | `1500` | 开抢前 1.5 秒刷新 session |
| `windowBeforeMs` | `300`  | 开抢前 0.3 秒进入请求窗口     |
| `windowAfterMs`  | `5000` | 开抢后持续请求 5 秒         |
| `intervalMs`     | `250`  | 请求轮次间隔              |
| `maxRounds`      | `20`   | 最大请求轮数              |
| `parallel`       | `6`    | 单轮最大并发数             |

### 0 元抽奖盒券：`heybox_roll.js`

支持自动完成：

* 自动发现 0 元抽奖活动
* 拉取活动详情和盒券列表
* 自动处理部分前置任务
* 自动参与抽奖
* 自动完成分享活动任务
* 输出活动任务状态和盒券状态

当前前置任务支持情况：

| 任务类型                  | 支持情况       |
| --------------------- | ---------- |
| `inject_js_for_count` | 支持，模拟停留后回查 |
| `focus_on_homeowner`  | 支持，直接上报    |
| `share_act`           | 支持，参与后执行分享 |
| `add_to_wish_list`    | 暂不支持，自动跳过  |
| `follow_game`         | 暂不支持，自动跳过  |
| 其他未知任务                | 输出提示，不自动处理 |

## 运行环境

* Node.js
* npm
* 依赖包：`got`

安装依赖：

```bash
npm install
```

单独安装依赖：

```bash
npm install got@^11.8.6
```

## 环境变量

所有脚本共用一个环境变量：

```bash
heybox_ck
```

值需要包含：

```bash
pkey=xxx;x_xhh_tokenid=xxx;
```

### 单账号示例

```bash
export heybox_ck='pkey=xxx;x_xhh_tokenid=xxx;'
```

### 多账号示例

支持换行分隔：

```bash
pkey=账号1;x_xhh_tokenid=账号1;
pkey=账号2;x_xhh_tokenid=账号2;
```

也支持使用 `&` 分隔：

```bash
pkey=账号1;x_xhh_tokenid=账号1;&pkey=账号2;x_xhh_tokenid=账号2;
```

## 本地运行

每日任务：

```bash
node heybox_sign.js
```

普通领券：

```bash
node heybox_claim.js
```

定时抢券：

```bash
node heybox_rush.js
```

0 元抽奖盒券：

```bash
node heybox_roll.js
```

也可以使用 npm scripts：

```bash
npm run heybox_sign
npm run heybox_claim
npm run heybox_rush
npm run heybox_roll
```

## 青龙面板使用

拉取仓库后，在青龙环境变量中添加：

| 名称          | 值                             |
| ----------- | ----------------------------- |
| `heybox_ck` | `pkey=xxx;x_xhh_tokenid=xxx;` |

建议定时任务：

```bash
task heybox_sign.js
task heybox_claim.js
task heybox_roll.js
```

`heybox_rush.js` 属于定时抢券脚本，建议根据券的开抢时间单独配置定时任务，不建议只按固定每日任务运行。

## 输出说明

每日任务输出示例：

```text
当前版本: 1.3.xxx build=xxxx

========== 账号1 ==========
账号=昵称 黑盒ID=123456 IMEI=xxxxxxxxxxxxxxxx
签到: 已完成 (+20经验 +20H币 +1盒电)
分享任意帖子到社交平台: 已完成
当前总H币: 123

完成: 1/1
```

普通领券输出示例：

```text
开始领券 heybox_id=123456
Claim targets: 10001, 10002
item_id=10001 游戏名: OK success
```

抢券输出示例：

```text
抢券计划:
 时间: 2026-01-01 12:00:00.0 (1张券)
 - ￥10 优惠券 pool=xxx act=xxx
 刷新session: 2026-01-01 11:59:58.5
 请求窗口: 2026-01-01 11:59:59.7 -> 2026-01-01 12:00:05.0
 间隔: 250ms, 轮数: 20, 并发: 1
```

抽奖盒券输出示例：

```text
抽奖活动 award_id=xxx 活动名
参与抽奖: {"status":"ok",...}
分享活动: 已完成
未自动处理任务: add_to_wish_list
```

## 退出码

`heybox_sign.js` 会根据每日任务完成情况设置退出码：

| 退出码 | 说明                   |
| --- | -------------------- |
| `0` | 所有账号核心任务均完成          |
| `1` | 存在账号任务未完成、初始化失败或脚本异常 |

其他脚本在异常时可能设置非 0 退出码，具体以运行日志为准。

## 常见问题

### 初始化失败：缺少环境变量 heybox_ck

没有配置 `heybox_ck`，或当前运行环境没有读取到该变量。请检查变量名是否为小写：

```bash
heybox_ck
```

### 无法从 pkey 解析 heybox_id

通常是 `pkey` 不完整、已过期或格式不正确。请重新抓取小黑盒 Cookie。

### hkey 接口失败

可能是外部 hkey 服务不可用、网络异常，或接口返回参数异常。可以稍后重试，或检查当前运行环境网络。

### 任务执行后仍显示未完成

可能原因：

* 小黑盒接口延迟结算
* Cookie 已失效
* 小黑盒任务规则发生变化
* 当前任务不在脚本支持范围内
* 某些任务需要 App 原生行为，脚本无法完全模拟

### 抽奖盒券提示心愿单任务不支持

`add_to_wish_list`、`follow_game` 等心愿单相关任务目前不会自动完成，脚本会跳过并输出提示。

### 抢券没有找到目标

可能原因：

* 当前没有可抢的限时券
* 券已结束、已抢光或已领取
* 接口返回结构发生变化
* 需要手动配置 `targets`

## 安全提示

* 不要把真实 Cookie 写进 README、Issue、日志截图或公开仓库
* 不要把 `heybox_ck` 提交到 Git
* Cookie 失效后请重新抓取
* 多账号运行时请确认每个账号格式完整

## 项目结构

```text
.
├── heybox_sign.js    # 每日签到与每日分享任务
├── heybox_claim.js   # 普通领券
├── heybox_rush.js    # 定时抢券
├── heybox_roll.js    # 0 元抽奖盒券
├── package.json
├── package-lock.json
└── src/
    ├── core/         # 通用运行框架、HTTP、工具函数
    └── heybox/       # 小黑盒账号、接口、签名、上报等封装
```
