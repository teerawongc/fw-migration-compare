/* ============================================================================
   FMC Time Range — Create & Bind  v1.0
   สร้าง Time Range เข้า FMC แล้วผูกกลับเข้า Access Rule ให้อัตโนมัติ

   ทำไมต้องมีสคริปต์นี้: FMT (Firepower Migration Tool) แปลง time object ของ
   Check Point ให้ไม่ได้เลย — object หายทั้งหมด และ rule ที่เคยผูกเวลาไว้จะ
   กลายเป็นเปิดตลอด 24 ชม. ต้องมาสร้างเองทุกครั้งหลัง migrate

   วิธีใช้ (ไม่ต้องติดตั้งอะไรบนเครื่องลูกค้า):
     1. เปิด Chrome เข้าหน้าเว็บ FMC แล้ว login ตามปกติ
     2. กด F12 → แท็บ Console
     3. ถ้า Chrome ขึ้นเตือนไม่ให้วาง ให้พิมพ์  allow pasting  แล้ว Enter ก่อน
     4. วางสคริปต์นี้ทั้งหมด → Enter
     5. เลือกไฟล์ 2 ไฟล์: timeranges (.json) + mapping rule↔time (.csv)
     6. รอบแรกให้รันโหมด ทดลอง ก่อนเสมอ — จะไม่เขียนอะไรลง FMC เลย

   ต้องรันบนหน้า FMC เท่านั้น (same-origin) รันจากเว็บอื่นจะโดน CORS บล็อก

   ── ข้อเท็จจริงที่ทดสอบมาแล้วบน FMC จริง (ที่มาของ logic ในไฟล์นี้) ──────────
   • bulk create เพดาน 1000 object/request — 1001 ได้ HTTP 422
   • bulk เป็น atomic: ผิดตัวเดียว rollback ทั้งก้อน จึงต้อง validate ก่อนยิง
   • FMC บล็อกการเขียนพร้อมกัน (Parallel add/update/delete are blocked) ต้อง serial
   • ส่งมาแต่ effectiveEndDateTime ได้ FMC เติม effectiveStartDateTime = "Started" ให้เอง
   • ❗ PUT access rule เป็น full-replace: ถ้าส่ง body ไม่ครบ FMC ตอบ 200 แต่
     source/destination ที่ไม่ได้ส่งไปจะ "หายเงียบ" — สคริปต์นี้จึง GET ของเดิม
     มาทั้งก้อนก่อนเสมอ แล้วเทียบ fingerprint หลัง PUT ถ้าไม่ตรงจะหยุดทันที
   ============================================================================ */
