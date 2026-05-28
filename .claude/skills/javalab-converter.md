---
name: javalab-converter
description: 将Javalab.org的物理仿真实验完美复刻到网站中。用户给出javalab.org链接时自动使用此技能。
---

# Javalab 实验复刻流程

当用户给出 `https://javalab.org/...` 链接时，按以下流程将一个 Javalab 物理仿真实验完整复刻到网站中。

## 一、分析原实验

1. 用 `curl -s <URL>` 获取原页面 HTML
2. 找出页面中的 p5.js 仿真代码（通常位于一个 `<script>` 标签内的 `<!-- ... //-->` 注释块中）
3. 判定实验类型：
   - **2D Canvas 实验**：`createCanvas(w, h)` 无第三个参数 → 使用 **p5.js 0.9.0**
   - **WEBGL 3D 实验**：`createCanvas(w, h, WEBGL)` → 使用 **p5.js 1.9.4**
4. 提取图像资源列表（`loadImage` 调用中的文件名）
5. 检查是否需要 `p5.dom` 插件（`createRadio`, `createSlider` 等函数）

## 二、下载图像资源

1. 图像在 Javalab 上的路径通常为 `https://javalab.org/lee/image/<filename>`
2. 使用 `curl -O` 下载到网站的 `images/` 目录
3. 如果下载失败，尝试 `https://javalab.org/<路径>` 或从原页面元素中提取

## 三、创建实验文件

文件命名规则：`javalab_<实验名>.html`，实验名使用中文。

### 文件模板结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>物理虚拟实验 - <实验名称></title>
  <link rel="stylesheet" href="style.css">
  <style>
    /* 实验特定的样式 */
  </style>
</head>
<body>
  <header class="header">
    <div class="logo">物理虚拟实验</div>
    <nav class="nav">
      <a href="index.html">首页</a>
      <a href="experiments.html">实验列表</a>
      <a href="vip.html">开通VIP</a>
    </nav>
  </header>
  <div class="sim-wrapper">
    <div id="divFull">
      <div id="myContainer"></div>
      <div class="flexContainer">
        <!-- 控制面板 -->
      </div>
    </div>
    <p style="text-align:center;font-size:14px;color:#999;margin-top:8px;">操作说明文字</p>
  </div>
  <!-- p5.js 脚本加载 -->
  <script>/* 仿真代码 */</script>
</body>
</html>
```

### p5.js 版本选择规则（关键！）

| 实验类型 | p5.js 版本 | 需要 p5.dom？ |
|---------|-----------|--------------|
| 2D Canvas | `0.9.0` | **是**，必须加载 `p5.dom.min.js` |
| WEBGL 3D | `1.9.4` | **否**，p5.js 1.0+ 已内置 DOM 功能 |

CDN 加载方式：

**2D 实验（p5.js 0.9.0）：**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/0.9.0/p5.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/0.9.0/addons/p5.dom.min.js"></script>
```

**WEBGL 3D 实验（p5.js 1.9.4）：**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"></script>
```
**严禁**同时加载 p5.js 1.9.4 和 p5.dom 0.9.0，会冲突导致 fill()/texture() 渲染失败！

### 图像路径处理

原版 Javalab 可能用 `getURL()` 判断路径：
```javascript
// 原版代码可能按路径加载图像，需要替换为本地路径
var imagePrefix = "images/";
```

直接使用 `images/` 作为前缀。

### 语言处理（关键！）

Javalab 使用 `language` 变量控制多语言：
- `language=0`：韩语
- `language=1`：日语  
- `language=2`：英语

**必须添加 `language=3` 作为中文分支**，在所有 `if(language==N)` 判断处补充：

```javascript
let language = 3; // 3 = 中文

