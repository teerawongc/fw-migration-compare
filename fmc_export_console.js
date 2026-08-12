/* ============================================================================
   FMC Bulk Export  v1.2  —  ดึง config จาก FMC ครบทุกหน้าในครั้งเดียว

   ปัญหาที่แก้: FMC REST API จำกัด limit=1000 ต่อ 1 request ถ้ามี 8,000 object
   ต้องยิงเอง 8 ครั้งแล้วมานั่งรวมไฟล์ — สคริปต์นี้วน offset ให้อัตโนมัติจนครบ
   แล้วรวมเป็นไฟล์เดียวต่อ section (ได้ 4 ไฟล์ ตรงกับ 4 แท็บของ Comparator)

   วิธีใช้ (ไม่ต้องติดตั้งอะไรบนเครื่องลูกค้า):
     1. เปิด Chrome เข้าหน้าเว็บ FMC แล้ว login ตามปกติ
     2. กด F12 → แท็บ Console
     3. ถ้า Chrome ขึ้นเตือนไม่ให้วาง ให้พิมพ์  allow pasting  แล้ว Enter ก่อน
     4. วางสคริปต์นี้ทั้งหมด → Enter
     5. ใส่ username / password ของ FMC (ต้องมีสิทธิ์ REST API)
     6. รอจนขึ้น "เสร็จสมบูรณ์" — Chrome จะถามว่าดาวน์โหลดหลายไฟล์ไหม กด Allow

   ต้องรันบนหน้า FMC เท่านั้น (same-origin) รันจากเว็บอื่นจะโดน CORS บล็อก
   ============================================================================ */
