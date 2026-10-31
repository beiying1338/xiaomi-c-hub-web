# Xiaomi C-HUB Web · 音箱网页驱动管理

网页版驱动管理器，用于 **Redmi 电脑音箱 2 Pro**（小米 B03 家族桌面音箱）。
协议由对自有设备的接口行为逆向整理而来（详见 [PROTOCOL.md](PROTOCOL.md)），全部命令已实机验证。

无需安装官方 Xiaomi C-HUB 应用 —— 一个本地桥接服务 + 浏览器即可完成全部日常管理。

## 功能

- 实时状态轮询（固件版本、低音炮状态、电量）
- 音量、通道切换（USB / 蓝牙 / AUX IN）、通道提示音
- RGB 灯效六选一、亮度、色彩流动速度、呼吸速度、律动灵敏度与颜色
- 十段 EQ（±6 dB）与五种预设（标准 / 强劲低音 / 纯净人声 / 游戏 / 影院）
- 睡眠 / 待机 / 开关机提示音
- 重启、恢复出厂设置
- 实时 TX/RX 协议帧控制台（调试利器）

> 固件升级功能**有意未实现**：刷写有变砖风险，升级请使用官方应用。

## 架构

```
┌─ 浏览器 ─────────────┐      ┌─ 本地桥接 (server.mjs) ─┐      ┌─ 音箱 ─┐
│  静态 UI（任意托管）  │─HTTP─│  node-hid feature report │─USB─│ B03    │
└──────────────────────┘      └──────────────────────────┘      └────────┘
```

- **本地/内网**：桥接服务同源托管 UI，直接用。
- **远程**：UI 托管到 Cloudflare Workers，`/api` 由 Worker 反代到家里通过 Cloudflare Tunnel 暴露的桥接服务。

## 快速开始（本地，无需 Docker）

```bash
npm install
npm start
# 打开 http://127.0.0.1:8787
```

要求：Node.js ≥ 18（Windows / macOS / Linux 均可，预编译二进制已随包分发）。
音箱通过 USB 连接电脑即可。

---

## Docker 部署（Linux 主机 / NAS / 树莓派）

> USB HID 设备无法穿透 Windows/macOS 的 Docker Desktop 虚拟机 —— Windows/macOS 用户请用上面的本地方式运行，或把服务跑在局域网内的 Linux 机器上。

### 1. 找到音箱的 hidraw 节点

```bash
./scripts/find-hidraw.sh
# hidraw5  REDMI 电脑音箱 2 Pro
```

### 2.（可选但推荐）固定设备节点

音箱重新插拔后 `hidrawN` 编号可能变化，装一条 udev 规则生成稳定符号链接：

```bash
sudo cp scripts/99-chub-speaker.rules /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger
ls -l /dev/chub-speaker   # → /dev/hidraw5
```

### 3. 构建并启动

```bash
# 编辑 docker-compose.yml，把 devices 里的 /dev/hidraw5 改成你的节点
# （或改映射 /dev/chub-speaker:/dev/chub-speaker）

# 可选：设置访问令牌（公网/跨网段访问时强烈建议）
echo "CHUB_TOKEN=change-me" > .env

docker compose up -d --build
```

### 4. 验证

```bash
curl http://127.0.0.1:8787/api/state
```

不想精确映射设备节点的话，`docker-compose.yml` 里也有 `privileged: true` 的注释备选（家用 NAS 上图省事可用，安全性换便利）。

**无 Docker Compose 时的等价命令：**

```bash
docker build -t xiaomi-c-hub-web .
docker run -d --name chub-web --restart unless-stopped \
  -p 8787:8787 \
  --device /dev/hidraw5:/dev/hidraw5 \
  -e CHUB_TOKEN=change-me \
  xiaomi-c-hub-web
```

---

## Cloudflare Worker 部署（远程管理）

适用场景：人在外面，想控制家里接了音箱的电脑/NAS。

### 1. 家里：把桥接服务发布到公网（Cloudflare Tunnel）

```bash
# 快速试用（临时随机域名）：
cloudflared tunnel --url http://127.0.0.1:8787
# → 输出形如 https://xxxx-yyyy.trycloudflare.com

# 生产环境建议建命名隧道（域名固定）：
cloudflared tunnel login
cloudflared tunnel create chub-web
cloudflared tunnel route dns chub-web chub-web.你的域名.com
cloudflared tunnel run --url http://127.0.0.1:8787 chub-web
```

同时给本地桥接服务设置访问令牌（公网裸奔等于谁都能动你音箱）：

```bash
CHUB_TOKEN=change-me npm start       # Linux/macOS
# Windows PowerShell:  $env:CHUB_TOKEN='change-me'; npm start
```

### 2. Cloudflare：部署 Worker

```bash
cd worker
npx wrangler login
npx wrangler secret put BRIDGE_URL
#    粘贴第 1 步得到的隧道地址，例如 https://chub-web.你的域名.com
npx wrangler deploy
```

Worker 会用 **Workers Static Assets** 直接托管 `public/` 静态页面，并把 `/api/*` 反代到 `BRIDGE_URL`（含 `Authorization` 头透传），浏览器侧无需任何 CORS 配置。

### 3. 使用

打开 `https://chub-web.你的-workers.dev`（或绑定的域名），页面会自动弹窗索要访问令牌 —— 输入第 1 步设置的 `CHUB_TOKEN` 即可。令牌保存在浏览器 localStorage，之后无需重复输入。

也可以用页面上「桥接地址 / 访问令牌」两个按钮随时切换后端：

| 按钮 | 作用 |
|---|---|
| 桥接地址 | UI 直连任意桥接服务（留空 = 同源）；直连模式需服务端开启 `CHUB_CORS=1` |
| 访问令牌 | 保存/清除 Bearer Token（服务端设置了 `CHUB_TOKEN` 时必填） |

---

## 安全说明

- 音箱的 HID 协议本身**无鉴权**：本机任意用户态程序都能控制它（官方应用同样如此）。
- 桥接服务默认只监听 `127.0.0.1`；通过 Docker/Tunnel 暴露时**务必设置 `CHUB_TOKEN`**。
- Worker 侧 `BRIDGE_URL` 是你自己的隧道地址，令牌只保存在你自己的浏览器里。

## 许可

代码 MIT。MiSans 等品牌资产与小米/越陌的任何专有代码**不包含**在本仓库中。
