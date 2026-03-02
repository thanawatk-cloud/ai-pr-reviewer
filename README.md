# AI PR Reviewer Template

GitHub Actions workflow ที่ใช้ Claude (claude-opus-4-6) รีวิว PR อัตโนมัติเมื่อมีการเปิด PR ใหม่หรือ push โค้ดเพิ่ม

## วิธีใช้งาน

### 1. คัดลอกไฟล์เข้า repo ของคุณ

```bash
cp -r .github/ /path/to/your-repo/.github/
```

หรือคัดลอกทีละโฟลเดอร์:
- `.github/workflows/ai-pr-review.yml`
- `.github/scripts/ai-review/` (ทั้งโฟลเดอร์)

### 2. สร้าง package-lock.json

```bash
cd .github/scripts/ai-review
npm install
```

Commit ไฟล์ `package-lock.json` ที่ได้ด้วย

### 3. เพิ่ม Secret ใน GitHub

ไปที่ **Settings → Secrets and variables → Actions** แล้วเพิ่ม:

| Secret | ค่า |
|--------|-----|
| `ANTHROPIC_API_KEY` | API key จาก [console.anthropic.com](https://console.anthropic.com) |

> `GITHUB_TOKEN` ถูกสร้างโดยอัตโนมัติ ไม่ต้องเพิ่มเอง

### 4. ทดสอบ

เปิด PR ใหม่ใน repo แล้วดูที่ tab **Actions** — bot จะ comment รีวิวใน PR

---

## พฤติกรรม

- รีวิวเมื่อ PR ถูก **opened**, **synchronize** (push เพิ่ม), หรือ **reopened**
- **ข้าม Draft PR** โดยอัตโนมัติ
- **อัปเดต comment เดิม** แทนที่จะสร้างใหม่ทุกครั้ง (ไม่ spam)
- รองรับ PR ขนาดใหญ่ — ตัดทอน diff อัตโนมัติถ้าใหญ่เกินไป

## โครงสร้างไฟล์

```
.github/
├── workflows/
│   └── ai-pr-review.yml       # GitHub Actions workflow
└── scripts/
    └── ai-review/
        ├── review.ts           # Main review script
        ├── package.json
        ├── package-lock.json   # สร้างด้วย npm install
        └── tsconfig.json
```

## ปรับแต่ง

### เปลี่ยน model
แก้ใน `review.ts` บรรทัด `model: "claude-opus-4-6"`:
- `claude-opus-4-6` — ดีที่สุด (default)
- `claude-sonnet-4-6` — เร็วกว่า ถูกกว่า
- `claude-haiku-4-5` — เร็วมาก ราคาถูก

### เปลี่ยน system prompt
แก้ `systemPrompt` ใน `review.ts` เพื่อโฟกัสด้านที่ต้องการ เช่น security-focused, performance-focused, หรือเฉพาะ framework ที่ใช้

### เพิ่ม branch filter
แก้ workflow ถ้าต้องการรีวิวเฉพาะ branch:
```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches:
      - main
      - develop
```
