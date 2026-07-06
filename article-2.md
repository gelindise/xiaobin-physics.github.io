# 手把手：从零配置AI编程环境（Mac/Win通用）

> 本文是"AI编程实战"系列第二篇。读完上一篇你已经知道"这件事是可能的"。这一篇，我们把它变成"你能做到的"。
>
> 目标：花30分钟，让你的电脑拥有一个能听懂人话、帮你写代码的AI助手。

---

## 先搞清楚我们要装什么

很多人卡在第一步，是因为搞不清这些工具之间的关系。我用一句话讲清楚：

> **WorkBuddy 是外壳，Claude Code 是大脑，DeepSeek 是大脑里的神经元。**

| 工具 | 比喻 | 你需不需要懂它怎么工作 |
|------|------|------------------------|
| WorkBuddy | 手机壳 | 不需要。装上就行 |
| Claude Code | 手机操作系统 | 不需要。它会自己运作 |
| DeepSeek API | 手机芯片 | 不需要。给钱就能用 |
| GitHub | 云端硬盘 | 会用百度网盘就会用它 |

看明白了吗？**这四个东西你都不需要"学会"。你只需要把它们装好。**

---

## 第一步：安装 WorkBuddy（10分钟）

### WorkBuddy 是什么

WorkBuddy 是一个 Mac 上的 AI 助手外壳程序。它帮你在终端里运行 Claude Code，并管理配置。

### 安装步骤

**1. 打开终端**

按 `Command + 空格`，输入"终端"，回车。

你会看到一个黑色（或白色）的窗口，里面有一行闪烁的光标。这就是终端。别怕，你接下来只需要在里面粘贴命令。

**2. 安装 Homebrew（如果还没有）**

Homebrew 是 Mac 上的软件管理器。先检查有没有装过：

```bash
brew --version
```

如果显示版本号，跳过这一步。如果显示 `command not found`，粘贴以下命令：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

过程中可能会让你输入电脑密码（输入时不显示，正常），然后回车等待。

**3. 安装 Node.js**

```bash
brew install node
```

等它跑完。验证一下：

```bash
node --version
```

应该显示 v18 或更高版本。

**4. 安装 WorkBuddy**

```bash
npm install -g @anthropic-ai/workbuddy
```

等它跑完。验证：

```bash
workbuddy --version
```

显示版本号就成功了。

---

## 第二步：申请 DeepSeek API 密钥（10分钟）

### 为什么用 DeepSeek

Claude Code 本身是一个"对话框架"，它需要一个底层的大模型来实际干活。官方默认用 Anthropic 自家的 Claude 模型，但价格较贵。

DeepSeek 是目前性价比最高的选择：**效果接近 Claude，价格便宜一个数量级**。我三个月花了一百多块，做了156个实验。

### 申请步骤

**1. 注册 DeepSeek 开放平台**

打开浏览器，访问：**platform.deepseek.com**

用手机号注册。不需要企业认证，个人就行。

**2. 充值**

点击左侧菜单"充值"。

**首次充值最低10元**。够你做很多事情了。我三个月做了156个实验，总共才花了一百多。

**3. 创建 API Key**

点击左侧菜单"API Keys" → "创建新的 API Key"。

随便起个名字（比如"我的AI助手"），点击创建。

**立刻复制并保存这个 Key！** 它只显示一次，关闭后就看不到了。

把 Key 粘贴到一个文本文件里先存着，后面要用。

---

## 第三步：配置 Claude Code（5分钟）

### Claude Code 是什么

Claude Code 是 Anthropic 公司推出的命令行 AI 编程工具。你直接在终端里跟它说话，它就能帮你写代码、创建文件、修bug、部署网站。

### 配置步骤

**1. 创建配置文件**

在终端粘贴：

```bash
mkdir -p ~/.claude
```

**2. 写入配置**

创建文件 `~/.claude/settings.json`，内容是：

```json
{
  "model": "deepseek-v4-pro",
  "apiKey": "sk-把你刚才保存的DeepSeek Key粘贴到这里",
  "baseURL": "https://api.deepseek.com"
}
```

> ⚠️ 注意：`sk-` 开头的 Key 要完整粘贴，不要多空格、不要换行。

**3. 设置全局指令（推荐）**

创建文件 `~/.claude/CLAUDE.md`，这是我的全局配置：