(async () => {
'use strict';

const VER      = 'v1.0';
const LIMIT    = 1000;   // เพดานต่อ request ของ FMC
const CHUNK    = 100;    // object ต่อ 1 bulk request — เล็กกว่าเพดานเพื่อจำกัดความเสียหายเวลา rollback
const DELAY    = 250;    // หน่วงระหว่าง request — FMC จำกัด 120 req/min
const MAX_PAGES = 200;   // กันลูปไม่รู้จบถ้า API ตอบผิดรูปแบบ

const C = { i:'color:#38bdf8;font-weight:bold', ok:'color:#34d399;font-weight:bold',
            e:'color:#f87171;font-weight:bold', w:'color:#fbbf24;font-weight:bold' };
const log  = (...a) => console.log('%c[TR]', C.i,  ...a);
const good = (...a) => console.log('%c[TR]', C.ok, ...a);
const warn = (...a) => console.log('%c[TR]', C.w,  ...a);
const bad  = (...a) => console.log('%c[TR]', C.e,  ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = n => (n ?? 0).toLocaleString();

console.log('%c FMC Time Range — Create & Bind ' + VER + ' ',
            'background:#0ea5e9;color:#fff;font-size:14px;padding:3px 8px;border-radius:3px');

// ── 0. โหมดการทำงาน ────────────────────────────────────────────────────────
// ตั้งใจให้ default เป็นโหมดทดลอง — ผู้ใช้ต้องพิมพ์ go เองถึงจะเขียนของจริง
// กันเคสวางสคริปต์แล้วกด Enter รัวๆ โดยยังไม่ได้อ่านว่ามันจะทำอะไร
const mode = prompt(
  'โหมดไหน?\n\n' +
  '  dry = ทดลอง (อ่านอย่างเดียว ไม่เขียนอะไรลง FMC เลย) ← แนะนำรอบแรก\n' +
  '  go  = ทำจริง (สร้าง Time Range + แก้ Access Rule)\n', 'dry');
if (mode === null) return bad('ยกเลิก');
const DRY = !/^go$/i.test(mode.trim());
if (DRY) warn('โหมดทดลอง — จะไม่เขียนอะไรลง FMC ทั้งสิ้น');
else     warn('โหมดทำจริง — จะเขียนลง FMC จริง');

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
// คืน {status, body} เสมอ ไม่ throw เมื่อ FMC ตอบ 4xx เพราะหลายจุดต้องอ่าน
// ข้อความ error มาแสดงให้ผู้ใช้ (เช่นบอกว่า object ตัวไหนชื่อซ้ำ)
async function api(method, path, body, tries = 4) {
  for (let t = 1; t <= tries; t++) {
    let r;
    const opt = { method, headers: { 'X-auth-access-token': TOKEN } };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    try { r = await fetch(base + path, opt); }
    catch (e) { if (t === tries) throw e; await sleep(1000 * t); continue; }
    if (r.status === 429) { warn('  โดน rate limit รอ ' + (3 * t) + ' วิ...'); await sleep(3000 * t); continue; }
    if (r.status === 401) { warn('  token หมดอายุ ขอใหม่...'); await auth(); continue; }
    let j = null;
    const txt = await r.text();
    if (txt) { try { j = JSON.parse(txt); } catch (e) { j = txt; } }
    return { status: r.status, body: j, ok: r.status >= 200 && r.status < 300 };
  }
  throw new Error(path + ' — ลองซ้ำครบแล้วยังไม่สำเร็จ');
}
const errMsg = res => {
  const m = res.body && res.body.error && res.body.error.messages;
  return (m && m[0] && m[0].description) || ('HTTP ' + res.status);
};

// ── 3. ดึงทุกหน้า ──────────────────────────────────────────────────────────
// ไม่พึ่ง paging.count เพราะ FMC แต่ละเวอร์ชันตีความไม่ตรงกัน — ใช้เกณฑ์
// "หน้าไหนได้น้อยกว่า limit แปลว่าหน้าสุดท้าย" ซึ่งเชื่อถือได้กว่า
async function getAll(path, label) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await api('GET', `${path}${sep}expanded=true&limit=${LIMIT}&offset=${page * LIMIT}`);
    if (!r.ok) throw new Error(label + ' → ' + errMsg(r));
    const items = (r.body && r.body.items) || [];
    out.push(...items);
    if (page > 0 || items.length === LIMIT) log(`  ${label}: หน้า ${page + 1} +${num(items.length)} → รวม ${num(out.length)}`);
    if (items.length < LIMIT) break;
    await sleep(DELAY);
  }
  return out;
}

// ── 4. รับไฟล์จากผู้ใช้ ────────────────────────────────────────────────────
// ใช้ <input type=file> ที่ฉีดเข้าไปในหน้า แทนการให้ paste JSON ลง prompt
// เพราะ 270 object ยาวเกินกว่าที่กล่อง prompt จะรับไหว
function pickFiles() {
  return new Promise((resolve, reject) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:22px 26px;' +
      'font:13px/1.6 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6);min-width:380px';
    box.innerHTML =
      '<div style="font-size:15px;font-weight:700;margin-bottom:4px">เลือกไฟล์</div>' +
      '<div style="color:#94a3b8;margin-bottom:14px">เลือกทีเดียวได้ทั้ง 2 ไฟล์ (กด Ctrl ค้าง)</div>' +
      '<div style="margin-bottom:6px">1. Time Range — <code>.json</code></div>' +
      '<div style="margin-bottom:14px;color:#94a3b8">2. Mapping rule↔time — <code>.csv</code> (ไม่ใส่ก็ได้ = สร้าง object อย่างเดียว ไม่ผูก rule)</div>' +
      '<input type="file" multiple accept=".json,.csv,.txt" style="margin-bottom:16px">' +
      '<div style="display:flex;gap:8px"><button data-go style="flex:1;padding:8px;border:0;border-radius:6px;' +
      'background:#0ea5e9;color:#fff;font-weight:700;cursor:pointer">ต่อไป</button>' +
      '<button data-x style="padding:8px 14px;border:1px solid #334155;border-radius:6px;background:#1e293b;' +
      'color:#e2e8f0;cursor:pointer">ยกเลิก</button></div>';
    document.body.appendChild(box);
    const inp = box.querySelector('input');
    box.querySelector('[data-x]').onclick = () => { box.remove(); reject(new Error('ยกเลิก')); };
    box.querySelector('[data-go]').onclick = async () => {
      const files = [...(inp.files || [])];
      if (!files.length) { inp.style.outline = '2px solid #f87171'; return; }
      const out = {};
      for (const f of files) out[f.name] = await f.text();
      box.remove();
      resolve(out);
    };
  });
}

