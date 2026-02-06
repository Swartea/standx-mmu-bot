# StandX MMU Bot（挂单 / Uptime 做市脚本）

围绕标记价在两侧挂限价单，按周期刷新。适合新手做 Maker Uptime。

> ⚠️ 风险提示：挂单/永续合约可能成交并产生亏损，请先小额测试。

## macOS 从 0 开始

### 1) 安装 Node.js
从 https://nodejs.org 下载 LTS 版本并安装。  
验证：
```bash
node -v
npm -v
```

### 2) 下载项目
```bash
git clone https://github.com/Swartea/standx-mmu-bot.git
cd standx-mmu-bot
```
不会 Git 也可以在 GitHub 下载 zip 解压后进入目录。

### 3) 安装依赖
```bash
npm install
```

### 4) 创建 .env
在项目根目录新建 `.env`。  
最少必需项只有一行（下面“进阶参数”在后面说明）：
```
WALLET_PRIVATE_KEY=0x你的私钥
```
也可以直接复制示例文件并修改：
```bash
cp .env.example .env
```
然后把 `WALLET_PRIVATE_KEY` 改成你的私钥。

### 5) 生成签名 Key（必做）
```bash
node gen_edkey.mjs
```
会生成 `standx_ed25519.json`（已被 `.gitignore` 忽略，请勿分享）。

### 6) 启动脚本
```bash
node mmu_bot.mjs
```
看到 `PARAMS / REFRESH / HOLD` 等日志即正常运行。按 `Ctrl + C` 退出。

## Windows 从 0 开始

### 1) 安装 Node.js
从 https://nodejs.org 下载 LTS 版本并安装。  
在 PowerShell 里验证：
```powershell
node -v
npm -v
```

### 2) 下载项目
如果已安装 Git：
```powershell
git clone https://github.com/Swartea/standx-mmu-bot.git
cd standx-mmu-bot
```
不想装 Git 也可以直接下载 zip 解压后进入目录。

### 3) 安装依赖
```powershell
npm install
```

### 4) 创建 .env
用记事本在项目根目录新建 `.env`。  
最少必需项只有一行（下面“进阶参数”在后面说明）：
```
WALLET_PRIVATE_KEY=0x你的私钥
```
也可以复制示例文件 `.env.example` 然后修改 `WALLET_PRIVATE_KEY`。

### 5) 生成签名 Key（必做）
```powershell
node gen_edkey.mjs
```
会生成 `standx_ed25519.json`（已被 `.gitignore` 忽略，请勿分享）。

### 6) 启动脚本
```powershell
node mmu_bot.mjs
```
看到 `PARAMS / REFRESH / HOLD` 等日志即正常运行。按 `Ctrl + C` 退出。

## 进阶参数（按需使用）
下面是常用的可选参数，你可以从 `.env.example` 里按需复制到 `.env`：
```
CHAIN=bsc
SYMBOL=BTC-USD
QTY_WANT=0.0001
TIME_IN_FORCE=alo
LOOP_MS=15000
STOP_ON_FILL=1
```

### 风控参数示例
```
MIN_BPS=4.5
MAX_BPS=9.2
TARGET_BPS=9
```

### 波动过大自动暂停（可选）
```
VOL_PAUSE_BPS=30
VOL_RESUME_BPS=15
VOL_PAUSE_MS=60000
VOL_STABLE_TICKS=2
VOL_CANCEL_ON_PAUSE=1
```

## 常见报错
- `standx_ed25519.json not found`：先运行 `node gen_edkey.mjs`
- `Missing WALLET_PRIVATE_KEY`：检查 `.env` 是否存在并填写私钥
