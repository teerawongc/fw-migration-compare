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
const trPath = path.join(ROOT, 'fmc_timerange_console.js');

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
ok('ปุ่ม Time Range มีอยู่จริง', !!$('tr-btn'));
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

console.log('\n=== Time Range modal ===');
window.toggleTR(true);
const trCode = $('tr-code').textContent;
const trOrig = fs.readFileSync(trPath, 'utf8').trim();
ok('modal เปิด', $('tr-overlay').classList.contains('open'));
ok('โค้ดตรงกับไฟล์ต้นฉบับ (ไม่สน CRLF/LF)', noCR(trCode) === noCR(trOrig));
ok('ไม่มี HTML entity หลงเหลือ', !/&(amp|lt|gt|quot);/.test(trCode));
let trSyntaxOk = true;
try { new window.Function(trCode); } catch (e) { trSyntaxOk = false; console.log('     → ' + e.message); }
ok('syntax ถูกต้อง รันได้', trSyntaxOk);
ok(`ป้ายบอกขนาด: ${$('tr-size').textContent}`, /บรรทัด/.test($('tr-size').textContent));
// กันพลาดซ้ำรอยเดิม: PUT ของ FMC เป็น full-replace ถ้าไม่ GET ก่อนจะทำ source/dest หาย
ok('GET rule ตัวเต็มก่อน PUT', trCode.includes("api('GET', '/policy/accesspolicies/' + policy.id + '/accessrules/' + rid)"));
ok('ส่ง body เดิมทั้งก้อน ไม่ประกอบใหม่', trCode.includes('JSON.parse(JSON.stringify(cur))'));
ok('เทียบ fingerprint หลัง PUT', trCode.includes('after !== before'));
ok('ยิงทีละ 100 ต่ำกว่าเพดาน 1000', /const\s+CHUNK\s*=\s*100/.test(trCode));
ok('default เป็นโหมดทดลอง', trCode.includes("const DRY = !/^go$/i.test(mode.trim())"));
ok('จับ rule ที่ FMT แตกออกเป็นหลายอัน', trCode.includes("r.name.startsWith(prefix + '_')"));
ok('รวม Time Range เดิมไม่เขียนทับ', trCode.includes('[...new Set([...have, ...want])]'));
ok('validate วันสิ้นสุดต้องหลังวันเริ่ม', trCode.includes('o.effectiveEndDateTime <= o.effectiveStartDateTime'));
window.toggleTR(false);
ok('tr modal ปิด', !$('tr-overlay').classList.contains('open'));

console.log('\n=== ปิด modal / ไม่กระทบ help modal เดิม ===');
window.toggleExp(false);
ok('exp modal ปิด', !$('exp-overlay').classList.contains('open'));
window.toggleHelp(true);
ok('help modal ยังเปิดได้', $('help-overlay').classList.contains('open'));
window.toggleHelp(false);
ok('help modal ยังปิดได้', !$('help-overlay').classList.contains('open'));

console.log('\n=== Report HTML ===');
// ยัดผลเปรียบเทียบปลอมเข้าไปแล้วเรียก exportReport จริง — เทสว่าไฟล์ที่ผู้ใช้ได้
// หน้าตาถูกต้อง ไม่ใช่แค่ว่าฟังก์ชันมีอยู่
// RES ประกาศด้วย const จึงอยู่ใน global lexical scope ไม่ใช่ property ของ window
// ต้องยัดค่าผ่าน window.eval ถึงจะเห็นตัวเดียวกับที่ exportReport ใช้
const FAKE = {
  policy: [
    { status:'ok', cp:{num:1,name:'Rule_#1',action:'accept',src:['A'],dst:['B'],svc:['s'],time:[]}, fmc:{num:1,action:'ALLOW',time:[]}, diffs:[] },
    { status:'mismatch', cp:{num:8,name:'Rule_#8',action:'accept',src:['10.1.1.1'],dst:['10.2.0.0/24'],svc:['tcp_443'],time:['E311226']},
      fmc:{num:8,action:'ALLOW',time:[]}, diffs:[{f:'Time',cv:'E311226',fv:'(ไม่มี)',severe:true}] },
    { status:'missing', cp:{num:148,name:'Rule_#148',action:'accept',src:['X'],dst:['Y'],svc:['z'],time:[]}, fmc:null, diffs:[] },
    { status:'extra', cp:null, fmc:{num:900,name:'Rule_#900',action:'ALLOW',time:[]}, diffs:[], orderBad:true },
  ],
  objects: [{ status:'missing', cp:{name:'H_1',type:'host',value:'10.0.0.1'}, fmc:null, diffs:[] }],
};
window.eval('RES.policy = ' + JSON.stringify(FAKE.policy) + '; RES.objects = ' + JSON.stringify(FAKE.objects) + ';');
let repName = null, repBody = null;
window.dlFile = (n, c) => { repName = n; repBody = c; };
window.exportReport();
ok('ตั้งชื่อไฟล์ตามวันที่', /^compare_report_\d{4}-\d{2}-\d{2}\.html$/.test(repName || ''));
ok('เป็น HTML เต็มไฟล์ เปิดเองได้', /^<!DOCTYPE html>/.test(repBody || '') && repBody.trim().endsWith('</html>'));
const rep = new JSDOM(repBody).window.document;
ok('มีทั้ง section ที่เปรียบเทียบแล้ว ไม่ใช่เฉพาะแท็บที่เปิดอยู่',
   /Security Policy/.test(repBody) && /Network Objects/.test(repBody));
