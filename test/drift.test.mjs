import { JSDOM } from 'jsdom'; import fs from 'fs';
const ROOT=process.env.REPO_ROOT;
const dom=new JSDOM(fs.readFileSync(ROOT+'/fw_policy_compare.html','utf8'),{runScripts:'dangerously',url:'https://x.dev/'});
const w=dom.window; const $=id=>w.document.getElementById(id);
await new Promise(r=>{ if(w.document.readyState==='complete') return r(); w.addEventListener('load',r); setTimeout(r,3000); });
let p=0,f=0; const ok=(n,c)=>{c?p++:f++;console.log(`  ${c?'PASS':'FAIL'}  ${n}`)};

console.log('=== สลับแท็บ ===');
ok('เริ่มต้น drift panel ซ่อน', $('drift-panel').style.display==='none');
w.gotoSec('drift');
ok('กดแท็บ drift แล้วแผง drift โผล่', $('drift-panel').style.display==='block');
const others=[...w.document.querySelectorAll('#lpanel > .lsec')];
ok(`แผงเดิม ${others.length} ก้อนถูกซ่อนหมด`, others.every(e=>e.style.display==='none'));
ok('ปุ่มเปรียบเทียบยัง disabled เพราะยังไม่มีไฟล์', $('btn-run').disabled===true);
w.gotoSec('policy');
ok('กลับแท็บเดิม แผง drift ซ่อน + แผงเดิมกลับมา', $('drift-panel').style.display==='none' && others.every(e=>e.style.display===''));

console.log('\n=== ตรวจไฟล์ที่ลาก ===');
ok('รู้ว่าเป็น Security_Policy', w.driftDetect('<x><Class_Name>security_rule</Class_Name></x>')==='policy');
ok('รู้ว่าเป็น network_objects', w.driftDetect('<network_object><Name>a</Name></network_object>')==='objects');
ok('รู้ว่าเป็น services', w.driftDetect('<x><Class_Name>tcp_service</Class_Name></x>')==='services');
ok('ไฟล์แปลกปลอม -> null', w.driftDetect('<html><body>hi</body></html>')===null);

console.log('\n=== ตารางผล ===');
w.eval(`
 DRIFT.old={policy:[],nat:[],objects:[{name:'A',type:'host',value:'1.1.1.1'},{name:'B',type:'host',value:'2.2.2.2'}],services:[],files:[]};
 DRIFT.new={policy:[],nat:[],objects:[{name:'A',type:'host',value:'1.1.1.9'},{name:'C',type:'network',value:'10.0.0.0/8'}],services:[],files:[]};
 curSec='drift'; runDrift();`);
const html=$('result').innerHTML;
ok('มีป้าย เพิ่มใหม่ / ถูกลบ / แก้ไข', /เพิ่มใหม่/.test(html)&&/ถูกลบ/.test(html)&&/แก้ไข/.test(html));
ok('โชว์ค่าก่อน-หลังในแถว', /1\.1\.1\.1/.test(html)&&/1\.1\.1\.9/.test(html));
ok('การ์ดสรุปเปลี่ยนป้ายเป็นภาษาที่ตรงบริบท', $('lbl-miss').textContent.includes('ถูกลบ') && $('lbl-extra').textContent.includes('เพิ่มใหม่'));
ok('ปุ่ม Bulk JSON ถูกปิด (ไม่มีความหมายในโหมดนี้)', $('btn-json').disabled===true);
ok('ปุ่ม CSV/Report เปิด', $('btn-csv').disabled===false && $('btn-rep').disabled===false);
w.eval("openDetRow=-1"); w.togDet(0);
ok('คลิกแถวแล้วกางรายละเอียดได้', $('det-0') && $('det-0').style.display==='');
console.log(`\nรวม: ${p} PASS, ${f} FAIL`);
process.exit(f?1:0);
