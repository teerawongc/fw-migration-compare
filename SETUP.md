# Setup — Deploy & GitHub

Repo: <https://github.com/teerawongc/fw-migration-compare> (private)
Worker: <https://fw-migration-compare.teerawong-c.workers.dev>

ทำ **ครั้งเดียว** ตามลำดับ 1 → 4 หลังจากนั้นแค่ `git push` พอ

---

## 1. สร้าง Cloudflare API Token

1. เข้า <https://dash.cloudflare.com/profile/api-tokens> → **Create Token**
2. เลือกเทมเพลต **Edit Cloudflare Workers** → Continue
3. Account Resources: เลือกบัญชีของคุณ / Zone Resources: `All zones` (หรือ None ก็ได้ เพราะใช้ `workers.dev`)
4. Continue → Create Token → **คัดลอกค่าเก็บไว้ (แสดงครั้งเดียว)**

> ใช้เทมเพลตนี้ อย่าใช้ Global API Key — token นี้แก้ได้เฉพาะ Workers ถ้าหลุดความเสียหายจำกัดกว่ามาก และ revoke ทิ้งได้ทันทีโดยไม่กระทบอย่างอื่น

## 2. ตั้งรหัสผ่านเข้าเว็บ (Cloudflare Secret)

รหัสผ่านไม่ได้อยู่ในโค้ดแล้ว — Worker อ่านจาก `env.APP_PASSWORD` ตอน runtime

```bash
cd D:\AI\Claude\Tools\fw-migration-worker
npx wrangler login              # ครั้งแรกเท่านั้น
npx wrangler secret put APP_PASSWORD
# พิมพ์รหัสที่ต้องการ แล้ว Enter
```

เปลี่ยนรหัสภายหลัง: รันคำสั่งเดิมซ้ำ **มีผลทันที ไม่ต้อง deploy ใหม่** และ session ที่ค้างอยู่ทุกเครื่องจะหลุดอัตโนมัติ (ค่า cookie คำนวณจากรหัสผ่าน)

ถ้ายังไม่ตั้ง secret เว็บจะขึ้น 503 พร้อมคำแนะนำ — ไม่เปิดโล่งให้เข้าฟรี

## 3. ใส่ Secret ใน GitHub (สำหรับ auto-deploy)

`Settings → Secrets and variables → Actions → New repository secret` เพิ่ม 2 ตัว:

| ชื่อ | ค่า |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token จากข้อ 1 |
| `CLOUDFLARE_ACCOUNT_ID` | `cf34a593c026515a94dbd632be682d97` |

> `APP_PASSWORD` **ไม่ต้อง**ใส่ใน GitHub — มันอยู่ฝั่ง Cloudflare อยู่แล้ว GitHub ไม่ต้องรู้

## 4. Push ขึ้น GitHub ครั้งแรก

```bash
cd D:\AI\Claude\Tools\fw-migration-worker
git remote add origin https://github.com/teerawongc/fw-migration-compare.git
git branch -M main
git push -u origin main
```

เสร็จแล้วดูแท็บ **Actions** ใน GitHub — จะเห็น workflow วิ่ง build + deploy เอง

---

## การใช้งานประจำวัน

```bash
# แก้ fw_policy_compare.html (อย่าลืมเพิ่มเลข VERSION)
git add -A
git commit -m "อธิบายสิ่งที่แก้"
git push
```

push แล้ว GitHub Actions จะ `python build.py` + `wrangler deploy` ให้เอง ประมาณ 1 นาที

**deploy ด่วนจากเครื่องโดยไม่ผ่าน GitHub:**

```bash
python build.py && npm run deploy
```

**รันทดสอบในเครื่อง:**

```bash
copy .dev.vars.example .dev.vars    # แล้วแก้รหัสในไฟล์
python build.py
npm run dev                          # http://localhost:8787
```

---

## สิ่งที่ .gitignore กันไว้ — อย่าไปแก้

| รายการ | เหตุผล |
|---|---|
| `.dev.vars` | รหัสผ่านสำหรับ dev |
| `*.xml`, `fmc_*.json`, `bulk_*.json`, `compare_*.csv` | **ไฟล์ export จริงจากไฟร์วอลล์ GHB** — มี IP, ชื่อ object, policy ทั้งองค์กร ต่อให้ repo เป็น private ก็ไม่ควรขึ้น |
| `src/index.js` | build artifact — CI สร้างใหม่ทุกครั้งจาก HTML กันไฟล์สองตัวหลุด sync |
| `node_modules/`, `.wrangler/` | ของ generate ได้ |

ก่อน commit ครั้งแรกทุกครั้งที่เพิ่มไฟล์ใหม่ ลองเช็ค:

```bash
git status --short          # ดูว่ามีไฟล์ข้อมูลลูกค้าหลุดเข้ามาไหม
```

---

## แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Actions ขึ้น `Authentication error [code: 10000]` | API token ผิด/หมดอายุ → สร้างใหม่ตามข้อ 1 แล้วอัปเดต GitHub secret |
| เว็บขึ้น 503 "ยังไม่ได้ตั้งรหัสผ่าน" | ยังไม่ได้ทำข้อ 2 → `npx wrangler secret put APP_PASSWORD` |
| deploy สำเร็จแต่เว็บยังเป็นเวอร์ชันเก่า | เบราว์เซอร์ cache → **Ctrl+Shift+R** แล้วดูเลขเวอร์ชันมุมล่าง |
| ลืมรหัสผ่าน | ตั้งใหม่ทับได้เลยด้วยคำสั่งเดิม ไม่ต้องกู้ |
| เผลอ commit ไฟล์ที่มีข้อมูลลูกค้าไปแล้ว | ลบไฟล์เฉยๆ ไม่พอ — ยังอยู่ใน history ต้องใช้ `git filter-repo` หรือลบ repo แล้วสร้างใหม่ |