ok('ไม่มี NAT ที่ยังไม่ได้เปรียบเทียบ', !/NAT Policy/.test(repBody));
ok('เตือนเรื่อง Time หายไว้บนสุด', /ผูกตารางเวลาไว้ แต่ฝั่ง FMC ไม่มี/.test(repBody));
ok('นับ rule ที่ Time หายถูก (1 rule)', /พบ 1 rule/.test(repBody));
ok('ตาราง Time ที่หายมีต้นทางปลายทางให้ดู', /10\.1\.1\.1/.test(repBody) && /10\.2\.0\.0\//.test(repBody));
ok('การ์ดสรุปนับรวมทุก section', rep.querySelectorAll('.card').length === 6);
const secTbl = [...rep.querySelectorAll('table')].find(x => /Section/.test(x.rows[0].textContent));
ok('ตารางสรุปมี 1 แถวต่อ 1 section', !!secTbl && secTbl.rows.length === 3);
ok('ตารางรายละเอียด policy ครบ 4 แถว + หัวตาราง',
   [...rep.querySelectorAll('table')].some(x => x.rows.length === 5 && /ชื่อ Rule/.test(x.rows[0].textContent)));
ok('สถานะแสดงเป็น badge มีสี', rep.querySelectorAll('.st-missing').length === 2);
ok('มี CSS สำหรับสั่งพิมพ์เป็น PDF', /@media print/.test(repBody));
ok('escape ค่าจากไฟล์ลูกค้า ไม่ยิง HTML ดิบ', !/<script/i.test(repBody.slice(repBody.indexOf('<body>'))));
window.eval('RES.policy = []; RES.objects = [];');

console.log('\n=== CP Drift (แท็บ CP เก่า ↔ CP ใหม่) ===');
// สร้าง XML จำลองที่คุมทุกตัวแปรได้ ดีกว่าใช้ไฟล์จริงตรงที่รู้คำตอบล่วงหน้า
const mkRule = (uuid, num, o = {}) => `<rule><Name></Name> <Class_Name>security_rule</Class_Name>` +
  `<Rule_UUID>{${uuid}}</Rule_UUID><Rule_Number>${num}</Rule_Number>` +
  `<action><action><Name>${o.act || 'accept'}</Name> <Class_Name>${o.act || 'accept'}_action</Class_Name>` +
  `<type><![CDATA[${o.act || 'accept'}]]></type></action></action>` +
  `<comments><![CDATA[${o.cmt || ''}]]></comments><disabled>${o.dis ? 'true' : 'false'}</disabled>` +
  `<name><![CDATA[${o.nm || ''}]]></name>` +
  `<src><Name></Name> <Class_Name>rule_source</Class_Name><members>` +
  (o.src || ['NetA']).map(x => `<reference><Name>${x}</Name><Table>network_objects</Table></reference>`).join('') +
  `</members></src>` +
  `<dst><Name></Name> <Class_Name>rule_destination</Class_Name><members>` +
  `<reference><Name>${o.dst || 'NetB'}</Name><Table>network_objects</Table></reference></members></dst>` +
  `<services><Name></Name> <Class_Name>rule_services</Class_Name><members>` +
  `<reference><Name>${o.svc || 'http'}</Name><Table>services</Table></reference></members></services>` +
  (o.time ? `<time><Name>${o.time}</Name><Table>times</Table></time>` : '') +
  `</rule>`;
const wrap = rs => `<?xml version="1.0"?><rules>${rs.join('')}</rules>`;

const oldXml = wrap([
  mkRule('U1', 1, { nm:'keep' }),
  mkRule('U2', 2, { nm:'willChange', act:'accept' }),
  mkRule('U3', 3, { nm:'willDelete' }),
  mkRule('U4', 4, { nm:'willMove' }),
]);
const newXml = wrap([
  mkRule('U1', 1, { nm:'keep' }),
  mkRule('U2', 2, { nm:'willChange', act:'drop', src:['NetA','NetC'] }),
  mkRule('U9', 3, { nm:'brandNew' }),
  mkRule('U4', 4, { nm:'willMove' }),
]);
window.eval(`
  DRIFT.old = { policy: parsePolicy(${JSON.stringify(oldXml)}), nat:[], objects:[
      {name:'Obj_same',type:'host',value:'10.0.0.1'},
      {name:'Obj_gone',type:'host',value:'10.0.0.2'},
      {name:'Obj_chg', type:'host',value:'10.0.0.3'}],
    services:[{name:'svc_same',type:'tcp',port:'80'}], files:[] };
  DRIFT.new = { policy: parsePolicy(${JSON.stringify(newXml)}), nat:[], objects:[
      {name:'Obj_same',type:'host',value:'10.0.0.1'},
      {name:'Obj_chg', type:'host',value:'10.0.0.99'},
      {name:'Obj_new', type:'network',value:'10.9.0.0/24'}],
    services:[{name:'svc_same',type:'tcp',port:'80'}], files:[] };
  curSec='drift'; runDrift();
`);
const dres = window.eval('RES.drift');
const byName = n => dres.find(r => (r.cp?.name || r.fmc?.name) === n);
const cD = {}; dres.forEach(r => cD[r.status] = (cD[r.status]||0)+1);
ok('อ่าน Rule_UUID จาก XML ได้', window.eval("DRIFT.old.policy[0].uuid") === '{U1}');
// policy: keep=ok, willChange=แก้, willDelete=ลบ, willMove=ok, brandNew=เพิ่ม
// objects: same=ok, chg=แก้, gone=ลบ, new=เพิ่ม | services: same=ok
ok(`นับสถานะถูก (${JSON.stringify(cD)})`, cD.extra === 2 && cD.missing === 2 && cD.mismatch === 2 && cD.ok === 4);
ok('rule ที่ไม่แตะ = เหมือนเดิม', byName('keep').status === 'ok');
ok('rule ที่ลบ = ถูกลบ', byName('willDelete').status === 'missing');
ok('rule ที่เพิ่ม = เพิ่มใหม่', byName('brandNew').status === 'extra');
const chg = byName('willChange');
ok('rule ที่แก้ = แก้ไข', chg.status === 'mismatch');
ok('จับได้ว่า Action เปลี่ยน accept→drop',
   chg.diffs.some(d => d.f === 'Action' && d.cv === 'accept' && d.fv === 'drop'));
ok('จับได้ว่า Source เพิ่ม NetC', chg.diffs.some(d => d.f === 'Source' && d.fv === 'NetA; NetC'));
ok('rule ที่เลขไม่เปลี่ยน ไม่ติดธงลำดับ', !byName('willMove').moved);
ok('object ที่ค่าเปลี่ยน = แก้ไข', byName('Obj_chg').status === 'mismatch');
ok('object ที่หายไป = ถูกลบ', byName('Obj_gone').status === 'missing');
ok('object ใหม่ = เพิ่มใหม่', byName('Obj_new').status === 'extra');
ok('เรียงของที่เปลี่ยนขึ้นก่อน', dres[0].status !== 'ok' && dres[dres.length-1].status === 'ok');
// การแทรก rule ทำให้เลขของ rule ข้างหลังเลื่อน — ต้องรายงานเป็น "ลำดับ" ไม่ใช่ "แก้ไข"
window.eval(`
  DRIFT.new.policy = parsePolicy(${JSON.stringify(wrap([mkRule('U1',1,{nm:'keep'}), mkRule('U9',2,{nm:'inserted'}), mkRule('U2',3,{nm:'willChange'}), mkRule('U4',4,{nm:'willMove'})]))});
  runDrift();`);
const d2 = window.eval('RES.drift');
const moved = d2.filter(r => r.moved);
ok(`rule ที่ถูกดันจากการแทรก ติดธงลำดับ (${moved.length} rule)`, moved.length === 1 && moved[0].cp.name === 'willChange');
ok('ธงลำดับไม่ทำให้กลายเป็นแก้ไข', moved[0].status === 'ok' && moved[0].seqOld === 2 && moved[0].seqNew === 3);
// CSV
let cName=null, cBody=null;
window.dlFile = (n,c) => { cName=n; cBody=c; };
window.exportCSV();
ok('export CSV ของ drift', cName === 'cp_drift.csv' && /"สถานะ","ประเภท"/.test(cBody) && /"ลำดับเก่า"/.test(cBody));
ok('CSV มีทุกแถวรวมหัวตาราง', cBody.split('\n').length === d2.length + 1);
window.eval('DRIFT.old=null; DRIFT.new=null; RES.drift=[]; curSec="policy";');

console.log('\n=== ฟังก์ชันหลักยังอยู่ครบ ===');
['runCmp', 'markOrder', 'mergeFmcPolicy', 'reconcilePolicy', 'mergeSplitRules',
 'gotoSec', 'exportCSV', 'exportJSON', 'toggleDir', 'toggleExp', 'copyExpScript',
 'toggleTR', 'copyTrScript', 'dlTrScript', 'copyToClip', 'exportReport',
 'driftLoad', 'driftClear', 'runDrift', 'driftDetect', 'driftDet']
  .forEach(f => ok(f, typeof window[f] === 'function'));

console.log(`\nรวม: ${pass} PASS, ${fail} FAIL`);
window.close();
process.exit(fail ? 1 : 0);