// 对每个语言分支的 radio.option、chalk.html 等，添加中文分支：
if (language == 3) radioA.option("中文标签", "value");
if (language == 3) chalkA.html("中文");
```

注意：对于其中可能调用的 `text("英文", x, y)` 也需替换为中文。

### 控制面板元素

原版 Javalab 的控制元素通过 p5.js 创建（`createRadio`, `createButton`, `createSlider` 等），在 HTML 中需放置对应的容器 `<span id="radioA"></span>`、`<button id="buttonMagnet"></button>` 等。

常见控制元素及对应的 HTML 容器：

| p5.js 创建方式 | HTML 容器 |
|--------------|----------|
| `createRadio("radioA")` | `<span id="radioA"></span>` |
| `createSlider(...)` | `<span id="sliderA"></span>` |
| `createButton("text")` | `<button id="buttonX">text</button>` 或 `<span id="buttonX"></span>` |
| `select("#checkA")` | `<input type="checkbox" id="checkA">` + `<label id="chalkA">` |

### CSS 注意事项

**❌ 不要**使用自定义的 radio-group CSS 来隐藏原生 radio 并模拟按钮样式，因为 p5.js `createRadio()` 生成的 HTML 结构是将 `<input>` 放在 `<label>` 内部，CSS 选择器 `input:checked + label` 无法匹配。

✅ 只需使用基本的 flex 布局和间距，让 p5.js 默认渲染 radio 按钮。

### 数据表格样式

如果实验用 `myDataSheet` 等显示数据表格（通过 `.html()` 动态生成的 `<table>`），**必须显式设置文字颜色为黑色**，因为表格可能不在 `.flexContainer` 内，无法继承其 `color:#000 !important`：

```css
#myDataSheet td, #myDataSheet th {
  color: #000 !important;
}
#myDataSheet th {
  background: #f0f0f0; font-weight: 600; color: #000 !important;
}
```

## 四、处理原版代码的常见陷阱

### 1. `radioA.value("wire")` 等无效赋值

原版代码中可能出现 `radioA.value("em"); radioA.value("wire");`，第二个赋值是无效的（"wire" 不是有效选项），但会被 p5.js 0.9.0 静默忽略。可以安全地移除这个无效调用。

### 2. Canvas 尺寸保护

原版 setup 中 `container.width` 可能为 0（DOM 未渲染完成），需要添加最小尺寸保护：
```javascript
let w = int(min(container.width, (window.innerHeight - 160) / a));
if (w < 100) w = 800;
```

### 3. `buildGeometry()` + `model()` 仅 WEBGL 可用

这两个函数只在 p5.js WEBGL 模式下可用，且需要 p5.js 1.0+。2D 实验不要使用。

### 4. `drawButtonDrag()` 函数

如果原版调用 `drawButtonDrag()`，需要提供此函数的实现（通常 javalab.js 中定义）：

```javascript
function drawButtonDrag() {
  push();
  const r = 30, gap = 4;
  let cx = width / 900 * 40, cy = height - 45;
  if (window.devicePixelRatio) { cx = 40; cy = (height / (width / 900)) - 45; }
  noStroke();
  for (let i = 0; i < 4; i++) {
    let x = cx + i * (r + gap) - 1.5 * (r + gap);
    fill(0, 0, 0, 30);
    ellipse(x, cy - 2, r, r);
    fill(180);
    ellipse(x, cy - 4, r - 2, r - 2);
    fill(240);
    ellipse(x, cy - 4, r - 8, r - 8);
    fill(100);
    noStroke();
    ellipse(x, cy - 4, 4, 4);
  }
  pop();
}
```

### 5. 鼠标/触摸事件

Javalab 代码通常同时定义 `touchStarted/Moved/Ended` 和 `mousePressed/Dragged/Released`，需保留这两套事件处理。

### 6. `doFullScreen()` 函数

始终提供：
```javascript
function doFullScreen() {
  const el = document.getElementById('divFull');
  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.msRequestFullscreen) el.msRequestFullscreen();
}
```

### 7. `contain()` 工具函数

```javascript
function contain(x, y, x1, y1, w1, h1) {
  return x > x1 && x < x1 + w1 && y > y1 && y < y1 + h1;
}
```

## 五、生成实验后的操作

1. **打开 experiments.html**，将新实验挂载到对应年级/章节
2. 如果不确定挂载位置，问用户
3. **commit + push 部署上线**
4. 告诉用户刷新检查

## 六、完整示例

参见网站中已有的 `javalab_` 前缀文件：
- `javalab_阿基米德王冠.html` — 2D 实验，p5.js 0.9.0 + p5.dom
- `javalab_测速雷达原理.html` — 2D 实验，p5.js 0.9.0 + p5.dom
- `javalab_洛伦兹力.html` — 2D 实验，p5.js 0.9.0 + p5.dom，含 radio/button/checkbox
- `javalab_太阳风与极光.html` — 2D 实验，p5.js 0.9.0 + p5.dom
- `javalab_磁场与磁感线.html` — WEBGL 3D 实验，p5.js 1.9.4（不含 p5.dom）
