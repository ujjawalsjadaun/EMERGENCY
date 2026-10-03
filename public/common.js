const EMOJI = {Medical:"🚑",Electrical:"⚡",Infrastructure:"🔧",Security:"🔐","Lost & Found":"🎒",Other:"🆘"};
const COLORS = {Low:"#2e9e6b",Medium:"#d9a400",High:"#e8740c",Critical:"#d92d20"};
// Schematic campus map (viewBox 0..100 x 0..70). Zones double as location presets.
const ZONES = [
  {n:"Main Gate",x:50,y:64,w:14,h:8},{n:"Admin Block",x:50,y:48,w:16,h:10},{n:"Academic Block",x:22,y:42,w:22,h:14},
  {n:"Library",x:50,y:26,w:16,h:10},{n:"Medical Center",x:80,y:46,w:15,h:9},{n:"Hostel A",x:18,y:14,w:18,h:11},
  {n:"Hostel B",x:80,y:14,w:18,h:11},{n:"Canteen",x:78,y:30,w:14,h:8},{n:"Sports Ground",x:20,y:60,w:24,h:12}];
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = t => new Date(t*1000).toLocaleString();
async function api(path, opts={}) {
  const token = sessionStorage.getItem("token");
  const r = await fetch(path, {...opts, headers:{"Content-Type":"application/json", ...(token?{Authorization:"Bearer "+token}:{}), ...opts.headers},
    body: opts.body ? JSON.stringify(opts.body) : undefined});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), {status:r.status});
  return j;
}
function toast(msg) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.append(t); }
  const d = document.createElement("div"); d.textContent = msg; t.append(d); setTimeout(() => d.remove(), 6000);
  if (window.Notification && Notification.permission === "granted") try { new Notification("Campus Assist", {body: msg}); } catch {}
}
function mapSVG(pins=[], {heat=false}={}) {
  const zones = ZONES.map(z => `<rect x="${z.x-z.w/2}" y="${z.y-z.h/2}" width="${z.w}" height="${z.h}" rx="1.5" fill="#fff8" stroke="#8a9a80" stroke-width=".3"/>
    <text x="${z.x}" y="${z.y+.8}" font-size="2.2" text-anchor="middle" fill="#445">${z.n}</text>`).join("");
  const road = `<path d="M50 70V0M0 36H100" stroke="#cfd5c4" stroke-width="2.5" fill="none"/>`;
  const W = {Low:.5, Medium:.8, High:1.1, Critical:1.5};
  const items = pins.filter(p => p.x != null).map(p => heat
    ? `<circle cx="${p.x}" cy="${p.y}" r="${7*(W[p.priority]||1)}" fill="url(#h)"/>`
    : `${p.sos || p.priority === "Critical" ? `<circle cx="${p.x}" cy="${p.y}" r="1.7" fill="none" stroke="${COLORS.Critical}" stroke-width=".4"><animate attributeName="r" values="1.7;6" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="indefinite"/></circle>` : ""}
       <circle cx="${p.x}" cy="${p.y}" r="1.7" fill="${COLORS[p.priority]||"#2f5bea"}" stroke="#fff" stroke-width=".4"><title>${esc(p.id)} ${esc(p.category)} - ${esc(p.status)}</title></circle>`).join("");
  return `<defs><radialGradient id="h"><stop offset="0" stop-color="#d92d20" stop-opacity=".4"/><stop offset="1" stop-color="#d92d20" stop-opacity="0"/></radialGradient></defs>${road}${zones}${items}`;
}
function nearestZone(x, y) {
  return ZONES.reduce((b, z) => Math.hypot(z.x-x, z.y-y) < Math.hypot(b.x-x, b.y-y) ? z : b).n;
}
function svgPoint(svg, ev) {
  const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse()); return {x: +q.x.toFixed(1), y: +q.y.toFixed(1)};
}
function timeline(h) {
  return `<ul class="timeline">${[...h].reverse().map(e => `<li><b>${esc(e.status)}</b> <span class="muted">${fmt(e.t)}</span><br>${esc(e.note)}</li>`).join("")}</ul>`;
}

const clientId = (() => { try { let c = localStorage.getItem("cid"); if (!c) { c = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("cid", c); } return c; } catch { return "anon" + Math.random(); } })();
const mmss = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec/60) + ":" + String(sec%60).padStart(2, "0"); };
function chatHTML(msgs, who) {
  return `<div class="chat">${msgs.map(m => `<div class="msg ${m.from === who ? "me" : ""}"><small>${m.from === "authority" ? "🛡️ Responder" : "🙋 Student"} · ${new Date(m.t*1000).toLocaleTimeString()}</small>${esc(m.text)}</div>`).join("") || '<span class="muted">No messages yet.</span>'}</div>`;
}
let _ac; // siren for critical alerts
function siren() {
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(), g = _ac.createGain(); o.connect(g); g.connect(_ac.destination); g.gain.value = .15;
    const t = _ac.currentTime; for (let k = 0; k < 6; k++) o.frequency.setValueAtTime(k % 2 ? 660 : 880, t + k * .25);
    o.start(t); o.stop(t + 1.5);
  } catch {}
}
