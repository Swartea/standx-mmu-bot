# StandX MMU Bot（永续挂单 / Uptime 做市）

基于标记价在买卖两侧挂限价单，按周期刷新，适用于 Maker Uptime。  
支持 BPS 模式与波动过大自动暂停。

> ⚠️ 风险提示：挂单/永续合约可能成交并产生亏损，请先小额测试。

## 功能概览
- 双边限价挂单（可多档）
- BPS 价差
- 订单缺档检查与自动刷新
- 波动过大自动暂停（可选）

## 运行环境
- Node.js 18+（建议 20 LTS）
- npm（随 Node 一起安装）
- StandX 账户 + 私钥

## macOS 快速部署（从 0 开始）

1) 安装 Node.js（LTS）  
下载：https://nodejs.org  
验证：
```bash
node -v
npm -v
```

2) 下载项目
```bash
git clone https://github.com/Swartea/standx-mmu-bot.git
cd standx-mmu-bot
```
不使用 Git 也可以下载 zip 解压后进入目录。

3) 安装依赖
```bash
npm install
```

4) 配置 `.env`
```bash
cp .env.example .env
```
打开 `.env`，只需填写：
```
WALLET_PRIVATE_KEY=0x你的私钥
```

5) 生成签名 Key（必做）
```bash
node gen_edkey.mjs
```
会生成 `standx_ed25519.json`（已被 `.gitignore` 忽略，请勿分享）。

6) 启动脚本
```bash
node mmu_bot.mjs
```
看到 `PARAMS / REFRESH / HOLD` 等日志即运行成功。按 `Ctrl + C` 退出。

## Windows 快速部署（从 0 开始）

1) 安装 Node.js（LTS）  
下载：https://nodejs.org  
验证（PowerShell）：
```powershell
node -v
npm -v
```

2) 下载项目
```powershell
git clone https://github.com/Swartea/standx-mmu-bot.git
cd standx-mmu-bot
```
不使用 Git 也可以下载 zip 解压后进入目录。

3) 安装依赖
```powershell
npm install
```

4) 配置 `.env`
```powershell
Copy-Item .env.example .env
```
打开 `.env`，只需填写：
```
WALLET_PRIVATE_KEY=0x你的私钥
```

5) 生成签名 Key（必做）
```powershell
node gen_edkey.mjs
```
会生成 `standx_ed25519.json`（已被 `.gitignore` 忽略，请勿分享）。

6) 启动脚本
```powershell
node mmu_bot.mjs
```
看到 `PARAMS / REFRESH / HOLD` 等日志即运行成功。按 `Ctrl + C` 退出。

## 配置说明（简版）
必填：
```
WALLET_PRIVATE_KEY=0x你的私钥
```
常用参数（可选）：
```
CHAIN=bsc
SYMBOL=BTC-USD
QTY_WANT=0.0001
TIME_IN_FORCE=alo
LOOP_MS=15000
STOP_ON_FILL=1
```

## 进阶参数（按需）
### BPS 模式
```
TARGET_BPS=9
MAX_BPS=9.2
MIN_BPS=4.5
LADDER_LEVELS=1
LADDER_STEP_BPS=0.25
```

### 波动过大自动暂停
```
VOL_PAUSE_BPS=30
VOL_RESUME_BPS=15
VOL_PAUSE_MS=60000
VOL_STABLE_TICKS=2
VOL_CANCEL_ON_PAUSE=1
```
说明：
- 触发条件是“相邻两次 mark 价格的变动幅度”，达到 `VOL_PAUSE_BPS` 就暂停
- 暂停持续 `VOL_PAUSE_MS`，期间不挂单；若波动继续变大会延长暂停
- 价格回到 `VOL_RESUME_BPS` 以下且连续 `VOL_STABLE_TICKS` 次后恢复挂单
- `VOL_CANCEL_ON_PAUSE=1` 会在暂停时撤掉当前 MMU 订单，恢复时重新挂

## 常见错误
- `standx_ed25519.json not found`：先运行 `node gen_edkey.mjs`
- `Missing WALLET_PRIVATE_KEY`：检查 `.env` 是否存在并填写私钥
