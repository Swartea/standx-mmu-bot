# StandX MMU Bot（挂单 / Uptime 做市脚本）

这是一个用于 StandX 永续合约的简单做市 / uptime 挂单脚本：  
会在标记价（mark price）附近按 **bps（基点）** 方式挂 **多档限价单**，并按周期刷新，尽量让订单保持在你设定的区间内。

> ⚠️ 风险提示：永续合约/挂单都有被成交风险，可能产生亏损。请自行承担风险，先小额测试再加资金。

---

## 功能概览

- 上下两边挂 **多档（ladder）** 限价单（例如每边 2 档）
- **BPS 模式**：按基点偏移围绕 mark 价挂单（可控制在 10bps 内）
- 可选：下单数量 **轻微随机抖动**（在 min/max 区间内）
- 日志输出：`PARAMS / REFRESH / HOLD / missing order` 方便排查

---

## 运行环境要求

- Node.js **18+**（建议 18 或 20 LTS）
- npm（安装 Node 时自带）
- 你在 StandX 有可用余额/保证金，并能正常下单

### 检查是否安装成功
打开终端执行：

```bash
node -v
npm -v
能看到版本号即正常。

安装与部署（从零开始）

1）下载代码
git clone https://github.com/Swartea/standx-mmu-bot.git
cd standx-mmu-bot
（如果你不会 git，也可以直接 GitHub 下载 zip 解压后进入目录）

2）安装依赖
npm install

配置（最关键）

3）生成配置文件 .env

项目提供了模板：.env.example
复制一份出来作为你自己的配置：
cp .env.example .env

4）编辑 .env

用 VSCode 或任意文本编辑器打开 .env，重点修改：
	•	CHAIN=bsc
	•	WALLET_PRIVATE_KEY=你的私钥  （⚠️ 极其重要：不要泄露）
	•	SYMBOL=BTC-USD

✅ 初次建议用小参数测试，避免意外成交造成损失。

启动运行

5）直接运行

node mmu_bot.mjs

正常情况下你会看到类似日志：
	•	PARAMS: {...}
	•	REFRESH(...) mark ... bid ... ask ... levels ... qty_each ...
	•	HOLD(...) ...
	•	以及某些情况下的报错/响应码（用于排查）

推荐参数（新手安全起步）

下面是一个常见思路：
尽量不成交，但让订单保持在 10bps 内（用于 Maker Uptime/Points 的思路之一）。
# qty（每笔下单量）
QTY=0.0001

# BPS 参数（保持在 10bps 内）
TARGET_BPS=9.6
MAX_BPS=9.95
MIN_BPS=0.5

# 每边挂几档（2 表示每边 2 档）
LADDER_LEVELS=2
LADDER_STEP_BPS=0.25

# 刷新周期
LOOP_MS=5000
MIN_REFRESH_MS=45000

# 被吃单/缺单处理（建议新手先用 0：自动补单不中断）
STOP_ON_FILL=0
ORDER_CHECK_MS=5000

# 订单有效类型（按你脚本支持填写）
TIME_IN_FORCE=alo

可选：下单数量随机抖动（不强制）

如果你希望每次下单量在一个范围内轻微变化，可以开启：
QTY_JITTER_PCT=0.15
QTY_MIN=0.0001
QTY_MAX=0.00013

解释：
	•	QTY_JITTER_PCT=0.15 表示在基础 QTY 上 ±15% 波动
	•	同时会被 QTY_MIN ~ QTY_MAX 限制
	•	永远不会低于交易所 min_order_qty

后台常驻运行（强烈建议）

如果你希望脚本在后台持续跑，不要因为关终端就停：

macOS / Linux：使用 pm2（推荐）
npm i -g pm2
pm2 start mmu_bot.mjs --name standx-mmu
pm2 logs standx-mmu
pm2 save

停止运行：
pm2 stop standx-mmu

查看状态：
pm2 list

常见问题（Troubleshooting）

1）为什么我挂单会被吃掉（成交）？
	•	你挂得太近：提高 MIN_BPS，或把 TARGET_BPS 调大一点
	•	下单量太大：减小 QTY
	•	市场波动剧烈：缩小档位数量或增大刷新间隔

2）一直提示缺单 / missing level / fill_or_missing？
	•	如果你想脚本自动补单：把 STOP_ON_FILL=0
	•	如果你更保守，宁愿停机：用 STOP_ON_FILL=1

3）运行报错或无订单
	•	检查 .env 是否正确（尤其私钥、symbol）
	•	确认账户有足够可用保证金
	•	看终端日志里 API 返回码（用于判断是权限/参数/限频等）