```markdown
# Claude Code 全局配置

## 图片识别能力

底层模型（DeepSeek）不具备原生识图能力。遇到任何图片时，必须按以下流程操作：

### 识别流程
1. 禁止直接用 Read 工具读图 — 读到的是二进制乱码
2. 改用 vision 桥接脚本

如果不确定怎么描述提问，使用默认：
node ~/.workbuddy/skills/claude-code-vision/scripts/vision.js "<图片路径>" "请详细描述这张图片"

### 支持的格式
PNG、JPG/JPEG、GIF、WEBP、BMP。图片尺寸需 ≥ 10×10 像素。
```

这个文件告诉 Claude Code 你的偏好和规则。以后每次对话它都会先读这个文件，确保行为一致。

---

## 第四步：创建 GitHub 仓库（5分钟）

### 为什么需要 GitHub

你需要一个地方存放代码，也需要一个网址让别人访问你的网站。

GitHub Pages 提供了**免费的网站托管**——你把代码推上去，它就自动生成一个网址。还能绑定你自己的域名。

### 操作步骤

**1. 注册 GitHub**

打开 **github.com**，用邮箱注册。

用户名建议用英文或拼音（会出现在你的网址里）。

**2. 创建仓库**

点击右上角 "+" → "New repository"。

- Repository name：写 `my-site`（或你喜欢的名字）
- 选 **Public**（公开）
- 勾选 "Add a README file"
- 点击 "Create repository"

**3. 配置SSH（让终端能连接GitHub）**

在终端粘贴以下命令（把邮箱换成你的）：

```bash
ssh-keygen -t ed25519 -C "你的邮箱@example.com"
```

一路回车，不用设密码。

```bash
cat ~/.ssh/id_ed25519.pub
```

复制输出的内容。

回到 GitHub 网页：右上角头像 → Settings → SSH and GPG keys → New SSH key。粘贴进去，保存。

**4. 克隆仓库到本地**

在终端：

```bash
cd ~
git clone git@github.com:你的用户名/my-site.git
cd my-site
```

**5. 开启 GitHub Pages**

在 GitHub 网页上，进入你的仓库 → Settings → Pages。

- Source：选 "Deploy from a branch"
- Branch：选 "main"，文件夹选 "/ (root)"
- 点 Save

几分钟后，你的网站就会出现在 `https://你的用户名.github.io/my-site/`。

---

## 第五步：验证一切正常

现在，在你的项目目录里（`~/my-site/`），在终端输入：

```bash
claude
```

如果一切配置正确，你会进入 Claude Code 的对话界面。

试试输入：

> 帮我创建一个 index.html 文件，显示"你好，这是我的第一个AI网站"，背景白色，文字居中。

等它完成后，提交并推送：

```bash
git add .
git commit -m "第一个页面"
git push
```

一分钟后，打开 `https://你的用户名.github.io/my-site/`，你应该看到那个页面。

**恭喜。你的AI编程环境已经搭建完成。**

---

## 常见问题排查

| 问题 | 解决方法 |
|------|----------|
| `brew: command not found` | Homebrew 没装上，重新执行第一步的安装命令 |
| `node: command not found` | Node.js 没装上，重新 `brew install node` |
| Claude Code 提示 API Key 错误 | 检查 settings.json 里的 Key 是否完整，是否有多余空格 |
| DeepSeek 返回 401 错误 | API Key 过期或余额不足，去 platform.deepseek.com 检查 |
| `git push` 提示权限错误 | SSH Key 没配好，重新执行第四步第3小步 |
| GitHub Pages 不显示 | 等2-3分钟，检查 Settings → Pages 里的 Branch 设置 |

---

## 你现在拥有的能力

完成以上步骤后，你已经可以：

- ✅ 在终端里用中文跟AI对话
- ✅ 让AI帮你创建网页、写代码、修bug
- ✅ 把AI写的代码一键发布到互联网上
- ✅ 所有工具免费或接近免费

下一篇文章，我们将**真正开始做实验**：我会展示完整的对话过程，让你看到我是怎么跟AI说"帮我做一个弹簧中的疏密波实验"的——从第一次对话到最终上线，没有遗漏任何一步。

---

> 下一篇：《从0到1：用AI写出你的第一个物理虚拟实验》
>
> 包含：完整 Prompt 对话实录 + 弹簧从锯齿线到正弦曲线的进化全过程 + 物理模型的迭代调优
>
> 定价：¥19.9

---

*本文由周小彬原创，Claude Code 辅助整理。未经授权禁止转载。*