(async () => {
'use strict';

const VER = 'v1.2';
const LIMIT = 1000;        // เพดานต่อ request ของ FMC
const DELAY = 250;         // หน่วงระหว่าง request — FMC จำกัด 120 req/min
const MAX_PAGES = 200;     // กันลูปไม่รู้จบถ้า API ตอบผิดรูปแบบ

const C = { i:'color:#38bdf8;font-weight:bold', ok:'color:#34d399;font-weight:bold',
            e:'color:#f87171;font-weight:bold', w:'color:#fbbf24;font-weight:bold' };
const log  = (...a) => console.log('%c[FMC]', C.i,  ...a);
const good = (...a) => console.log('%c[FMC]', C.ok, ...a);
const warn = (...a) => console.log('%c[FMC]', C.w,  ...a);
const bad  = (...a) => console.log('%c[FMC]', C.e,  ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = n => (n ?? 0).toLocaleString();

console.log('%c FMC Bulk Export ' + VER + ' ', 'background:#0ea5e9;color:#fff;font-size:14px;padding:3px 8px;border-radius:3px');

// ── 1. ขอ token ────────────────────────────────────────────────────────────
// FMC REST API ใช้ X-auth-access-token ไม่ใช่ cookie ของหน้าเว็บ จึงต้อง
// generatetoken ก่อน แม้จะ login หน้าเว็บอยู่แล้วก็ตาม
const user = prompt('FMC username (ต้องมีสิทธิ์ REST API)');
if (!user) return bad('ยกเลิก');
const pass = prompt('FMC password ของ ' + user);
if (!pass) return bad('ยกเลิก');

let TOKEN = null, DOMAIN = null;

async function auth() {
  const r = await fetch('/api/fmc_platform/v1/auth/generatetoken', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + btoa(user + ':' + pass) }
  });
  if (!r.ok) throw new Error('login ไม่ผ่าน (HTTP ' + r.status + ') — ตรวจ user/password และสิทธิ์ REST API');
  TOKEN = r.headers.get('X-auth-access-token');
  if (!TOKEN) throw new Error('ไม่ได้ token กลับมา — ถ้ารันจากหน้าอื่นที่ไม่ใช่ FMC เบราว์เซอร์จะซ่อน header นี้');
  if (!DOMAIN) {
    DOMAIN = r.headers.get('DOMAIN_UUID');
    if (!DOMAIN) {                       // บาง build ส่ง list มาแทน
      try { DOMAIN = (JSON.parse(r.headers.get('DOMAINS') || '[]')[0] || {}).uuid; } catch (e) {}
    }
  }
  if (!DOMAIN) throw new Error('หา DOMAIN_UUID ไม่เจอ');
}

try { await auth(); } catch (e) { return bad(e.message); }
const base = '/api/fmc_config/v1/domain/' + DOMAIN;
good('login สำเร็จ — domain', DOMAIN);

// ── 2. ตัวเรียก API พร้อม retry ────────────────────────────────────────────
// 429 = โดน rate limit ให้ถอยแล้วลองใหม่, 401 = token หมดอายุให้ขอใหม่
// 404/405 = endpoint ไม่มีใน FMC เวอร์ชันนี้ (เช่น tcpportobjects บน 7.6.5) ให้ข้าม
async function api(path, tries = 4) {
  for (let t = 1; t <= tries; t++) {
    let r;
    try { r = await fetch(path, { headers: { 'X-auth-access-token': TOKEN } }); }
    catch (e) { if (t === tries) throw e; await sleep(1000 * t); continue; }
    if (r.status === 404 || r.status === 405) return null;
    if (r.status === 429) { warn('  โดน rate limit รอ ' + (3 * t) + ' วิ...'); await sleep(3000 * t); continue; }
    if (r.status === 401) { warn('  token หมดอายุ ขอใหม่...'); await auth(); continue; }
    if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
    return r.json();
  }
  throw new Error(path + ' — ลองซ้ำครบแล้วยังไม่สำเร็จ');
}

// ── 3. ดึงทุกหน้า ──────────────────────────────────────────────────────────
// ไม่พึ่ง paging.count เพราะ FMC แต่ละเวอร์ชันตีความไม่ตรงกัน (บางตัว count คือ
// จำนวนทั้งหมด บางตัวคือจำนวนในหน้านั้น) — ใช้เกณฑ์ที่เชื่อถือได้กว่าคือ
// "หน้าไหนได้น้อยกว่า limit แปลว่าหน้าสุดท้าย"
async function getAll(url, label) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const j = await api(`${url}${sep}expanded=true&limit=${LIMIT}&offset=${page * LIMIT}`);
    if (j === null) { warn(`  ${label}: ไม่มี endpoint นี้ใน FMC เวอร์ชันนี้ — ข้าม`); return []; }
    const items = j.items || [];
    out.push(...items);
    log(`  ${label}: หน้า ${page + 1} +${num(items.length)} → รวม ${num(out.length)}`);
    if (items.length < LIMIT) break;
    await sleep(DELAY);
  }
  return out;
}

// ── 4. เลือก policy เมื่อมีหลายอัน ─────────────────────────────────────────
async function listPolicies(kind) {
  const j = await api(`${base}/policy/${kind}?limit=1000&offset=0`);
  return (j && j.items) || [];
}
function choose(items, label) {
  if (!items.length) { warn('ไม่พบ ' + label + ' — ข้าม'); return []; }
  if (items.length === 1) { log(label + ': ' + items[0].name); return items; }
  const ans = prompt(
    `พบ ${label} ${items.length} รายการ:\n\n` +
    items.map((p, i) => `${i + 1}. ${p.name}`).join('\n') +
    `\n\nพิมพ์เลขที่ต้องการ (คั่นด้วย , ) หรือ all = เอาทั้งหมด`, 'all');
  if (ans === null) throw new Error('ยกเลิก');
  if (/^all$/i.test(ans.trim())) return items;
  return ans.split(',').map(s => items[parseInt(s.trim(), 10) - 1]).filter(Boolean);
}

