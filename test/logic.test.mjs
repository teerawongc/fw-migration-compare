/* ทดสอบ logic เปรียบเทียบใน fw_policy_compare.html
   รัน:  npm i jsdom --no-save  &&  node test/logic.test.mjs

   ครอบคลุมบั๊กที่เคยเจอจริงทั้งหมด — ห้ามลบเคสไหนออกโดยไม่มีเหตุผล
     v3.7.0  FMT หั่น rule ที่ object เกินเพดานเป็น Rule_#N-1/-2/-3
     v3.7.0  ลำดับ rule ฝั่ง FMC ไม่ตรงกับ CP
     v3.9.0  Any vs any ต้องเป็น Match
     v3.9.0  ชื่อต่างกันแค่ suffix ที่ FMT เติม (-CP) ต้องเป็น "ตรวจซ้ำ"        */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'fw_policy_compare.html'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.dev/' });
const w = dom.window;
await new Promise(r => setTimeout(r, 2000));
const $ = id => w.document.getElementById(id);

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`); };

const CP = o => Object.assign({ num:1, name:'', action:'accept', disabled:false, src:['Any'], dst:['Any'], svc:['Any'] }, o);
const FM = o => Object.assign({ num:1, name:'', action:'accept', enabled:true,  src:['Any'], dst:['Any'], svc:['Any'] }, o);

// CP / FMC / RES / curSec เป็น const/let ระดับ script จึงไม่ผูกกับ window
// ต้องเข้าถึงผ่าน global lexical scope ด้วย eval
function run(cp, fmc, sfx = '-CP') {
  $('o-sfx').value = sfx;
  w.eval(`CP.policy.length=0; CP.policy.push(...${JSON.stringify(cp)});
          FMC.policy.length=0; FMC.policy.push(...${JSON.stringify(fmc)});
          curSec='policy'; runCmp();`);
  return w.eval('RES.policy');
}

console.log('\n=== v3.7.0 · FMT หั่น rule (Rule_#N-1/-2/-3) ===');
{
  const many = Array.from({ length: 148 }, (_, i) => `H_10.1.${(i/254|0)}.${i%254+1}`);
  const r = run(
    [CP({ num:99, src:many, svc:['tcp_443'] })],
    [FM({ num:10, name:'Rule_#99-1', src:many.slice(0,50),    svc:['tcp_443'] }),
     FM({ num:11, name:'Rule_#99-2', src:many.slice(50,100),  svc:['tcp_443'] }),
     FM({ num:12, name:'Rule_#99-3', src:many.slice(100),     svc:['tcp_443'] })]);
  ok('3 FMC rule รวมเป็นแถวเดียว', r.filter(x => x.status !== 'skip').length === 1);
  ok('รวม object ครบ 148 → Match', r[0].status === 'ok');
  ok('บันทึกว่ามาจาก 3 ส่วน', r[0].fmc.parts === 3);
  ok('ไม่มีส่วนที่เหลือตกไปกอง Extra', !r.some(x => x.status === 'extra'));
}

console.log('\n=== v3.7.0 · ลำดับ rule ไม่ตรง (flag เฉพาะตัวที่ผิดจริง) ===');
{
  // CP 1..8 แต่ FMC เอา CP#8 ขึ้นมาไว้ตำแหน่งที่ 4 → ผิดที่แค่ตัวเดียว
  const order = [1,2,3,8,4,5,6,7];
  const r = run(order.map(n => CP({ num:n })).sort((a,b) => a.num - b.num),
                order.map((n,i) => FM({ num:i+1, name:'Rule_#'+n })));
  const bad = r.filter(x => x.orderBad);
  ok('flag แค่ 1 rule ไม่ลามทั้งแถว', bad.length === 1);
  ok('flag ถูกตัว (CP#8)', bad[0]?.cp?.num === 8);
  ok('บอกทิศทางว่าเลื่อนขึ้น', bad[0]?.order?.moved === 'up');
  ok('เนื้อหาตรงกันยังนับเป็น Match', bad[0]?.status === 'ok');
}

console.log('\n=== v3.9.2 · ตำแหน่งเลื่อนเพราะ split ต้องไม่ถูกมองว่าลำดับผิด ===');
{
  // CP 1..300 เรียงถูกทุกตัว แต่ rule 50/120/200 ถูกหั่นเป็น 2 ส่วน
  // ทำให้ CP#300 ไปตกตำแหน่ง 303 — เลขไม่ตรงกันแต่ลำดับไม่ได้ผิด
  const cp = [], fmc = []; let pos = 1;
  for (let n = 1; n <= 300; n++) {
    cp.push(CP({ num:n, src:['A'], svc:['S'+n] }));
    const parts = [50,120,200].includes(n) ? 2 : 1;
    for (let j = 1; j <= parts; j++)
      fmc.push(FM({ num:pos++, name:'Rule_#'+n+(parts>1?'-'+j:''), src:['A'], svc:['S'+n] }));
  }
  const r = run(cp, fmc);
  const r300 = r.find(x => x.cp?.num === 300);
  ok('CP#300 จับคู่กับตำแหน่ง 303', r300.fmc.num === 303);
  ok('ไม่ถูก flag ว่าลำดับผิด', !r300.orderBad);
  ok('ทั้ง section ไม่มี rule ไหนถูก flag เลย', r.filter(x => x.orderBad).length === 0);
  // หน้าจอต้องไม่ระบายสีเตือนช่องลำดับ เมื่อลำดับไม่ได้ผิดจริง
  const panel = w.eval(`detPanel(RES.policy.find(x=>x.cp&&x.cp.num===300),'policy')`);
  const posRow = panel.slice(panel.indexOf('ลำดับ (CP/FMC)'), panel.indexOf('ลำดับ (CP/FMC)') + 260);
  ok('ช่องลำดับไม่ติด class diff (ไม่ระบายสีเตือน)', !posRow.includes('det-val diff'));
  ok('มีคำอธิบายว่าตำแหน่งเลื่อนเพราะ split', panel.includes('ลำดับสัมพัทธ์ยังถูกต้อง'));
}

console.log('\n=== v3.9.0 · Any vs any ===');
{
  const r = run([CP({ num:3, src:['Client_10.18.3.195'], dst:['Any'] })],
                [FM({ num:3, name:'Rule_#3', src:['Client_10.18.3.195'], dst:['any'] })]);
  ok('Any vs any → Match', r[0].status === 'ok');
  ok('ไม่มี diff ค้าง', r[0].diffs.length === 0);
}

console.log('\n=== v3.9.0 · suffix ที่ FMT เติมตอน rename ===');
{
  let r = run([CP({ num:33, svc:['GHB_Service_21_22'] })],
              [FM({ num:33, name:'Rule_#33', svc:['GHB_Service_21_22-CP'] })]);
  ok('-CP → ตรวจซ้ำ ไม่ใช่ Mismatch', r[0].status === 'review');
  ok('เก็บคู่ที่ถูก rename ไว้แสดง',
     JSON.stringify(r[0].diffs[0].pairs) === '[["GHB_Service_21_22","GHB_Service_21_22-CP"]]');

  r = run([CP({ num:5, svc:['GHB_Service_21_22'] })],
          [FM({ num:5, name:'Rule_#5', svc:['GHB_Service_80_443-CP'] })]);
  ok('ชื่อคนละตัวจริง แม้ลงท้าย -CP → ยัง Mismatch', r[0].status === 'mismatch');

  r = run([CP({ num:6, svc:['S1'], src:['A'] })],
          [FM({ num:6, name:'Rule_#6', svc:['S1-CP'], src:['B'] })]);
  ok('มีจุดต่างจริงปนอยู่ → Mismatch (ไม่กลืนเป็น review)', r[0].status === 'mismatch');

  r = run([CP({ num:7, action:'accept', svc:['S1'] })],
          [FM({ num:7, name:'Rule_#7', action:'drop', svc:['S1-CP'] })]);
  ok('Action ต่าง → Mismatch', r[0].status === 'mismatch');

  r = run([CP({ num:8, svc:['GHB_Service_21_22'] })],
          [FM({ num:8, name:'Rule_#8', svc:['GHB_Service_21_22-CP'] })], '');
  ok('ปิดช่อง suffix → กลับเป็น Mismatch', r[0].status === 'mismatch');

  r = run([CP({ num:9, svc:['S_A'] })], [FM({ num:9, name:'Rule_#9', svc:['S_A_CP'] })], '-CP, _CP');
  ok('รองรับหลาย suffix คั่นด้วย ,', r[0].status === 'review');

  // เคสจริงจากหน้างาน: ตั้งไว้ "-CP" แต่ของจริงเป็น "_CP" (ขีดล่าง)
  r = run([CP({ num:300, svc:['GHB_AD2011_Service','GHB_TCP_Service_464'] })],
          [FM({ num:303, name:'Rule_#300', svc:['GHB_AD2011_Service_CP','GHB_TCP_Service_464'] })], '-CP');
  ok('ตั้ง -CP ต้องจับ _CP ได้ด้วย (ตัวคั่นไม่สำคัญ)', r[0].status === 'review');
  r = run([CP({ num:11, svc:['S_A'] })], [FM({ num:11, name:'Rule_#11', svc:['S_A.CP'] })], '-CP');
  ok('ตั้ง -CP ต้องจับ .CP ได้ด้วย', r[0].status === 'review');
  // ต้องตัดเฉพาะท้ายชื่อ ไม่ใช่เจอ CP ตรงไหนก็ตัด
  r = run([CP({ num:12, svc:['S_A'] })], [FM({ num:12, name:'Rule_#12', svc:['S_CP_A'] })], '-CP');
  ok('CP อยู่กลางชื่อ ไม่ถือเป็น suffix → Mismatch', r[0].status === 'mismatch');
}

console.log('\n=== v3.9.0 · UI ของสถานะ ตรวจซ้ำ ===');
{
  run([CP({ num:1, svc:['X'] }), CP({ num:2, svc:['Y'] })],
      [FM({ num:1, name:'Rule_#1', svc:['X-CP'] }), FM({ num:2, name:'Rule_#2', svc:['Y'] })]);
  w.eval('updateSummary()');
  ok('การ์ดสรุปนับถูก', $('c-rv').textContent === '1');
  ok('ตัวเลขบนแท็บนับถูก', $('rn-rv').textContent === '1');
  w.eval("showTab('review')");
  ok('กรองแท็บได้ 1 แถว', /1 รายการ/.test($('tcnt').textContent));
  ok('badge ขึ้นในตาราง', $('result').innerHTML.includes('ตรวจซ้ำ'));
}

console.log('\n=== v3.9.0 · สี pill Any ต้องไม่ชนกับสีเตือน ===');
{
  const anyC  = html.match(/\.pill-any\s*\{[^}]*color:\s*(#[0-9a-f]+)/i)[1].toLowerCase();
  const diffC = html.match(/\.pill-diff\s*\{[^}]*color:\s*(#[0-9a-f]+)/i)[1].toLowerCase();
  ok(`pill-any (${anyC}) ต่างจาก pill-diff (${diffC})`, anyC !== diffC);
  ok('pill-any ไม่ใช่สีส้ม --warn', anyC !== '#f59e0b');
}

console.log(`\nรวม: ${pass} PASS, ${fail} FAIL`);
w.close();
process.exit(fail ? 1 : 0);