// ── 5. อ่านไฟล์ Time Range ─────────────────────────────────────────────────
// รับได้ทั้ง JSON array ปกติ และแบบ object ต่อกันไม่มี comma (ที่ FMC เองก็รับ)
// เพราะไฟล์ที่เครื่องมือรุ่นก่อนหน้า generate ไว้เป็นแบบหลัง
function parseObjects(text) {
  const out = [];
  let i = 0, s = text.replace(/^﻿/, '');
  while (i < s.length) {
    while (i < s.length && ' \t\r\n,[]'.includes(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] !== '{') throw new Error('อ่าน JSON ไม่ออกที่ตัวอักษรที่ ' + i);
    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) { j++; break; } }
    }
    out.push(JSON.parse(s.slice(i, j)));
    i = j;
  }
  return out;
}

// ── 6. อ่าน CSV mapping ────────────────────────────────────────────────────
// รองรับ , และ ; รวมถึงค่าที่ครอบด้วย " " และ BOM ที่ Excel ชอบใส่มา
function parseCSV(text) {
  const s = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(v => v.trim()))
             .map(r => Object.fromEntries(head.map((h, k) => [h, (r[k] || '').trim()])));
}
// หาคอลัมน์แบบยืดหยุ่น เผื่อผู้ใช้เปลี่ยนหัวตารางเอง
function pickCol(row, cands) {
  const keys = Object.keys(row);
  for (const c of cands) {
    const hit = keys.find(k => k.toLowerCase().replace(/[\s_]/g, '') === c.toLowerCase().replace(/[\s_]/g, ''));
    if (hit) return hit;
  }
  return null;
}

// ── 7. โหลดและตรวจไฟล์ ─────────────────────────────────────────────────────
let files;
try { files = await pickFiles(); } catch (e) { return bad(e.message); }

const jsonName = Object.keys(files).find(n => /\.json$/i.test(n));
const csvName  = Object.keys(files).find(n => /\.csv$/i.test(n));
if (!jsonName) return bad('ไม่พบไฟล์ .json ของ Time Range');

let trList;
try { trList = parseObjects(files[jsonName]); }
catch (e) { return bad('ไฟล์ ' + jsonName + ' อ่านไม่ได้: ' + e.message); }
log('อ่าน ' + jsonName + ' ได้ ' + num(trList.length) + ' object');

let mapRows = [];
if (csvName) { mapRows = parseCSV(files[csvName]); log('อ่าน ' + csvName + ' ได้ ' + num(mapRows.length) + ' แถว'); }
else warn('ไม่ได้เลือกไฟล์ CSV — จะสร้าง Time Range อย่างเดียว ไม่ผูกเข้า rule');

// ── 8. validate ก่อนยิง ────────────────────────────────────────────────────
// bulk เป็น atomic — ผิดตัวเดียวพังทั้งก้อน จึงต้องกรองให้หมดตั้งแต่ตรงนี้
// ไม่ใช่ปล่อยให้ FMC ตีกลับแล้วมานั่งไล่ว่าตัวไหนคือตัวปัญหา
const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const problems = [];
const seen = new Set();
for (const [i, o] of trList.entries()) {
  const at = '#' + (i + 1) + ' ' + (o.name || '(ไม่มีชื่อ)');
  if (!o.name) problems.push(at + ' — ไม่มี name');
  else if (seen.has(o.name)) problems.push(at + ' — ชื่อซ้ำกันเองในไฟล์');
  else seen.add(o.name);
  if (o.type && o.type !== 'TimeRange') problems.push(at + ' — type ต้องเป็น TimeRange ไม่ใช่ ' + o.type);
  for (const k of ['effectiveStartDateTime', 'effectiveEndDateTime'])
    if (o[k] && !DT.test(o[k])) problems.push(at + ' — ' + k + ' ต้องเป็น YYYY-MM-DDTHH:mm (ห้ามมีวินาที/timezone) ได้ ' + o[k]);
  if (o.effectiveStartDateTime && o.effectiveEndDateTime && o.effectiveEndDateTime <= o.effectiveStartDateTime)
    problems.push(at + ' — วันสิ้นสุดต้องหลังวันเริ่ม');
}
if (problems.length) {
  bad('ไฟล์มีปัญหา ' + problems.length + ' จุด — แก้ก่อนแล้วรันใหม่ (ยังไม่ได้แตะ FMC):');
  problems.slice(0, 30).forEach(p => console.log('   • ' + p));
  if (problems.length > 30) console.log('   ... อีก ' + (problems.length - 30) + ' จุด');
  return;
}
good('validate ผ่าน ' + num(trList.length) + ' object');

