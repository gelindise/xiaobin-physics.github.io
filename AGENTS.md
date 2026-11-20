# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

A static Chinese physics virtual experiment platform (物理虚拟实验平台) for junior high school physics education, hosted on **GitHub Pages**. No build tools, framework, or package manager — pure HTML/CSS/JS.

## Architecture

- **Site pages** (`index.html`, `experiments.html`, `vip.html`, `login.html`, `register.html`, `pay.html`, `admin.html`): Use shared `style.css` and `script.js`
- **Experiment pages** (self-contained `.html` files like `阿基米德原理.html`, `杠杆最小力方向.html`): Each is fully self-contained with inline `<style>` and `<script>`. They use HTML Canvas (`<canvas id="simCanvas">`) for physics simulation with `requestAnimationFrame` render loops
- **`script.js`**: Shared JS — user auth (Tencent Docs API for user sync), VIP logic, particle background, UI utilities
- **`style.css`**: Shared styles — dark theme with glass-morphism UI, responsive layout, chapter/section accordion navigation, experiment grid cards
- **Experiments list hierarchy**: Grade tabs (八年级上册/下册, 九年级) → Chapters (章) → Sections (节) → Experiment cards. Each card links to a specific experiment HTML file

## Experiment Page Pattern

Each experiment HTML follows the same structure:
1. Dark theme CSS variables (`:root`) matching `style.css`
2. Fixed header with logo + nav
3. `<div class="main-card">` containing `<canvas id="simCanvas">` + control panel
4. Control panel: material/fluid selectors, sliders, buttons, real-time data display
5. Inline `<script>` with `MATERIALS`/`FLUIDS` config objects, physics calculations, Canvas rendering loop
6. Formula bar + experiment info cards below the simulation

## VIP / Auth System

- **Supabase** (`supabase.js`): All user data (users table) and payment orders (orders table) stored in Supabase
- **Serverless API** (`api/`): Vercel cloud functions for PayJS payment processing
  - `api/create-order.js`: Create PayJS payment order, return QR code
  - `api/check-order.js`: Poll order payment status
  - `api/pay-callback.js`: PayJS webhook receiver, auto-updates VIP on payment
- **Client-side** (`script.js`): Login/register via Supabase REST API, localStorage as offline cache
- Experiments marked as `lock` class with `checkVip()` gate for VIP-only content
- Free experiments use `openLab()` directly

## 趣味实验子栏目（付费内容，硬门禁）

`fun.html` 是《趣味物理实验"玩"全攻略》的独立页：左栏目录 + 右栏正文。整站内容需解锁码才能看。

访问入口：站内导航用 `fun.html`；对外分享用短链 `/fun`（`vercel.json` 里 rewrite 到 `fun.html`，不改地址栏）。旧的中文地址 `趣味实验.html` 保留为一个跳转壳（主站跳 `/fun`，其他环境跳 `fun.html`，保留 `#hash`）。

- **可公开**：`assets/fun-exp/meta.js`（章节与 210 个实验的编号/标题/材料/60 字导语，目录与搜索都用它）、`assets/fun-exp/img/`（正文配图，哈希文件名）
- **绝不入库**：`private/fun-exp/chN.js`（正文 HTML）。GitHub Pages 会把仓库里所有文件当静态资源公开，所以正文只存 Supabase `funexp_chapters`，由 `POST /api/proxy-user`（action `getFunExpChapter`）校验「码存在 + 未停用 + 未过期 + 本设备已绑定」后下发。`private/` 已在 `.gitignore` 与 `.githooks/pre-commit` 双拦截
- **生成**：`python3 tools/build_fun_exp.py "<docx>"` → meta 进 assets、正文进 private
- **上传**：`python3 tools/upload_fun_exp_content.py --base <站点> --token <管理员密码>`（逐章 upsert；`--dry` 只检查）
- **解锁码**：后台 `admin.html` →「🎟 解锁码」生成/停用/删除；表 `funexp_codes` / `funexp_bindings`，SQL 见 `api/funexp_codes.sql`
- 本地预览：`file://` 或 localhost 打开时解锁弹窗底部有「本地预览」按钮，走 `private/fun-exp/` 里的文件，仅在本地有效

## Payment Flow

User clicks VIP → `/api/create-order` → PayJS QR code → user scans with WeChat → PayJS calls `/api/pay-callback` → Supabase VIP updated → page polls `/api/check-order` → redirects to experiments.

## Deploy

- **Static site**: Push to `main` → GitHub Pages auto-deploys (or Vercel for combined hosting)
- **API functions**: Connect repo to **Vercel** (`vercel.json` at root), set environment variables:
  - `PAYJS_MCHID` - PayJS merchant ID
  - `PAYJS_KEY` - PayJS merchant key
  - `SUPABASE_URL` - Supabase project URL
  - `SUPABASE_SERVICE_KEY` - Supabase service_role key (for server-side admin ops)
- **Supabase tables**: `users` (auth/VIP) and `orders` (payment records)

## Dev Commands

This is a static site — no build, test, or lint commands. To preview locally:

```bash
python3 -m http.server 8000
```

## Commit Convention

Commit messages are in Chinese (e.g., `Update script.js`). No strict convention.