// ── 5. นิยามแต่ละ section ──────────────────────────────────────────────────
const dedupe = arr => {
  const seen = new Set();
  return arr.filter(o => {
    const k = o && o.id;
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
};

const SECTIONS = {
  policy: async () => {
    const pols = choose(await listPolicies('accesspolicies'), 'Access Control Policy');
    let all = [];
    for (const p of pols) {
      const rules = await getAll(`${base}/policy/accesspolicies/${p.id}/accessrules`, `accessrules [${p.name}]`);
      rules.forEach(r => { r._policyName = p.name; });
      all = all.concat(rules);
    }
    return all;
  },
  nat: async () => {
    const pols = choose(await listPolicies('ftdnatpolicies'), 'NAT Policy');
    let all = [];
    for (const p of pols) {
      for (const kind of ['manualnatrules', 'autonatrules']) {
        const rules = await getAll(`${base}/policy/ftdnatpolicies/${p.id}/${kind}`, `${kind} [${p.name}]`);
        rules.forEach(r => { r._policyName = p.name; });
        all = all.concat(rules);
      }
    }
    return all;
  },
  objects: async () => {
    let all = [];
    for (const e of ['hosts', 'networks', 'ranges', 'networkgroups'])
      all = all.concat(await getAll(`${base}/object/${e}`, e));
    return dedupe(all);
  },
  services: async () => {
    // protocolportobjects = ทางใหม่ (รวม TCP+UDP ในตัวเดียว แยกด้วย field protocol)
    // tcp/udpportobjects = ทางเก่า ไม่มีแล้วบน FMC 7.x
    // ยิงตัวใหม่ก่อน ได้ผลแล้วไม่ต้องแตะตัวเก่า — เดิมยิงทั้งหมดแล้วค่อย dedupe
    // ซึ่งได้ผลถูกต้องแต่ Chrome จะขึ้น 404 สีแดงใน Console 2 บรรทัดทุกครั้ง
    // (เบราว์เซอร์ log ระดับ network ห้ามไม่ได้แม้โค้ดจะ catch แล้ว) ดูเหมือนพัง
    let all = await getAll(`${base}/object/protocolportobjects`, 'protocolportobjects');
    if (!all.length) {
      warn('  ไม่มี protocolportobjects — ถอยไปใช้ endpoint แยกแบบเก่า');
      for (const e of ['tcpportobjects', 'udpportobjects'])
        all = all.concat(await getAll(`${base}/object/${e}`, e));
    }
    // icmpv6objects ลืมใส่ใน v1.0/v1.1 — CP มี icmpv6_service อยู่ 24 ตัวที่ GHB
    // พอไม่ดึงมา เครื่องมือเทียบเลยรายงานว่า "Missing FMC" ทั้งหมดทั้งที่ migrate ไปแล้ว
    for (const e of ['icmpv4objects', 'icmpv6objects', 'portobjectgroups'])
      all = all.concat(await getAll(`${base}/object/${e}`, e));
    return dedupe(all);
  }
};

// ── 6. ดาวน์โหลด ───────────────────────────────────────────────────────────
function download(name, items) {
  const blob = new Blob([JSON.stringify({ items }, null, 0)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ── 7. รัน ─────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().slice(0, 10);
const result = {};
const t0 = Date.now();

for (const [sec, fn] of Object.entries(SECTIONS)) {
  console.group('%c▶ ' + sec, C.i);
  try {
    result[sec] = await fn();
    good(`${sec}: ${num(result[sec].length)} รายการ`);
  } catch (e) {
    bad(`${sec} ล้มเหลว: ${e.message}`);
    result[sec] = [];
  }
  console.groupEnd();
}

// เก็บไว้บน window เผื่อ Chrome บล็อกดาวน์โหลด จะได้ไม่ต้องดึงใหม่
window.FMC_EXPORT = result;

Object.entries(result).forEach(([sec, items]) => {
  if (!items.length) return;
  download(`fmc_${sec}_${stamp}.json`, items);
});

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log('%c เสร็จสมบูรณ์ ใน ' + secs + ' วินาที ',
  'background:#059669;color:#fff;font-size:14px;padding:3px 8px;border-radius:3px');
console.table(Object.entries(result).map(([k, v]) => ({ section: k, items: v.length })));
log('ถ้าไฟล์ไม่ถูกดาวน์โหลด (Chrome บล็อก) ข้อมูลยังอยู่ใน window.FMC_EXPORT');
log('ดาวน์โหลดซ้ำทีละอัน:  copy(JSON.stringify({items:window.FMC_EXPORT.objects}))');

})();