const noDate = trList.filter(o => !o.effectiveStartDateTime && !o.effectiveEndDateTime);
if (noDate.length) warn(noDate.length + ' object ไม่มีวันที่เลย → FMC จะเก็บเป็น "Started → Never End" = เปิดตลอด ' +
                        'ต้องกลับมาใส่วันจริงก่อน cutover: ' + noDate.map(o => o.name).join(', '));

// ── 9. เฟส 1 — สร้าง Time Range ที่ยังไม่มี ────────────────────────────────
log('อ่าน Time Range ที่มีอยู่แล้วใน FMC...');
const existing = await getAll('/object/timeranges', 'timeranges');
const byName = new Map(existing.map(o => [o.name, o]));
good('FMC มีอยู่แล้ว ' + num(existing.length) + ' ตัว');

const toCreate = trList.filter(o => !byName.has(o.name));
const already  = trList.length - toCreate.length;
if (already) log('ข้าม ' + num(already) + ' ตัวที่มีชื่อนี้ใน FMC อยู่แล้ว');

if (toCreate.length) {
  log('ต้องสร้างใหม่ ' + num(toCreate.length) + ' ตัว (ทีละ ' + CHUNK + ')');
  if (DRY) {
    warn('โหมดทดลอง — ข้ามการสร้างจริง');
    toCreate.slice(0, 5).forEach(o => console.log('   จะสร้าง: ' + o.name + '  ' +
      (o.effectiveStartDateTime || 'Started') + ' → ' + (o.effectiveEndDateTime || 'Never End')));
    if (toCreate.length > 5) console.log('   ... อีก ' + (toCreate.length - 5) + ' ตัว');
  } else {
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const slice = toCreate.slice(i, i + CHUNK).map(o => ({ ...o, type: 'TimeRange' }));
      const r = await api('POST', '/object/timeranges?bulk=true', slice);
      if (!r.ok) {
        bad('ก้อนที่เริ่มจากตัวที่ ' + (i + 1) + ' ล้มเหลว: ' + errMsg(r));
        bad('bulk เป็น atomic → ทั้งก้อน ' + slice.length + ' ตัวไม่ถูกสร้าง กำลังไล่ยิงทีละตัวเพื่อหาตัวปัญหา...');
        for (const o of slice) {
          const one = await api('POST', '/object/timeranges', { ...o, type: 'TimeRange' });
          if (!one.ok) bad('   ✗ ' + o.name + ' — ' + errMsg(one));
          else { byName.set(o.name, one.body); }
          await sleep(60);
        }
        continue;
      }
      (r.body.items || []).forEach(o => byName.set(o.name, o));
      good('  สร้างแล้ว ' + num(Math.min(i + CHUNK, toCreate.length)) + '/' + num(toCreate.length));
      await sleep(DELAY);
    }
  }
} else good('Time Range ครบอยู่แล้ว ไม่ต้องสร้างเพิ่ม');

if (!mapRows.length) { good('เสร็จ — ไม่ได้เลือกไฟล์ mapping จึงไม่ผูก rule'); return; }

// ── 10. เลือก Access Policy ────────────────────────────────────────────────
const pol = await api('GET', '/policy/accesspolicies?limit=1000');
const policies = (pol.body && pol.body.items) || [];
if (!policies.length) return bad('ไม่พบ Access Policy บน FMC');
let policy = policies[0];
if (policies.length > 1) {
  const ans = prompt('เลือก Access Policy:\n\n' +
    policies.map((p, i) => (i + 1) + '. ' + p.name).join('\n') + '\n\nพิมพ์เลข', '1');
  if (ans === null) return bad('ยกเลิก');
  policy = policies[parseInt(ans.trim(), 10) - 1];
  if (!policy) return bad('เลขไม่ถูกต้อง');
}
good('Access Policy: ' + policy.name);

