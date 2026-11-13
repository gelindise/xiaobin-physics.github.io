# xiaobin-physics.github.io

物理虚拟实验平台 · 线上站点 <https://xiaobinlaoshi.cn/>

## 改动怎么上线

> 本段为 2026-11-13 实测核实的**当前有效链路**。旧的「GitHub Actions 自动同步到香港服务器」说明已失效（workflow 已移除），现改为香港服务器定时从 GitHub 拉取，见文末「香港服务器自动同步」。

```bash
git add -A
git commit -m "说明改了什么"
git push origin main
```

推送目标：`git@github.com:gelindise/xiaobin-physics.github.io.git` 的 `main` 分支。

完整链路：

```
本机改动 → git push origin main
        → GitHub 仓库（代码托管）
        → Vercel 自动构建部署（项目 xiaobin-physics.github.io，含 /api/* 云函数）
        → EdgeOne 边缘节点（根域 CNAME → xiaobinlaoshi.cn.eo.dnse2.com，回源 Vercel）
        → https://xiaobinlaoshi.cn/  学生访问
```

- **只需要 commit + push**，Vercel 约 1 分钟自动上线（实测提交 10:59，线上 11:00 已是新版）。
- EdgeOne 按完整 URL 缓存约 120 秒。改完立即验证可在页面 URL 后加 `?b=随机数` 绕过缓存；全网强刷请用 EdgeOne 控制台「缓存刷新 → 直接删除」。
- **没提交的改动只在本机**，线上不会变。发布前用 `git status --short` 确认该提交的都提交了。

## 其他渠道现状（别再往这些地方推）

| 渠道 | 状态 | 说明 |
| --- | --- | --- |
| Vercel | ✅ 主源站 | 连 GitHub 自动部署，是当前唯一有效的发布目标 |
| EdgeOne | ✅ CDN 边缘 | 只做缓存与加速，不接收代码推送 |
| 香港服务器 `www` | ✅ 自动跟随 GitHub | 2026-11-13 起目录为 git 克隆，服务器每分钟 `git fetch` 一次，有更新自动 `reset --hard`，延迟 ≤1 分钟。见文末 |
| 腾讯云 COS | ❌ 已不作为源站 | EdgeOne 首页缓存对象里残留的 `Server: tencent-cos` 响应头是旧缓存，绕过缓存后源站是 Vercel |
| GitHub Pages | ❌ 未启用 | `xiaobin-physics.github.io` 返回 404，不是发布渠道 |

## 发布后自检

```bash
# 三方内容一致性（本地 / 根域线上 / www 香港）
F=vip.html
printf '本地   '; shasum -a 256 "$F" | cut -c1-16
printf '根域   '; curl -sS "https://xiaobinlaoshi.cn/$F" | shasum -a 256 | cut -c1-16
printf '香港   '; curl -sS --resolve xiaobinlaoshi.cn:443:119.28.92.176 \
                    "https://xiaobinlaoshi.cn/$F" | shasum -a 256 | cut -c1-16

# 确认真实源站（带 query 绕过 EdgeOne 缓存）
curl -sSI "https://xiaobinlaoshi.cn/?b=$RANDOM" | grep -iE 'server|x-vercel|eo-cache'
```

三个 hash 应完全一致；源站应显示 `server: Vercel`。

## 香港服务器自动同步（2026-11-13 起）

香港服务器 `119.28.92.176:/var/www/xiaobin` 现在是 GitHub 仓库的镜像：

```
git push origin main
   ├─→ Vercel 自动构建（秒级）
   └─→ 香港服务器每分钟 git fetch（≤1 分钟）
```

服务器上的组件：

- `/usr/local/bin/xiaobin-sync.sh`：fetch → 比较 HEAD → 有变化才 `reset --hard`
- root 的 crontab：`* * * * * /usr/local/bin/xiaobin-sync.sh >> /var/log/xiaobin-sync.log 2>&1`

想立即同步（不等那一分钟）：

```bash
ssh root@119.28.92.176 /usr/local/bin/xiaobin-sync.sh

# 或在本地 ~/.zshrc 加别名，push 后立刻触发
alias xbdeploy='cd ~/xiaobin-physics.github.io && git push origin main && ssh root@119.28.92.176 /usr/local/bin/xiaobin-sync.sh'
```

注意：

1. **不要在服务器上直接改文件**，下次同步会被 `reset --hard` 覆盖。
2. 被 `.gitignore` 忽略的文件既不上 Vercel 也不到香港；新增 `assets/` 资源后先 `git status` 确认已跟踪。
3. 查看同步日志：`tail -f /var/log/xiaobin-sync.log`。
4. 迁移前的旧目录备份在 `/var/www/xiaobin.pre-git.20261113`，确认稳定后可删除。
