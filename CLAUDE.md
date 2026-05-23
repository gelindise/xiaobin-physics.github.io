# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

- Users stored in `localStorage`, synced with Tencent Docs API (`docs.qq.com/dop-api/v2/docs/...`)
- Experiments marked as `lock` class with `checkVip()` gate for VIP-only content
- Free experiments use `openLab()` directly

## Dev Commands

This is a static site — no build, test, or lint commands. To preview locally, open any `.html` file directly in a browser or serve with:

```bash
python3 -m http.server 8000
```

Deploy by pushing to the `main` branch — GitHub Pages auto-deploys.

## Commit Convention

Commit messages are in Chinese (e.g., `Update script.js`). No strict convention.