// ── 11. โหลด rule ทั้งหมด ──────────────────────────────────────────────────
log('โหลด Access Rule ทั้งหมด...');
const rules = await getAll('/policy/accesspolicies/' + policy.id + '/accessrules', 'accessrules');
good('มี ' + num(rules.length) + ' rule');

// ── 12. จับคู่ rule ↔ time range ───────────────────────────────────────────
// คอลัมน์ชื่อ FMC_Rule_Name_Prefix เพราะ FMT ชอบแตก rule เดียวของ CP ออกเป็น
// หลาย rule (Rule_#8 → Rule_#8_1, Rule_#8_2) จึงต้องจับแบบขึ้นต้นด้วย ไม่ใช่เท่ากับ
const c0 = mapRows[0];
const colRule = pickCol(c0, ['FMC_Rule_Name_Prefix', 'FMC_Rule', 'Rule_Name', 'Rule']);
const colTR   = pickCol(c0, ['Time_Range_Object', 'TimeRange', 'Time_Range', 'TR']);
if (!colRule || !colTR)
  return bad('CSV ไม่มีคอลัมน์ที่ต้องการ — ต้องมี FMC_Rule_Name_Prefix และ Time_Range_Object (พบ: ' + Object.keys(c0).join(', ') + ')');
log('ใช้คอลัมน์ "' + colRule + '" ↔ "' + colTR + '"');

const plan = new Map();     // ruleId → { rule, names:Set }
const unmatched = [];
for (const row of mapRows) {
  const prefix = row[colRule], trName = row[colTR];
  if (!prefix || !trName) continue;
  const hits = rules.filter(r => r.name === prefix || r.name.startsWith(prefix + '_'));
  if (!hits.length) { unmatched.push(prefix + ' → ' + trName); continue; }
  if (!byName.has(trName)) { unmatched.push(prefix + ' → ' + trName + ' (ไม่มี Time Range ชื่อนี้)'); continue; }
  for (const r of hits) {
    if (!plan.has(r.id)) plan.set(r.id, { rule: r, names: new Set() });
    plan.get(r.id).names.add(trName);
  }
}
good('จับคู่ได้ ' + num(plan.size) + ' rule จาก mapping ' + num(mapRows.length) + ' แถว');
if (unmatched.length) {
  warn('จับคู่ไม่ได้ ' + unmatched.length + ' แถว:');
  unmatched.slice(0, 20).forEach(u => console.log('   • ' + u));
  if (unmatched.length > 20) console.log('   ... อีก ' + (unmatched.length - 20) + ' แถว');
}
if (!plan.size) return bad('ไม่มี rule ให้ผูก — ตรวจว่าชื่อ rule ใน CSV ตรงกับใน FMC ไหม');

// ── 13. fingerprint กันข้อมูลหาย ───────────────────────────────────────────
// PUT ของ FMC เป็น full-replace ถ้า body ขาด field ไหน field นั้นจะถูกลบทิ้ง
// โดยตอบ 200 เฉยๆ ไม่เตือนอะไรเลย — นับของสำคัญไว้ก่อนแล้วเทียบหลัง PUT
const CNT = ['sourceNetworks','destinationNetworks','sourcePorts','destinationPorts',
             'sourceZones','destinationZones','applications','urls','vlanTags','users'];
function fp(r) {
  const o = { action: r.action, enabled: r.enabled, name: r.name };
  for (const k of CNT) {
    const v = r[k];
    o[k] = v ? ((v.objects || []).length + (v.literals || []).length) : 0;
  }
  return JSON.stringify(o);
}

// ── 14. เฟส 2 — ผูกเข้า rule ───────────────────────────────────────────────
const report = [['rule_name','rule_id','time_ranges','result','detail']];
let okN = 0, skipN = 0, failN = 0;
const t0 = Date.now();
let idx = 0;

