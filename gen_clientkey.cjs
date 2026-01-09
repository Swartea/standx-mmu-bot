const fs = require("fs");
const { ed25519 } = require("@noble/curves/ed25519");
const { base58 } = require("@scure/base");

const FILE = "./standx_ed25519.json";

function main() {
  let j = {};
  if (fs.existsSync(FILE)) {
    j = JSON.parse(fs.readFileSync(FILE, "utf8"));
  }

  if (!j.priv_b64) {
    const priv = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(priv);
    j.priv_b64 = Buffer.from(priv).toString("base64");
    j.pub_b64 = Buffer.from(pub).toString("base64");
    j.requestId = base58.encode(pub); // ClientKey
    fs.writeFileSync(FILE, JSON.stringify(j, null, 2));
  }

  console.log("ClientKey(requestId) =", j.requestId);
  console.log("Saved ->", FILE);
}

main();
