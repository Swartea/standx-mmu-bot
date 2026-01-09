import "dotenv/config";
import axios from "axios";

const BASE = "https://perps.standx.com";
const symbol = process.env.SYMBOL || "BTC-USD";

async function main() {
  const info = await axios.get(`${BASE}/api/query_symbol_info`, { params: { symbol } });
  const price = await axios.get(`${BASE}/api/query_symbol_price`, { params: { symbol } });

  const s = Array.isArray(info.data) ? info.data.find(x => x.symbol === symbol) : null;
  if (!s) throw new Error("symbol info not found: " + JSON.stringify(info.data).slice(0, 200));

  const mark = Number(price.data?.mark_price ?? price.data?.index_price ?? 0);
  console.log("SYMBOL:", symbol);
  console.log("min_order_qty:", s.min_order_qty);
  console.log("price_tick_decimals:", s.price_tick_decimals);
  console.log("qty_tick_decimals:", s.qty_tick_decimals);
  console.log("mark_price:", price.data?.mark_price, "index_price:", price.data?.index_price);

  const minQty = Number(s.min_order_qty);
  if (mark > 0 && minQty > 0) {
    console.log("min_notional ~= ", (minQty * mark).toFixed(4), "DUSD");
  }
}

main().catch(e => {
  console.error("ERR:", e?.message || e);
  process.exit(1);
});
