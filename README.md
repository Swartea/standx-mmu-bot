# StandX MMU Bot（挂单 / Uptime 做市脚本）

用于 StandX 永续合约的简单做市/挂单脚本：会在标记价附近按 bps 或固定美元价差挂多档限价单，并按周期刷新。

> ⚠️ 风险提示：永续合约/挂单存在被成交风险，可能产生亏损，请自行承担风险，先小额测试。

## Quick Start
```bash
git clone https://github.com/Swartea/standx-mmu-bot.git
cd standx-mmu-bot
npm install
# 配置 .env 后生成 ed25519 key
node gen_edkey.mjs
node mmu_bot.mjs
```

## 必需 .env
```
WALLET_PRIVATE_KEY=0x...
```

## 常用可选配置
```
CHAIN=bsc
SYMBOL=BTC-USD
QTY_WANT=0.0001
TIME_IN_FORCE=alo
LOOP_MS=15000
STOP_ON_FILL=1
```

## 做市参数（BPS 模式）
```
TARGET_BPS=9
MAX_BPS=9.2
MIN_BPS=4.5
LADDER_LEVELS=1
LADDER_STEP_BPS=0.25
MIN_REFRESH_MS=20000
```

## 固定美元价差模式
```
ABS_SPREAD_USD=1000
ABS_MIN_USD=300
ABS_MAX_USD=1500
```

## 其他说明
- 需要 `standx_ed25519.json`（运行 `node gen_edkey.mjs` 生成）。
- `QTY` 仍可用，但推荐用 `QTY_WANT`。
- 日志会输出 `PARAMS / REFRESH / HOLD` 便于排查。

## 后台运行（可选）
```bash
npm i -g pm2
pm2 start mmu_bot.mjs --name standx-mmu
pm2 logs standx-mmu
```
