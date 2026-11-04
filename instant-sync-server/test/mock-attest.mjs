#!/usr/bin/env node
// Fake enclave agent: `attest --nonce <hex> --public-key <b64>` prints a base64 "document"
// that just echoes its inputs, so tests can check the server passes them through.
const args = process.argv.slice(2);
const flag = (n) => args[args.indexOf(n) + 1];
if (args[0] !== "attest") process.exit(2);
process.stdout.write(Buffer.from(JSON.stringify({ mock: true, nonce: flag("--nonce"), publicKey: flag("--public-key") })).toString("base64") + "\n");
