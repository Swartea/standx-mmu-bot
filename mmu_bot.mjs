import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "node:fs";
import crypto from "node:crypto";
import axios from "axios";
import { ethers } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";

const API_BASE = "https://api.standx.com/v1/offchain";
const PERPS_BASE = "https://perps.standx.com";

const CHAIN = process.env.CHAIN || "bsc";
const SYMBOL = process.env.SYMBOL || "BTC-USD";

const QTY_WANT = String(process.env.QTY || "0.0001");
// 可选：下单数量随机抖动（用于仓位/风险分散）
const QTY_JITTER_PCT = Number(process.env.QTY_JITTER_PCT || "0"); // 0=关闭；例如 0.15 表示 ±15%
const QTY_MIN_WANT = String(process.env.QTY_MIN || ""); // 例如 0.0001
const QTY_MAX_WANT = String(process.env.QTY_MAX || ""); // 例如 0.00013
const OFFSET_BPS = Number(process.env.OFFSET_BPS || "9");
const UPDATE_THRESHOLD_BPS = Number(process.env.UPDATE_THRESHOLD_BPS || "1");
const LOOP_MS = Number(process.env.LOOP_MS || "15000");
const TIF = process.env.TIME_IN_FORCE || "alo";

// 波动容忍（回差/死区）：只要订单仍在 MAX_BPS 内就不频繁撤挂；超出才刷新回 TARGET_BPS
const TARGET_BPS = Number(process.env.TARGET_BPS || String(OFFSET_BPS));
const MAX_BPS = Number(process.env.MAX_BPS || "9.2");
const MIN_BPS = Number(process.env.MIN_BPS || "4.5"); // 太贴近(<=几bps)更容易被吃单；低于该值就主动刷新拉开距离
const MIN_REFRESH_MS = Number(process.env.MIN_REFRESH_MS || "20000");
// 多档挂单：上下各 N 个限价单。默认 1（只挂一买一卖）
const LADDER_LEVELS = Math.max(1, Number(process.env.LADDER_LEVELS || "1"));
// BPS 模式：每一档在 TARGET_BPS 基础上向外增加的间隔（bps）
const LADDER_STEP_BPS = Number(process.env.LADDER_STEP_BPS || "0.25");

// 绝对美元价差模式：如果 ABS_SPREAD_USD>0，则优先使用“±美元”而不是 bps
const ABS_SPREAD_USD = Number(process.env.ABS_SPREAD_USD || "0"); // 例如 1000 表示 bid=mark-1000, ask=mark+1000
const ABS_MIN_USD = Number(process.env.ABS_MIN_USD || (ABS_SPREAD_USD > 0 ? String(Math.max(ABS_SPREAD_USD * 0.3, 50)) : "0"));
const ABS_MAX_USD = Number(process.env.ABS_MAX_USD || (ABS_SPREAD_USD > 0 ? String(Math.max(ABS_SPREAD_USD * 1.5, ABS_SPREAD_USD + 50)) : "0"));

// 订单存活检查与被吃单处理
const ORDER_CHECK_MS = Number(process.env.ORDER_CHECK_MS || "15000");
const STOP_ON_FILL = String(process.env.STOP_ON_FILL || "1") === "1"; // 1=被吃单就停机并撤单

// 给下单/撤单都带一个 session id（有些接口/风控会依赖它）
const SESSION_ID = process.env.SESSION_ID || crypto.randomUUID();

const PRIV = process.env.WALLET_PRIVATE_KEY;
if (!PRIV || !PRIV.startsWith("0x")) throw new Error("Missing WALLET_PRIVATE_KEY in .env");

function parseJwtPayload(jwt) {
  const base64Url = jwt.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
}

function loadEdKey() {
  const path = "./standx_ed25519.json";
  if (!fs.existsSync(path)) throw new Error("standx_ed25519.json not found. Run: node gen_edkey.mjs");
  const j = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!j.priv_b64 || !j.requestId) throw new Error("standx_ed25519.json missing priv_b64/requestId. Re-run: node gen_edkey.mjs");
  return { edPriv: Buffer.from(j.priv_b64, "base64"), requestId: j.requestId };
}

// message = "{version},{id},{timestamp},{payload}" ed25519签名(base64)
function signBody(edPriv, payloadStr) {
  const version = "v1";
  const xRequestId = crypto.randomUUID();
  const ts = Date.now();
  const msg = `${version},${xRequestId},${ts},${payloadStr}`;
  const sig = ed25519.sign(Buffer.from(msg, "utf8"), edPriv);
  return {
    "x-request-sign-version": version,
    "x-request-id": xRequestId,
    "x-request-timestamp": String(ts),
    "x-request-signature": Buffer.from(sig).toString("base64"),
  };
}

