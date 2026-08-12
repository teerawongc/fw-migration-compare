/* ทดสอบ fw_policy_compare.html ด้วย jsdom
   รัน:  npm i jsdom --no-save  &&  node test/ui.test.mjs                       */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// REPO_ROOT ใช้ตอนต้องรันสคริปต์จากที่อื่น (เช่น jsdom ติดตั้งอยู่คนละโฟลเดอร์)
const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(ROOT, 'fw_policy_compare.html');
const jsPath = path.join(ROOT, 'fmc_export_console.js');

const html = fs.readFileSync(htmlPath, 'utf8');
// เลขเวอร์ชันอ่านจากไฟล์เอง ไม่ hardcode — ไม่งั้นเทสจะแดงทุกครั้งที่ bump version
const WANT_VER = html.match(/const VER = '(v3\.[\d.]+)';/)[1];
// git บน Windows แปลงไฟล์เป็น CRLF ตอน checkout ทำให้เทียบกับที่ฝังใน HTML (LF) ไม่ตรง
// ทั้งที่เนื้อหาเหมือนกัน จึงตัด CR ออกก่อนเทียบ
const noCR = t => t.split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.dev/' });
const { window } = dom;
await new Promise(r => {
  if (window.document.readyState === 'complete') return r();
  window.addEventListener('load', r); setTimeout(r, 3000);
});
const $ = id => window.document.getElementById(id);

console.log('\n=== หน้าโหลดขึ้น ===');
ok(`เลขเวอร์ชันมุมบนอัปเดตจาก JS (${WANT_VER})`, $('ver').textContent === WANT_VER);
ok('ชื่อแท็บเบราว์เซอร์ตรงกับ const VER', window.document.title.includes(WANT_VER));
ok('ปุ่ม FMC Export มีอยู่จริง', !!$('exp-btn'));
ok('modal เริ่มต้นปิดอยู่', !$('exp-overlay').classList.contains('open'));
ok('กล่องโค้ดยังว่าง (lazy render)', $('exp-code').textContent === '');

console.log('\n=== เปิด modal ===');
window.toggleExp(true);
const code = $('exp-code').textContent;
ok('modal เปิด', $('exp-overlay').classList.contains('open'));
ok('โค้ดถูกใส่ในกล่อง', code.length > 5000);
ok(`ป้ายบอกขนาด: ${$('exp-size').textContent}`, /บรรทัด/.test($('exp-size').textContent));

console.log('\n=== โค้ดที่ผู้ใช้จะ copy ไปวาง Console ===');
const orig = fs.readFileSync(jsPath, 'utf8').trim();
ok('ตรงกับไฟล์ต้นฉบับ (ไม่สน CRLF/LF)', noCR(code) === noCR(orig));
ok('ไม่มี HTML entity หลงเหลือ', !/&(amp|lt|gt|quot);/.test(code));
let syntaxOk = true;
try { new window.Function(code); } catch (e) { syntaxOk = false; console.log('     → ' + e.message); }
ok('syntax ถูกต้อง รันได้', syntaxOk);
ok('มี logic วน offset อัตโนมัติ', code.includes('offset=${page * LIMIT}'));
ok('มี retry เมื่อโดน rate limit 429', code.includes('429'));
// ต้องจับที่ตัวโค้ด ไม่ใช่ indexOf ทั้งไฟล์ เพราะคอมเมนต์ด้านบนก็มีคำเหล่านี้
const svcFn = code.slice(code.indexOf('services: async'));
ok('ยิง protocolportobjects ก่อน',
   svcFn.includes('let all = await getAll(`${base}/object/protocolportobjects`'));
ok('ถอยไป tcp/udp เฉพาะตอนตัวใหม่ไม่มีข้อมูล',
   svcFn.indexOf('if (!all.length)') < svcFn.indexOf("'tcpportobjects'"));

console.log('\n=== ปิด modal / ไม่กระทบ help modal เดิม ===');
window.toggleExp(false);
ok('exp modal ปิด', !$('exp-overlay').classList.contains('open'));
window.toggleHelp(true);
ok('help modal ยังเปิดได้', $('help-overlay').classList.contains('open'));
window.toggleHelp(false);
ok('help modal ยังปิดได้', !$('help-overlay').classList.contains('open'));

console.log('\n=== ฟังก์ชันหลักยังอยู่ครบ ===');
['runCmp', 'markOrder', 'mergeFmcPolicy', 'reconcilePolicy', 'mergeSplitRules',
 'gotoSec', 'exportCSV', 'exportJSON', 'toggleDir', 'toggleExp', 'copyExpScript']
  .forEach(f => ok(f, typeof window[f] === 'function'));

console.log(`\nรวม: ${pass} PASS, ${fail} FAIL`);
window.close();
process.exit(fail ? 1 : 0);
