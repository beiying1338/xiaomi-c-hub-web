# 协议参考 — 小米/Redmi 桌面音箱 B03 家族

> 通过对本机自有设备的接口行为观测整理而成，仅用于互操作性研究。
> 所有帧均在本机实测验证（Redmi 电脑音箱 2 Pro，USB `VID 2717 / PID D003`）。

## 传输

设备为 USB 复合设备：

| 接口 | 类型 | 用途 |
|---|---|---|
| 0/1/2 | USB Audio | 扬声器 / 麦克风（等时端点） |
| 3 | HID (usagePage 0x0C) | 媒体键 / 音量旋钮 |
| **4** | **HID vendor-defined（usagePage 0xFF00, usage 0x55AA），无中断端点** | **控制协议通道，纯 feature report** |

控制通道读写方式（node-hid）：

```js
const hid = new HID.HID('\\?\HID#VID_2717&PID_D003&MI_04#...');
hid.sendFeatureReport(Buffer.from([0x00, ...frame]));  // 单缓冲区参数，首字节 = report id 0
const resp = hid.getFeatureReport(0, 129);             // 应答 129 B，首字节为 report id
```

B03 家族 PID：`D003 D004 D00B D00C`（中文版）· `D007 D008`（国际版）· `D009 D00A`（套装版）。

## 帧格式

```
A5 5A FC <LEN> <CMD> <OP> [DATA…] 16
```

- `LEN`：`CMD` 起至 `DATA` 末的字节数（查询=03；写单值=03；写十段 EQ=0x12）
- `OP`：`03` = 查询，`02` = 写入
- `16`：帧尾

状态总查询（实测往返）：

```
TX  a5 5a fc 03 90 03 00 16
RX  a5 5a fc 62 90 03 30 01 02 31 01 0a 32 01 00 … 8c 0a 06 06 09 03 … 16
```

## 参数表（TLV：`<ID> <LEN> <VALUE…>`）

| ID | 名称 | 编码 |
|---|---|---|
| 48 | lightEffectIndex 灯效 | 1 拾音律动 · 2 时尚霓虹 · 3 梦幻极光 · 4 堆叠 · 5 星空闪烁 · 6 纯色呼吸 |
| 49 | light 亮度 | 0–10（×10 = 百分比） |
| 50 | lightToneFlag 灯效提示音 | 0/1 |
| 52 | rgbLightFlag 灯效开关 | 0/1 |
| 64 | equalizerIndex 音效 | 0 标准 · 1 强劲低音 · 2 纯净人声 · 3 游戏 · 4 影院 |
| 65 | soundToneFlag 音效提示音 | 0/1 |
| 113 | BTVersion 固件版本 | 十进制版本号（如 49 = V49） |
| 116 | volume 音量 | 0–16（×6 = 百分比；16 → 100） |
| 117 | electricity 电量 | |
| 119 / 120 / 121 | TXVersion / RXVersion / RXConnectStatus | 低音炮发射/接收版本与连接状态 |
| 128 / 129 | sleepFlag / sleepValue 睡眠 | 开关 + 时长 0–16 |
| 131 / 132 | standbyFlag / standbyValue 待机 | 开关 + 时长 0–16 |
| 133 | channelStatus 通道 | 数组；值=2 的下标为当前通道（0 USB · 1 蓝牙 · 2 AUX IN） |
| 134 / 135 | channelPromptFlag / channelPrompt 通道提示音 | 开关 + 音量 0–16 |
| 136 | agilityOrColorFlag 律动灵敏度/流动速率 | |
| 137 | syldColorIndex 律动颜色 | 0 五彩 · 1 彩虹 · 2 天空 |
| 138 / 139 | colorFlowRate / breathingSpeed | 0–16 |
| 140 | equalizerHZsValue 十段 EQ | 10 字节，各值 −6 = ±6 dB |
| 142 | powerNoticeFlag 开关机提示音 | 0/1 |
| 143 | mixLineChannelFlag 有线混合通道 | 0/1 |

## 写入示例

```
音量 84%（=14）:   a5 5a fc 03 74 02 0e 16
十段 EQ (-6…+6):  a5 5a fc 12 8c 02 0a <10B 原始值(值-6)> 16
切换灯效:          a5 5a fc 03 30 02 <id> 16
重启:              a5 5a fc 03 73 02 00 16
恢复出厂:          a5 5a fc 03 72 02 00 16
```

写入命令的应答即最新完整状态帧（TLV），可直接回读校验。

## 固件升级（仅记录，未实现）

官方升级通道为独立的 256 B feature-report bootloader 协议（握手 `A5 5A 22 06`，249 B 分块，ACK 0x31），固件容器为 `MVAX` 家族格式（BT 主箱 / G1-TX 发射端 / G1-RX 接收端三套）。刷写错误存在变砖风险，本工具**有意不提供**升级功能，升级请使用官方应用。