for (const [rid, item] of plan) {
  idx++;
  const want = [...item.names];
  const label = '[' + idx + '/' + plan.size + '] ' + item.rule.name;

  // ต้อง GET ตัวเต็มก่อนเสมอ — ตัวที่ได้จาก list ยังไม่ครบทุก field
  const g = await api('GET', '/policy/accesspolicies/' + policy.id + '/accessrules/' + rid);
  if (!g.ok) { failN++; bad(label + ' — อ่าน rule ไม่ได้: ' + errMsg(g));
               report.push([item.rule.name, rid, want.join('|'), 'FAIL', 'GET ' + errMsg(g)]); continue; }

  const cur = g.body;
  const have = (cur.timeRangeObjects || []).map(o => o.name);
  const merged = [...new Set([...have, ...want])];
  if (merged.length === have.length && want.every(n => have.includes(n))) {
    skipN++; log(label + ' — ผูกไว้อยู่แล้ว ข้าม');
    report.push([item.rule.name, rid, want.join('|'), 'SKIP', 'มีอยู่แล้ว']); continue;
  }
  if (merged.length > 1)
    warn(label + ' — จะมี Time Range ' + merged.length + ' ตัวบน rule เดียว (' + merged.join(', ') + ')');

  if (DRY) {
    okN++; log(label + ' — จะผูก: ' + want.join(', '));
    report.push([item.rule.name, rid, want.join('|'), 'DRY', 'จะผูก ' + merged.join('|')]); continue;
  }

  // ส่ง body เดิมทั้งก้อน ตัดเฉพาะ metadata/links ที่เป็นของอ่านอย่างเดียว
  const body = JSON.parse(JSON.stringify(cur));
  delete body.metadata; delete body.links;
  body.timeRangeObjects = merged.map(n => ({ id: byName.get(n).id, name: n, type: 'TimeRange' }));

  const before = fp(cur);
  const p = await api('PUT', '/policy/accesspolicies/' + policy.id + '/accessrules/' + rid, body);
  if (!p.ok) { failN++; bad(label + ' — PUT ไม่ผ่าน: ' + errMsg(p));
               report.push([item.rule.name, rid, want.join('|'), 'FAIL', 'PUT ' + errMsg(p)]); continue; }

  // อ่านกลับมาเทียบ — ถ้าของหายต้องหยุดทั้งงานทันที ไม่ใช่ปล่อยพังไปเรื่อยๆ
  const v = await api('GET', '/policy/accesspolicies/' + policy.id + '/accessrules/' + rid);
  const after = v.ok ? fp(v.body) : null;
  if (after !== before) {
    failN++;
    bad(label + ' — ⚠ ข้อมูลใน rule เปลี่ยนไปหลัง PUT! หยุดทั้งงานเพื่อไม่ให้เสียหายเพิ่ม');
    console.log('   ก่อน: ' + before);
    console.log('   หลัง: ' + after);
    report.push([item.rule.name, rid, want.join('|'), 'ABORT', 'fingerprint ไม่ตรง']);
    break;
  }
  const got = (v.body.timeRangeObjects || []).map(o => o.name);
  if (!want.every(n => got.includes(n))) {
    failN++; bad(label + ' — PUT ผ่านแต่ Time Range ไม่ติด: ' + got.join(', '));
    report.push([item.rule.name, rid, want.join('|'), 'FAIL', 'ไม่ติด ได้ ' + got.join('|')]); continue;
  }

  okN++;
  if (idx % 25 === 0 || idx === plan.size) {
    const el = (Date.now() - t0) / 1000;
    good('  ' + idx + '/' + plan.size + ' — ' + Math.round(el) + ' วิ ' +
         '(เหลืออีกราว ' + Math.round(el / idx * (plan.size - idx)) + ' วิ)');
  }
  report.push([item.rule.name, rid, want.join('|'), 'OK', got.join('|')]);
  await sleep(60);
}

// ── 15. สรุป + ดาวน์โหลดรายงาน ─────────────────────────────────────────────
console.log('%c─────────────────────────────', C.i);
good('สำเร็จ ' + num(okN) + ' · ข้าม ' + num(skipN) + ' · ล้มเหลว ' + num(failN) +
     ' · ใช้เวลา ' + Math.round((Date.now() - t0) / 1000) + ' วิ');
if (DRY) warn('นี่คือโหมดทดลอง — ยังไม่มีอะไรถูกเขียนลง FMC จริง รันใหม่แล้วพิมพ์ go เพื่อทำจริง');
else     warn('อย่าลืม Deploy policy ที่ FMC ถึงจะมีผลกับ firewall จริง');

const csv = report.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'timerange_bind_report_' + new Date().toISOString().slice(0, 10) + '.csv';
a.click();
setTimeout(() => URL.revokeObjectURL(a.href), 5000);
log('ดาวน์โหลดรายงานแล้ว: ' + a.download);
window.TR_RESULT = { policy: policy.name, ok: okN, skip: skipN, fail: failN, report };
log('ผลลัพธ์เต็มอยู่ใน window.TR_RESULT');

})();