function roundByDecimals(x, decimals, mode) {
  const p = 10 ** decimals;
  const v = x * p;
  const r = mode === "up" ? Math.ceil(v) : Math.floor(v);
  return r / p;
}

function pickQtyEach({ qtyBase, minQty, qtyDec, jitterPct, qtyMin, qtyMax }) {
  let q = qtyBase;

  if (Number.isFinite(jitterPct) && jitterPct > 0) {
    const u = (Math.random() * 2 - 1); // [-1, 1]
    q = qtyBase * (1 + u * jitterPct);
  }

  if (Number.isFinite(qtyMin)) q = Math.max(q, qtyMin);
  if (Number.isFinite(qtyMax)) q = Math.min(q, qtyMax);

  // 不能低于交易所最小下单量
  q = Math.max(q, minQty);

  // 按精度向下取整，避免精度导致下单失败
  q = roundByDecimals(q, qtyDec, "down");

  if (!Number.isFinite(q) || q <= 0) q = minQty;
  return q;
}

function bpsDiff(a, b) {
  const mid = (a + b) / 2;
  if (mid === 0) return 0;
  return (Math.abs(a - b) / mid) * 10000;
}

function bidBpsFromMark(mark, bidPrice) {
  // bid 在 mark 下方： (mark - bid)/mark * 10000
  return ((mark - bidPrice) / mark) * 10000;
}

function askBpsFromMark(mark, askPrice) {
  // ask 在 mark 上方： (ask - mark)/mark * 10000
  return ((askPrice - mark) / mark) * 10000;
}

function bidUsdFromMark(mark, bidPrice) {
  return mark - bidPrice;
}

function askUsdFromMark(mark, askPrice) {
  return askPrice - mark;
}

function normalizeSide(o) {
  const s = String(o?.side ?? o?.order_side ?? o?.direction ?? "").toLowerCase();
  if (s.includes("buy") || s === "bid") return "buy";
  if (s.includes("sell") || s === "ask") return "sell";
  return "";
}

async function getSymbolInfo() {
  const r = await axios.get(`${PERPS_BASE}/api/query_symbol_info`, { params: { symbol: SYMBOL } });
  const s = Array.isArray(r.data) ? r.data.find(x => x.symbol === SYMBOL) : null;
  if (!s) throw new Error("query_symbol_info unexpected: " + JSON.stringify(r.data).slice(0, 200));
  return s;
}

async function getMarkPrice() {
  const r = await axios.get(`${PERPS_BASE}/api/query_symbol_price`, { params: { symbol: SYMBOL } });
  const mp = r.data?.mark_price ?? r.data?.index_price;
  const mark = Number(mp);
  if (!Number.isFinite(mark) || mark <= 0) throw new Error("bad mark price: " + JSON.stringify(r.data));
  return mark;
}

async function authToken({ requestId }) {
  // 你如果自己抓到了 token，也可以放 .env：STANDX_TOKEN=xxxx
  if (process.env.STANDX_TOKEN) return process.env.STANDX_TOKEN;

  const wallet = new ethers.Wallet(PRIV);

  const prep = await axios.post(
    `${API_BASE}/prepare-signin?chain=${CHAIN}`,
    { address: wallet.address, requestId },
    { headers: { "Content-Type": "application/json" } }
  );

  const signedData = prep.data?.signedData || prep.data?.data?.signedData;
  if (!signedData) throw new Error("prepare-signin failed: " + JSON.stringify(prep.data).slice(0, 300));

  const payload = parseJwtPayload(signedData);
  const message = payload?.message;
  if (!message) throw new Error("signedData missing payload.message");

  const signature = await wallet.signMessage(message);

  const login = await axios.post(
    `${API_BASE}/login?chain=${CHAIN}`,
    { signature, signedData, expiresSeconds: 604800 },
    { headers: { "Content-Type": "application/json" } }
  );

  // ✅ 关键修复：只要拿到 token 就认为成功（不强求 success 字段）
  const token = login.data?.token || login.data?.data?.token;
  if (!token) throw new Error("login failed: " + JSON.stringify(login.data).slice(0, 300));

  return token;
}

async function queryOpenOrders(token) {
  const r = await axios.get(`${PERPS_BASE}/api/query_open_orders`, {
    params: { symbol: SYMBOL, limit: 500 },
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data?.result || [];
}

async function cancelOrders(token, edPriv, orderIds) {
  if (!orderIds.length) return;
  const body = { order_id_list: orderIds };
  const payloadStr = JSON.stringify(body);
  const sigHeaders = signBody(edPriv, payloadStr);

  await axios.post(`${PERPS_BASE}/api/cancel_orders`, payloadStr, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-id": SESSION_ID,
      ...sigHeaders,
    },
  });
}

