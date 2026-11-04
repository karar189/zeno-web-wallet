#!/usr/bin/env node
// Fake zcash-devtool for tests. Mimics: wallet -w <dir> init-fvk|sync|balance --json|list-tx --json
// Env: MOCK_SYNC_DELAY_MS (default 500), MOCK_IRONWOOD (zatoshis, default 150000000), MOCK_FAIL_SYNC=1
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args[0] !== "wallet") {
  console.error("mock: expected `wallet` subcommand");
  process.exit(2);
}
const dir = flag("-w");
const cmd = args[3];
if (!dir || !cmd) {
  console.error("mock: usage wallet -w <dir> <cmd>");
  process.exit(2);
}
const stateFile = path.join(dir, "mock-state.json");
const read = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

switch (cmd) {
  case "init-fvk": {
    const fvk = flag("--fvk");
    if (!fvk || !flag("--name") || !flag("-s")) {
      console.error("mock: init-fvk needs --name --fvk -s");
      process.exit(2);
    }
    if (fs.existsSync(stateFile)) {
      console.error("mock: wallet already exists");
      process.exit(1);
    }
    fs.mkdirSync(dir, { recursive: true });
    // Never store the key itself, mirror only its length so tests can check it was passed.
    fs.writeFileSync(stateFile, JSON.stringify({ fvkLength: fvk.length, birthday: Number(flag("--birthday") ?? 0), synced: 0, tip: 3_900_000 }));
    console.log("Created view-only account");
    break;
  }
  case "sync": {
    const s = read();
    await sleep(Number(process.env.MOCK_SYNC_DELAY_MS ?? 500));
    if (process.env.MOCK_FAIL_SYNC === "1") {
      console.error("mock: lightwalletd unreachable");
      process.exit(1);
    }
    s.synced += 1;
    s.tip += 1;
    fs.writeFileSync(stateFile, JSON.stringify(s));
    console.log(`Synced to ${s.tip}`);
    break;
  }
  case "balance": {
    const s = read();
    const ironwood = s.synced ? Number(process.env.MOCK_IRONWOOD ?? 150000000) : 0;
    console.log("Fetching balance...");
    console.log(JSON.stringify({
      total: String(ironwood + 2500),
      sapling_spendable: "0",
      orchard_spendable: "0",
      ironwood_spendable: String(ironwood),
      transparent_spendable: "2500",
      chain_tip_height: s.tip,
    }));
    break;
  }
  case "list-tx": {
    const s = read();
    const txs = s.synced
      ? [
          { txid: "a".repeat(64), mined_height: 3_899_990 },
          { txid: "b".repeat(64), mined_height: null },
        ]
      : [];
    console.log(JSON.stringify(txs));
    break;
  }
  default:
    console.error(`mock: unknown command ${cmd}`);
    process.exit(2);
}
