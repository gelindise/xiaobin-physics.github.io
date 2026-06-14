# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A static Chinese physics virtual experiment platform (物理虚拟实验平台) for junior high school physics education, hosted on **GitHub Pages**. No build tools, framework, or package manager — pure HTML/CSS/JS.

## Architecture

- **Site pages** (`index.html`, `experiments.html`, `vip.html`, `login.html`, `register.html`, `pay.html`, `admin.html`): Use shared `style.css` and `script.js`
- **Experiment pages** (self-contained `.html` files like `阿基米德原理.html`, `杠杆最小力方向.html`): Each is fully self-contained with inline `<style>` and `<script>`. They use HTML Canvas (`<canvas id="simCanvas">`) for physics simulation with `requestAnimationFrame` render loops
- **`script.js`**: Shared JS — user auth (Tencent Docs API for user sync), VIP logic, particle background, UI utilities
- **`style.css`**: Shared styles — dark theme with glass-morphism UI, responsive layout, chapter/section accordion navigation, experiment grid cards
- **Experiments list hierarchy**: Grade tabs (八年级上册/下册, 九年级) → Chapters (章) → Sections (节) → Experiment cards. Cards use `onclick="openLab('file.html')"` which loads the experiment in a fullscreen iframe overlay on `experiments.html`, so the URL stays as `experiments.html` — no shareable deep links.
- **iframe overlay** (`#labOverlay` in `experiments.html`): `script.js` provides `openInFrame(url)`, `closeLab()`. `openLab()` and `checkVip()` both delegate to `openInFrame()`. The overlay has a "← 返回实验列表" button.

## Experiment Page Pattern

Each experiment HTML follows the same structure:
1. Dark theme CSS variables (`:root`) matching `style.css`
2. Access protection guard at the top of `<script>` (referrer + localStorage token check, redirect to `index.html` on fail)
3. No separate header/nav needed — the iframe overlay provides unified navigation
4. `<div class="main-card">` containing `<canvas id="simCanvas">` + control panel
4. Control panel: material/fluid selectors, sliders, buttons, real-time data display
5. Inline `<script>` with `MATERIALS`/`FLUIDS` config objects, physics calculations, Canvas rendering loop
6. Formula bar + experiment info cards below the simulation

## VIP / Auth System

- **Supabase** (`supabase.js`): All user data (users table) and payment orders (orders table) stored in Supabase
- **Serverless API** (`api/`): Vercel cloud functions for 面包多 (mbd.pub) payment processing
  - `api/create-order.js`: Create 面包多 H5 payment order via `POST https://newapi.mbd.pub/release/wx/prepay`, sign with MD5(sorted params + key), return `h5_url`
  - `api/check-order.js`: Poll Supabase orders table for payment status
  - `api/pay-callback.js`: 面包多 webhook receiver (JSON POST with `type: "charge_succeeded"`), auto-updates VIP and expire date on payment
- **Client-side** (`vip.html`): Single-page modal with QR code generated from `h5_url` via qrserver API, wrapped in tappable link for WeChat payment, polls `/api/check-order` for status
- **Client-side** (`script.js`): Login/register via Supabase REST API, localStorage as offline cache
- Experiments marked as `lock` class with `checkVip()` gate for VIP-only content
- Free experiments use `openLab()` directly

## Payment Flow

User clicks VIP plan → modal shows QR code (generated from 面包多 `h5_url`) → user scans with WeChat or taps link → 面包多 calls `/api/pay-callback` webhook → Supabase order set to `paid` + user VIP/expire updated → frontend polling detects `paid` → modal shows success, updates localStorage.

## Deploy

- **Static site**: Push to `main` → GitHub Pages auto-deploys (or Vercel for combined hosting)
- **API functions**: Connect repo to **Vercel** (`vercel.json` at root), set environment variables:
  - `MBD_APP_ID` - 面包多 app ID
  - `MBD_APP_KEY` - 面包多 app key
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
