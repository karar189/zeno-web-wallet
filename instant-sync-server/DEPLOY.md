# Deploying Instant Sync (v0, testnet)

Target: one **EC2 c6i.xlarge** in **ap-south-1 (Mumbai)**, launched with **Nitro Enclaves enabled** so the same box can run the enclave version later. Nitro Enclaves can only be turned on at launch.

> Not yet done from this repo: the Docker image has not been test-built (no Docker on the dev machine). Run step 4 and watch the first build.

## 1. Launch the instance

Console: EC2 → Launch instance

- AMI: **Amazon Linux 2023** (x86_64)
- Type: **c6i.xlarge** (4 vCPU / 8 GiB; enclaves need ≥ 4 vCPU on the parent)
- Advanced details → **Nitro Enclave: Enable**
- Storage: 40 GiB gp3, **encrypted**
- Security group: `22` from your IP only, `80` and `443` from anywhere
- Allocate an **Elastic IP** and associate it

CLI equivalent:

```bash
aws ec2 run-instances --region ap-south-1 \
  --image-id resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --instance-type c6i.xlarge \
  --enclave-options Enabled=true \
  --key-name <your-key> \
  --security-group-ids <sg-id> \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=40,VolumeType=gp3,Encrypted=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=zeno-instant-sync}]'
```

## 2. DNS

Create an `A` record, e.g. `sync.<your-domain>` → the Elastic IP. Wait until `dig +short sync.<your-domain>` returns it; Caddy needs this to get a certificate.

## 3. Install Docker + Compose

```bash
ssh ec2-user@<elastic-ip>
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user && newgrp docker

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo curl -fsSL https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-amd64 \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/*
docker compose version
```

## 4. Configure and start

```bash
git clone <this repo> zeno && cd zeno/instant-sync-server
cp .env.example .env
# edit .env:
#   DOMAIN=sync.<your-domain>
#   ALLOWED_ORIGIN=http://localhost:3000   # the web app origin that will call the server
#   DEVTOOL_REF=<commit sha>               # pin it; `main` moves
docker compose up -d --build     # first build compiles zcash-devtool: expect 15–25 min
docker compose logs -f instant-sync
```

## 5. Verify

```bash
curl -s https://sync.<your-domain>/health
# {"ok":true,"accounts":0,"queued":0,"running":0}
docker compose exec instant-sync zcash-devtool --help | head -5
```

## 6. Real testnet smoke test

1. In `frontend/.env.local` set `NEXT_PUBLIC_INSTANT_SYNC_URL=https://sync.<your-domain>` and restart `npm run dev`.
2. Start the local wallet service (testnet, 8787) and unlock the wallet in the app.
3. Settings → **Instant Sync → On**. This fetches the primary UFVK from the local wallet service and registers it.
4. Watch the first sync on the server:
   ```bash
   docker compose logs -f instant-sync          # "registered <id>"; errors are redacted
   ```
5. Poll state with the token from the browser (DevTools console):
   ```js
   const t = localStorage.getItem("zeno.instantSync.v1.token.testnet");
   await (await fetch("https://sync.<your-domain>/v1/state", { headers: { authorization: `Bearer ${t}` } })).json();
   ```
   Wait for `status: "ready"`. Note `firstSyncMs`.
6. Compare with local: the wallet home shows the local shielded spendable after local sync. `ironwood_spendable + orchard_spendable + sapling_spendable` should equal it. A mismatch prints `[instant-sync] server shielded spendable … != local …` in the console. Small differences right after a send can come from different confirmation policies (the wallet service uses 1 confirmation on testnet).
7. Reload the app: the badge should read `Synced in 0.Xs · instant`.
8. Turn the toggle **Off** and confirm `GET /v1/state` with the old token returns 401.

## Operations

- Data lives in the `sync-data` volume (`/data`). Back it up or treat it as cache; users re-register on 401.
- Rotate the box: `docker compose down`, keep or drop the volume, `up -d`.
- Mainnet stays refused (`ALLOW_MAINNET=0` is forced in compose).

## Later: moving into a Nitro Enclave

The server is a single process with a file-backed state dir and one outbound dependency (lightwalletd over TLS). To move it: run Node + devtool inside the enclave image (`nitro-cli build-enclave`), proxy lightwalletd over vsock, pass the UFVK over the attested channel instead of argv, and seal `/data` with a KMS key bound to the enclave's PCRs. The client would then verify the attestation document before calling `/v1/register`.