async function newOrder(token, edPriv, body) {
  const payloadStr = JSON.stringify(body);
  const sigHeaders = signBody(edPriv, payloadStr);

  const r = await axios.post(`${PERPS_BASE}/api/new_order`, payloadStr, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-session-id": SESSION_ID,
      ...sigHeaders,
    },
  });
  return r.data;
}

async function main() {
  const { edPriv, requestId } = loadEdKey();
  const token = await authToken({ requestId });

  const info = await getSymbolInfo();
  const priceDec = Number(info.price_tick_decimals);
  const qtyDec = Number(info.qty_tick_decimals);
  const minQty = Number(info.min_order_qty);

  console.log("OK. token acquired.");
  console.log("SESSION_ID:", SESSION_ID);
  console.log("SYMBOL:", SYMBOL, "TIF:", TIF);
  console.log("min_order_qty:", minQty, "price_tick_decimals:", priceDec, "qty_tick_decimals:", qtyDec);
  console.log("CWD:", process.cwd());
  console.log(
    "MODE:",
    ABS_SPREAD_USD > 0 ? `USD(±${ABS_SPREAD_USD}$)` : `BPS(target=${TARGET_BPS}, band=[${MIN_BPS}, ${MAX_BPS}])`
  );
  console.log("PARAMS:", {
    QTY_WANT,
    QTY_JITTER_PCT,
    QTY_MIN_WANT,
    QTY_MAX_WANT,
    LOOP_MS,
    MIN_REFRESH_MS,
    LADDER_LEVELS,
    LADDER_STEP_BPS,
    ORDER_CHECK_MS,
    STOP_ON_FILL,
    TARGET_BPS,
    MIN_BPS,
    MAX_BPS,
    ABS_SPREAD_USD,
    ABS_MIN_USD,
    ABS_MAX_USD,
  });

// 基础下单量（默认等于 QTY），并支持随机抖动与上下限
let qtyBase = Math.max(Number(QTY_WANT), minQty);
qtyBase = roundByDecimals(qtyBase, qtyDec, "down");

// 可选上下限（未设置则为 NaN，不限制）
let qtyMin = QTY_MIN_WANT ? Number(QTY_MIN_WANT) : NaN;
let qtyMax = QTY_MAX_WANT ? Number(QTY_MAX_WANT) : NaN;
if (Number.isFinite(qtyMin)) qtyMin = roundByDecimals(Math.max(qtyMin, minQty), qtyDec, "down");
if (Number.isFinite(qtyMax)) qtyMax = roundByDecimals(Math.max(qtyMax, minQty), qtyDec, "down");
if (Number.isFinite(qtyMin) && Number.isFinite(qtyMax) && qtyMax < qtyMin) {
  const tmp = qtyMin;
  qtyMin = qtyMax;
  qtyMax = tmp;
}

  let lastBid = null;
  let lastAsk = null;
  let lastRefreshTs = 0;
  let lastOrderCheckTs = 0;

  while (true) {
    try {
      const mark = await getMarkPrice();
      const now = Date.now();

      // 定期确认：MMU 双边订单是否仍在簿上（防止被吃单/被系统撤单后还以为在线）
      if ((now - lastOrderCheckTs) >= ORDER_CHECK_MS) {
        lastOrderCheckTs = now;
        const openNow = await queryOpenOrders(token);
        const mineNow = openNow.filter(o => (o.cl_ord_id || "").startsWith("MMU-"));

        // 如果完全没有 MMU 单，说明被清空/掉线/撤单过：强制走一次 REFRESH 重新挂回
        if (mineNow.length === 0) {
          lastBid = null;
          lastAsk = null;
        } else {
          const buyCount = mineNow.filter(o => normalizeSide(o) === "buy").length;
          const sellCount = mineNow.filter(o => normalizeSide(o) === "sell").length;
          const expectedPerSide = LADDER_LEVELS;

          // 任意一边数量不足：通常代表某档被吃/被撤/下单失败
          if (buyCount < expectedPerSide || sellCount < expectedPerSide) {
            const idsNow = mineNow.map(o => o.id).filter(Boolean);
            if (idsNow.length) {
              try {
                await cancelOrders(token, edPriv, idsNow);
              } catch (e) {
                console.log(new Date().toISOString(), "[WARN] cancel after fill failed", e?.response?.data || e?.message || e);
              }
            }
            console.log(
              new Date().toISOString(),
              "[FILL_OR_MISSING_LEVEL]",
              "buy", buyCount,
              "sell", sellCount,
              "expectedPerSide", expectedPerSide,
              "action", STOP_ON_FILL ? "STOP" : "REFRESH"
            );

            // 标记为需要重新挂单
            lastBid = null;
            lastAsk = null;

            // 默认更安全：被吃单就停机，让你手动处理仓位（避免越滚越大）
            if (STOP_ON_FILL) {
              console.log(new Date().toISOString(), "Bot stopped due to fill/missing side. Please check Positions and close if needed.");
              process.exit(2);
            }
          }
        }
      }

      // 如果已经有上一轮挂单价格，优先判断它们是否仍在允许波动区间内
      let refreshReason = "out-of-band";
      if (lastBid !== null && lastAsk !== null) {
        if (ABS_SPREAD_USD > 0) {
          const bidUsd = bidUsdFromMark(mark, lastBid);
          const askUsd = askUsdFromMark(mark, lastAsk);
          const tooCloseUsd = (bidUsd < ABS_MIN_USD) || (askUsd < ABS_MIN_USD);

          // 只要在 [ABS_MIN_USD, ABS_MAX_USD] 区间内，就不刷新（减少撤挂，也避免太贴近被吃单）
          if (!tooCloseUsd && bidUsd <= ABS_MAX_USD && askUsd <= ABS_MAX_USD) {
            console.log(
              new Date().toISOString(),
              "HOLD(band-usd)",
              "mark", mark.toFixed(2),
              "bid", lastBid, `(${bidUsd.toFixed(2)}$)`,
              "ask", lastAsk, `(${askUsd.toFixed(2)}$)`,
              "qty", qtyBase
            );
            await new Promise(r => setTimeout(r, LOOP_MS));
            continue;
          }

          if (tooCloseUsd) refreshReason = "too-close-usd";

          // 防抖：如果刚刷新不久，且仍在合理范围内，并且不属于“太贴近”，就先不刷
          if (!tooCloseUsd && (now - lastRefreshTs) < MIN_REFRESH_MS && bidUsd < (ABS_MAX_USD || Infinity) && askUsd < (ABS_MAX_USD || Infinity)) {
            console.log(
              new Date().toISOString(),
              "HOLD(min-interval-usd)",
              "mark", mark.toFixed(2),
              "bid", lastBid, `(${bidUsd.toFixed(2)}$)`,
              "ask", lastAsk, `(${askUsd.toFixed(2)}$)`,
              "qty", qtyBase
            );
            await new Promise(r => setTimeout(r, LOOP_MS));
            continue;
          }

          refreshReason = refreshReason === "out-of-band" ? "out-of-band-usd" : refreshReason;
        } else {
          const bidBps = bidBpsFromMark(mark, lastBid);
          const askBps = askBpsFromMark(mark, lastAsk);
          const tooClose = (bidBps < MIN_BPS) || (askBps < MIN_BPS);

          // 只要在 [MIN_BPS, MAX_BPS] 区间内，就不刷新（既改减少撤挂，也避免太贴近被吃单）
          if (!tooClose && bidBps <= MAX_BPS && askBps <= MAX_BPS) {
            console.log(
              new Date().toISOString(),
              "HOLD(band)",
              "mark", mark.toFixed(2),
              "bid", lastBid, `(${bidBps.toFixed(2)}bps)`,
              "ask", lastAsk, `(${askBps.toFixed(2)}bps)`,
              "qty", qtyBase
            );
            await new Promise(r => setTimeout(r, LOOP_MS));
            continue;
          }

          if (tooClose) refreshReason = "too-close";

          // 防抖：如果刚刷新不久，且仍在 10bps 内，并且不属于“太贴近”场景，就先不刷
          if (!tooClose && (now - lastRefreshTs) < MIN_REFRESH_MS && bidBps < 10 && askBps < 10) {
            console.log(
              new Date().toISOString(),
              "HOLD(min-interval)",
              "mark", mark.toFixed(2),
              "bid", lastBid, `(${bidBps.toFixed(2)}bps)`,
              "ask", lastAsk, `(${askBps.toFixed(2)}bps)`,
              "qty", qtyBase
            );
            await new Promise(r => setTimeout(r, LOOP_MS));
            continue;
          }
        }
      }

// 需要刷新：计算目标 bid/ask（支持多档）
const levels = LADDER_LEVELS;
const bidPrices = [];
const askPrices = [];

// 根据模式生成每一档的价格
for (let i = 0; i < levels; i++) {
  if (ABS_SPREAD_USD > 0) {
    // USD 模式：以 ABS_SPREAD_USD 为第 1 档，往外每档增加 100 美元（可通过 .env 增加 ABS_STEP_USD 时再扩展）
    const offUsd = Math.max(1, ABS_SPREAD_USD + i * 100);
    const b = roundByDecimals(mark - offUsd, priceDec, "down");
    const a = roundByDecimals(mark + offUsd, priceDec, "up");
    bidPrices.push(b);
    askPrices.push(a);
  } else {
    // BPS 模式：以 TARGET_BPS 为第 1 档，往外每档增加 LADDER_STEP_BPS，但不超过 MAX_BPS
    const offBps = Math.max(0.01, Math.min(MAX_BPS, TARGET_BPS + i * LADDER_STEP_BPS));
    const off = mark * (offBps / 10000);
    const b = roundByDecimals(mark - off, priceDec, "down");
    const a = roundByDecimals(mark + off, priceDec, "up");
    bidPrices.push(b);
    askPrices.push(a);
  }
}

// 兜底：避免 ask<=bid（极端 tick 情况）
for (let i = 0; i < levels; i++) {
  if (askPrices[i] <= bidPrices[i]) {
    askPrices[i] = bidPrices[i] + 1 / (10 ** priceDec);
  }
}

// 用“最靠近 mark 的那一档”（第 1 档）作为 band 判断参考（不改变原 HOLD/REFRESH 逻辑）
const bid = bidPrices[0];
const ask = askPrices[0];

      const open = await queryOpenOrders(token);
      const mine = open.filter(o => (o.cl_ord_id || "").startsWith("MMU-"));
      const ids = mine.map(o => o.id).filter(Boolean);
      if (ids.length) await cancelOrders(token, edPriv, ids);

      // (removed single-order bidBody block)
      const qtyEach = pickQtyEach({
        qtyBase,
        minQty,
        qtyDec,
        jitterPct: QTY_JITTER_PCT,
        qtyMin,
        qtyMax,
      });
      const tsBase = Date.now();
const results = [];

// 先挂买单（从更远到更近）
for (let i = levels - 1; i >= 0; i--) {
  const b = bidPrices[i];
  const bidBody = {
    symbol: SYMBOL,
    side: "buy",
    order_type: "limit",
    qty: qtyEach.toFixed(qtyDec),
    price: b.toFixed(priceDec),
    time_in_force: TIF,
    reduce_only: false,
    cl_ord_id: `MMU-BID-L${i}-${tsBase}`
  };
  const r = await newOrder(token, edPriv, bidBody);
  results.push({ side: "buy", level: i, price: b, code: r?.code });
  if (r?.code !== 0) break;
}

// 再挂卖单
for (let i = levels - 1; i >= 0; i--) {
  const a = askPrices[i];
  const askBody = {
    symbol: SYMBOL,
    side: "sell",
    order_type: "limit",
    qty: qtyEach.toFixed(qtyDec),
    price: a.toFixed(priceDec),
    time_in_force: TIF,
    reduce_only: false,
    cl_ord_id: `MMU-ASK-L${i}-${tsBase}`
  };
  const r = await newOrder(token, edPriv, askBody);
  results.push({ side: "sell", level: i, price: a, code: r?.code });
  if (r?.code !== 0) break;
}

lastBid = bid;
lastAsk = ask;
lastRefreshTs = Date.now();

      if (ABS_SPREAD_USD > 0) {
        const bidUsdNow = bidUsdFromMark(mark, bid);
        const askUsdNow = askUsdFromMark(mark, ask);
        console.log(
          new Date().toISOString(),
          `REFRESH(${refreshReason})`,
          "mark", mark.toFixed(2),
          "bid", bid, `(${bidUsdNow.toFixed(2)}$)`,
          "ask", ask, `(${askUsdNow.toFixed(2)}$)`,
          "levels", levels,
          "orders", JSON.stringify(results),
          "qty_each", qtyEach
        );
      } else {
        const bidBpsNow = bidBpsFromMark(mark, bid);
        const askBpsNow = askBpsFromMark(mark, ask);
        console.log(
          new Date().toISOString(),
          `REFRESH(${refreshReason})`,
          "mark", mark.toFixed(2),
          "bid", bid, `(${bidBpsNow.toFixed(2)}bps)`,
          "ask", ask, `(${askBpsNow.toFixed(2)}bps)`,
          "levels", levels,
          "orders", JSON.stringify(results),
          "qty_each", qtyEach
        );
      }
    } catch (e) {
      console.log(new Date().toISOString(), "[ERR]", e?.response?.data || e?.message || e);
    }

    await new Promise(r => setTimeout(r, LOOP_MS));
  }
}

main().catch(e => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
