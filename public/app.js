/* Xiaomi C-HUB Web 驱动管理 — frontend logic */
const $ = (s) => document.querySelector(s);
const API_BASE = (localStorage.getItem('chubApiBase') || '').replace(/\/+$/, '');
function authHeaders(extra = {}) {
  const t = localStorage.getItem('chubToken');
  const h = { ...extra };
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}
async function jfetch(url, opts = {}) {
  const r = await fetch(API_BASE + url, { ...opts, headers: authHeaders(opts.headers) });
  if (r.status === 401) {
    const t = prompt('此桥接服务需要访问令牌（服务端 CHUB_TOKEN）：');
    if (t) { localStorage.setItem('chubToken', t); return jfetch(url, opts); }
    return { error: 'unauthorized' };
  }
  return r.json();
}
const API = {
  state: () => jfetch('/api/state'),
  set: (key, value) => jfetch('/api/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) }),
  restart: () => jfetch('/api/restart', { method: 'POST' }),
  reset: () => jfetch('/api/factory-reset', { method: 'POST' }),
};

const FX = [
  { id: 1, name: '拾音律动 2.0', c: 'linear-gradient(135deg,#ff2d55,#ff9500)' },
  { id: 2, name: '时尚霓虹 2.0', c: 'linear-gradient(135deg,#5e5ce6,#30d158,#64d2ff)' },
  { id: 3, name: '星空闪烁', c: 'radial-gradient(circle at 30% 30%,#fff 2%,#5e5ce6 30%,#0a0a20 90%)' },
  { id: 4, name: '梦幻极光 2.0', c: 'linear-gradient(135deg,#64d2ff,#5e5ce6,#ff2d55)' },
  { id: 5, name: '温暖炉火 2.0', c: 'linear-gradient(135deg,#ff9500,#ff453a,#7a1c00)' },
  { id: 6, name: '纯色呼吸 2.0', c: 'radial-gradient(circle,#ffffff55,#ffffff18)' },
];
const EQ_HZ = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const DUR = ['10 分钟', '20 分钟', '30 分钟', '1 小时', '2 小时', '不限'];

let cfg = null;
let suppress = false; // avoid write-echo loops while applying state

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 1800);
}
function logLine(dir, text) {
  const c = $('#con');
  const d = document.createElement('div');
  d.className = dir;
  d.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${dir.toUpperCase()} ${text}`;
  c.prepend(d);
  while (c.childElementCount > 120) c.lastChild.remove();
}
function setSwitch(el, on) { el.classList.toggle('on', !!on); }
function setSlider(el, v, labelEl, transform = (x) => x) {
  el.value = v;
  if (labelEl) labelEl.textContent = transform(v);
}

// ---------- build dynamic UI ----------
$('#fxGrid').innerHTML = FX.map((f) => `<div class="fx" data-v="${f.id}"><div class="sw" style="background:${f.c}"></div>${f.name}</div>`).join('');
$('#eqWrap').innerHTML = EQ_HZ.map((hz, i) => `
  <div class="eq-band">
    <div class="val" id="eqv${i}">0</div>
    <input type="range" id="eq${i}" min="-6" max="6" value="0">
    <label>${hz} Hz</label>
  </div>`).join('');

// ---------- state application ----------
function applyState(c) {
  cfg = c;
  suppress = true;
  $('#devname').textContent = c.product || 'REDMI 电脑音箱 2 Pro';
  $('#dot').classList.add('on');
  $('#model').textContent = 'REDMI 电脑音箱 2 Pro (B03)';
  $('#fwbt').textContent = 'V' + c.BTVersion;
  $('#fwtx').textContent = 'V' + (c.TXVersion ?? 0);
  $('#fwrx').textContent = c.RXVersion ? 'V' + c.RXVersion : '—';
  $('#rxconn').innerHTML = c.RXConnectStatus ? '<span style="color:var(--ok)">已连接</span>' : '<span style="color:var(--tx2)">未连接</span>';
  setSlider($('#vol'), c.volume ?? 50, $('#volNum'));
  setSlider($('#light'), c.light ?? 50, $('#lightV'));
  setSlider($('#flow'), c.colorFlowRate ?? 0, $('#flowV'));
  setSlider($('#breath'), c.breathingSpeed ?? 0, $('#breathV'));
  setSlider($('#agility'), c.agilityOrColorFlag ?? 0, $('#agilityV'));
  setSlider($('#chPrompt'), c.channelPrompt ?? 0, $('#chPromptV'));
  setSlider($('#sleepV'), c.sleepValue ?? 0, $('#sleepVV'));
  setSlider($('#standbyV'), c.standbyValue ?? 0, $('#standbyVV'));
  setSwitch($('#sw-rgb'), c.rgbLightFlag);
  setSwitch($('#sw-ltone'), c.lightToneFlag);
  setSwitch($('#sw-chPromptFlag'), c.channelPromptFlag);
  setSwitch($('#sw-mix'), c.mixLineChannelFlag);
  setSwitch($('#sw-sleep'), c.sleepFlag);
  setSwitch($('#sw-standby'), c.standbyFlag);
  setSwitch($('#sw-pn'), c.powerNoticeFlag);
  document.querySelectorAll('#fxGrid .fx').forEach((el) => el.classList.toggle('on', +el.dataset.v === c.lightEffectIndex));
  document.querySelectorAll('#eqSeg button').forEach((el) => el.classList.toggle('on', +el.dataset.v === c.equalizerIndex));
  document.querySelectorAll('#chanSeg button').forEach((el) => el.classList.toggle('on', +el.dataset.v === c.channel));
  document.querySelectorAll('#syldSeg button').forEach((el) => el.classList.toggle('on', +el.dataset.v === c.syldColorIndex));
  (c.equalizerHZsValue || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).forEach((v, i) => {
    $('#eq' + i).value = v;
    $('#eqv' + i).textContent = (v > 0 ? '+' : '') + v;
  });
  suppress = false;
}

// ---------- actions ----------
async function setState(key, value, label) {
  const r = await API.set(key, value);
  if (r && !r.error) { applyState({ ...cfg, ...r }); toast(label + ' ✓'); }
  else { toast((label || '设置') + ' 失败' + (r && r.error ? '：' + r.error : '')); refresh(); }
}
const debounced = (fn, ms = 400) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

$('#vol').addEventListener('input', (e) => { $('#volNum').textContent = e.target.value; });
$('#vol').addEventListener('change', (e) => setState('volume', +e.target.value, '音量'));
const sliderBind = (id, key, label, labelId, t = (x) => x) => {
  const el = $(id);
  el.addEventListener('input', (e) => { if (labelId) $(labelId).textContent = t(e.target.value); });
  el.addEventListener('change', (e) => setState(key, +e.target.value, label));
};
sliderBind('#light', 'light', '亮度', '#lightV');
sliderBind('#flow', 'colorFlowRate', '色彩流动速度', '#flowV');
sliderBind('#breath', 'breathingSpeed', '呼吸速度', '#breathV');
sliderBind('#agility', 'agilityOrColorFlag', '律动灵敏度', '#agilityV');
sliderBind('#chPrompt', 'channelPrompt', '提示音大小', '#chPromptV');
sliderBind('#sleepV', 'sleepValue', '睡眠时长', '#sleepVV');
sliderBind('#standbyV', 'standbyValue', '待机时长', '#standbyVV');

const switchBind = (id, key, label) => $(id).addEventListener('click', (e) => {
  const el = e.currentTarget;
  el.classList.toggle('on');
  setState(key, el.classList.contains('on') ? 1 : 0, label);
});
switchBind('#sw-rgb', 'rgbLightFlag', '灯效开关');
switchBind('#sw-ltone', 'lightToneFlag', '灯效提示音');
switchBind('#sw-chPromptFlag', 'channelPromptFlag', '通道提示音');
switchBind('#sw-mix', 'mixLineChannelFlag', '低音炮独立音量');
switchBind('#sw-sleep', 'sleepFlag', '睡眠');
switchBind('#sw-standby', 'standbyFlag', '待机');
switchBind('#sw-pn', 'powerNoticeFlag', '开/关机提示音');

$('#fxGrid').addEventListener('click', (e) => {
  const el = e.target.closest('.fx');
  if (el) setState('lightEffectIndex', +el.dataset.v, '灯效 → ' + el.textContent.trim());
});
$('#eqSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setState('equalizerIndex', +b.dataset.v, '音效 → ' + b.textContent); });
$('#chanSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setState('channel', +b.dataset.v, '通道 → ' + b.textContent); });
$('#syldSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setState('syldColorIndex', +b.dataset.v, '律动颜色'); });

const eqWrite = debounced(() => {
  const vals = EQ_HZ.map((_, i) => +$('#eq' + i).value);
  setState('equalizerHZsValue', vals, '自定义 EQ');
}, 600);
EQ_HZ.forEach((_, i) => {
  $('#eq' + i).addEventListener('input', () => { const v = +$('#eq' + i).value; $('#eqv' + i).textContent = (v > 0 ? '+' : '') + v; });
  $('#eq' + i).addEventListener('change', eqWrite);
});

$('#btnRestart').addEventListener('click', async () => {
  if (!confirm('确认重启音箱？')) return;
  const r = await API.restart();
  toast(r.ok ? '重启命令已发送' : '重启失败');
});
$('#btnReset').addEventListener('click', async () => {
  if (!confirm('确认恢复出厂设置？所有自定义配置将被清除。')) return;
  const r = await API.reset();
  toast(r.ok ? '恢复出厂已发送' : '失败');
  refresh();
});
$('#btnRefresh').addEventListener('click', refresh);
$('#btnApiBase').addEventListener('click', () => {
  const v = prompt('桥接服务地址（留空 = 同源；远程示例 https://xxx.trycloudflare.com）：', localStorage.getItem('chubApiBase') || '');
  if (v === null) return;
  v ? localStorage.setItem('chubApiBase', v.replace(/\/+$/, '')) : localStorage.removeItem('chubApiBase');
  location.reload();
});
$('#btnToken').addEventListener('click', () => {
  const v = prompt('访问令牌（服务端 CHUB_TOKEN；留空清除）：', localStorage.getItem('chubToken') || '');
  if (v === null) return;
  v ? localStorage.setItem('chubToken', v) : localStorage.removeItem('chubToken');
  toast(v ? '令牌已保存' : '令牌已清除');
});

// ---------- polling ----------
async function refresh() {
  try {
    const st = await API.state();
    if (st.error) {
      $('#dot').classList.remove('on');
      $('#devname').textContent = '音箱未连接 — 请插入 USB';
      if (st.hex) logLine('rx', 'ERR ' + st.hex);
      return;
    }
    applyState(st);
  } catch (e) {
    $('#dot').classList.remove('on');
    $('#devname').textContent = '桥接服务无响应';
  }
}
refresh();
setInterval(refresh, 4000);
