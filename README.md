# FW Migration Comparator

## URL
https://fw-migration-compare.teerawong-c.workers.dev

> **ตั้งค่าครั้งแรก (API token / secret / auto-deploy): อ่าน [SETUP.md](SETUP.md)**

## Password Protection
รหัสผ่านเข้าเว็บเก็บเป็น **Cloudflare Secret** ไม่ได้อยู่ในโค้ด (ตั้งแต่ v3.7.0 เพื่อให้ push ขึ้น GitHub ได้)
- ตั้ง/เปลี่ยนรหัส: `npx wrangler secret put APP_PASSWORD` — **มีผลทันที ไม่ต้อง deploy ใหม่**
- เปลี่ยนรหัสแล้ว session ที่ค้างอยู่ทุกเครื่องหลุดอัตโนมัติ (cookie คำนวณจาก `SHA-256(รหัส + salt)`)
- ยังไม่ตั้ง secret → เว็บขึ้น 503 พร้อมวิธีตั้ง (ไม่เปิดโล่ง)
- Session cookie `fw_auth` หมดอายุ 90 นาทีหลัง login (ตัวแปร `SESSION_SECONDS` ใน `build.py`)
- Idle auto-logout: ไม่มีการใช้งาน 10 นาที (mousemove/click/keydown ฯลฯ) → เด้งไป `/logout` อัตโนมัติ (ใน `fw_policy_compare.html` ฟังก์ชัน `startIdleLogout`)
- Logout: เข้า path `/logout`

## วิธีแก้ไขและ Deploy

### วิธีปกติ — push แล้วจบ (GitHub Actions deploy ให้เอง)
1. แก้ไข `fw_policy_compare.html` (เพิ่มเลข version ด้วย)
2. `git add -A && git commit -m "..." && git push`
3. ดูผลที่แท็บ Actions — ใช้เวลาประมาณ 1 นาที

### วิธีด่วน — deploy จากเครื่องตรงๆ
1. `python build.py` (สร้าง `src/index.js` ใหม่) — Windows ใช้ `python` ไม่ใช่ `python3`
2. `npm run deploy`

> `src/index.js` เป็น build artifact และ **ไม่ได้ commit** ลง git — สร้างจาก `build.py` ทุกครั้ง เพื่อไม่ให้ HTML กับ worker หลุด sync กัน

### Versioning
เพิ่ม version ทุกครั้งที่แก้ `fw_policy_compare.html` (3 จุด: `<title>`, `<span id="ver">`, `const VER`):
- แก้เล็กน้อย/แก้บั๊ก → เพิ่มเลขท้าย (patch) เช่น v3.4.0 → v3.4.1
- เพิ่มฟีเจอร์ใหม่ → เพิ่มเลขกลาง (minor) เช่น v3.4.1 → v3.5.0

### Commands
```
npm run deploy   # Deploy ขึ้น Cloudflare
npm run dev      # Local dev ที่ localhost:8787
npm run tail     # ดู logs
```
