import fs from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

const FILE = "./standx_ed25519.json";

let j = {};
if (fs.existsSync(FILE)) {
  j = JSON.parse(fs.readFileSync(FILE, "utf8"));
}

if (!j.priv_b64 || !j.requestId) {
  const priv = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(priv);

  j.priv_b64 = Buffer.from(priv).toString("base64");
  j.pub_b64 = Buffer.from(pub).toString("base64");
  j.requestId = base58.encode(pub);
  j.created_at = new Date().toISOString();

  fs.writeFileSync(FILE, JSON.stringify(j, null, 2));
}

console.log("requestId =", j.requestId);
console.log("saved ->", FILE);
