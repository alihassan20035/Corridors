# Deploy Corridors on AWS EC2

This puts the game online so you and a friend can play from different phones or computers. One player creates a room and gets a 5-digit code, the other joins with it, and every move shows up on both screens instantly.

You need: an AWS account, the `corridors.zip` file, and a terminal (Windows: PowerShell or Git Bash).

---

## 1. Launch the server

In the AWS console go to **EC2 → Launch instance**:

| Setting | Value |
|---|---|
| Name | `corridors` |
| Image | **Ubuntu Server 24.04 LTS** |
| Instance type | **t3.micro** (or t2.micro, free tier) |
| Key pair | Create one, download the `.pem` file and keep it safe |
| Network settings → Security group | Allow **SSH (22)** from *My IP*, **HTTP (80)** from *Anywhere*, **HTTPS (443)** from *Anywhere* |
| Storage | 8 GB is plenty |

Click **Launch**. When it shows *Running*, copy its **Public IPv4 address** (for example `13.250.10.20`).

> Tip: an IP changes if you stop and start the instance. To keep it fixed, go to **EC2 → Elastic IPs → Allocate**, then **Associate** it with this instance.

## 2. Copy the game to the server

On your own computer, in the folder with your key and the zip:

```bash
# macOS / Linux / Git Bash only: make the key private
chmod 400 corridors-key.pem

scp -i corridors-key.pem corridors.zip ubuntu@13.250.10.20:~
ssh -i corridors-key.pem ubuntu@13.250.10.20
```

Replace `13.250.10.20` with your IP. On Windows PowerShell, if the key permission check complains, right-click the `.pem` file → Properties → Security, and leave only your own user with access.

## 3. Install Node.js, nginx and the game

Now you are typing on the server:

```bash
sudo apt update
sudo apt install -y unzip nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

unzip corridors.zip
cd corridors
npm install --omit=dev
```

Check it works:

```bash
npm test          # should print "... passed, 0 failed" twice
```

## 4. Keep the game running with pm2

pm2 restarts the game if it crashes and starts it again after a reboot.

```bash
sudo npm install -g pm2
HOST=127.0.0.1 PORT=3000 pm2 start server.js --name corridors
pm2 save
pm2 startup
```

`pm2 startup` prints one `sudo env PATH=... pm2 startup ...` line. Copy that line and run it.

## 5. Put nginx in front (port 80)

nginx receives visitors on port 80 and passes them, including the live WebSocket connection, to the game on port 3000.

```bash
sudo nano /etc/nginx/sites-available/corridors
```

Paste this, then save (Ctrl+O, Enter, Ctrl+X):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Needed for online rooms (WebSocket)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

Turn it on:

```bash
sudo ln -s /etc/nginx/sites-available/corridors /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Play

Open `http://13.250.10.20` (your IP) on your phone or computer.

1. Tap **Play a friend online**, type your name, tap **Create a room**.
2. Send the 5-digit code to your friend (WhatsApp, etc.).
3. Your friend opens the same address, taps **Play a friend online**, enters the code and taps **Join**.
4. You are Red and move first. Each move appears on the other screen right away.

If someone refreshes the page or their internet drops, they rejoin automatically. Their seat is held for 10 minutes. After a game, both players tap **Rematch** to play again in the same room.

---

## Optional: your own domain with HTTPS

1. Buy a domain and add an **A record** such as `game.yourdomain.com` → your Elastic IP.
2. In the nginx file, change `server_name _;` to `server_name game.yourdomain.com;` and reload nginx.
3. Get a free certificate:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d game.yourdomain.com
```

The game switches to secure WebSockets (`wss://`) automatically when the page is opened over `https://`.

## Updating the game later

```bash
scp -i corridors-key.pem corridors.zip ubuntu@13.250.10.20:~
ssh -i corridors-key.pem ubuntu@13.250.10.20
unzip -o corridors.zip && cd corridors && npm install --omit=dev
pm2 restart corridors
```

Rooms live in the server's memory, so a restart ends any games in progress.

## Useful commands

```bash
pm2 status              # is it running?
pm2 logs corridors      # live log: rooms created, joined, won
pm2 restart corridors
sudo systemctl status nginx
curl localhost:3000/health   # prints "ok"
```

## If something goes wrong

| What you see | Fix |
|---|---|
| Browser can't reach the IP at all | Security group is missing **HTTP 80 from Anywhere**. Also make sure you typed `http://`, not `https://`. |
| `502 Bad Gateway` | The game isn't running: `pm2 status`, then `pm2 logs corridors`. |
| Game loads, but online shows "Reconnecting…" forever | The two `Upgrade` / `Connection` lines are missing from the nginx file. Add them, `sudo nginx -t`, reload. |
| "Online play needs the game server" | You opened `index.html` as a file. Open the server address instead. |
| Works on Wi-Fi but not mobile data for your friend | Check you shared the public IP (or domain), not `localhost`. |

## Cost

A t3.micro is covered by the AWS free tier on eligible new accounts; outside it, expect roughly 8–10 USD a month. AWS also bills public IPv4 addresses (including Elastic IPs) by the hour, a few dollars a month. Prices and free-tier rules change, so check the EC2 pricing page for your region. Stopping the instance when you're not playing saves the instance cost; release an Elastic IP you no longer need.
