#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 private/fun-exp/chN.js 里的正文推进 Supabase（经 /api/proxy-user）。

为什么需要它：
  正文不进仓库、不进静态站点，只存在数据库里，由接口按解锁码下发。
  换了 PDF/Word 源稿重新生成后，重跑本脚本即可覆盖同一章。

用法：
  python3 tools/upload_fun_exp_content.py --base https://你的站点域名 --token 管理员密码
  python3 tools/upload_fun_exp_content.py --base https://xxx.vercel.app --token xxx --only 1,2
  python3 tools/upload_fun_exp_content.py --dry          # 只检查本地文件，不发请求

说明：
  · token 就是后台登录用的管理员密码，只作请求头，不会写进任何文件
  · 逐章上传，单章失败不影响其他章，最后会打印一张“哪些章已入库”的表
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "private", "fun-exp")


def load_chapter(path):
    raw = open(path, encoding="utf-8").read().strip()
    # 形如：(window.FEX_CH = window.FEX_CH || {})[1] = {...};
    marker = "] = "
    idx = raw.find(marker)
    if idx < 0:
        raise ValueError("文件格式不对：%s" % path)
    body = raw[idx + len(marker):].strip()
    if body.endswith(";"):
        body = body[:-1]
    return json.loads(body)


def post(base, token, payload):
    req = urllib.request.Request(
        base.rstrip("/") + "/api/proxy-user",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-admin-token": token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": "HTTP %s" % e.code}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="", help="站点地址，如 https://xxx.vercel.app")
    ap.add_argument("--token", default="", help="后台管理员密码")
    ap.add_argument("--only", default="", help="只传某几章，逗号分隔，如 1,2,18")
    ap.add_argument("--dry", action="store_true", help="只检查本地文件，不发请求")
    args = ap.parse_args()

    if not os.path.isdir(SRC):
        sys.exit("找不到目录 %s，请先运行 tools/build_fun_exp.py" % SRC)

    files = sorted(
        [f for f in os.listdir(SRC) if f.startswith("ch") and f.endswith(".js")],
        key=lambda f: int(f[2:-3]),
    )
    if args.only:
        want = {int(x) for x in args.only.replace("，", ",").split(",") if x.strip()}
        files = [f for f in files if int(f[2:-3]) in want]
    if not files:
        sys.exit("没有可上传的章节文件")

    if not args.dry and (not args.base or not args.token):
        sys.exit("需要 --base 和 --token（加 --dry 可只做本地检查）")

    print("待上传 %d 章：" % len(files))
    ok, fail = [], []
    for f in files:
        no = int(f[2:-3])
        path = os.path.join(SRC, f)
        try:
            payload = load_chapter(path)
        except Exception as e:
            print("  第 %2d 章 解析失败：%s" % (no, e))
            fail.append(no)
            continue
        items = len(payload.get("items") or [])
        size = len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) / 1024
        if args.dry:
            print("  第 %2d 章 %-14s %3d 个实验 %7.1f KB   ✓" % (no, payload.get("name", ""), items, size))
            ok.append(no)
            continue
        status, data = post(args.base, args.token, {
            "action": "importFunExpChapter", "chapter": no, "payload": payload,
        })
        if status == 200 and data.get("success"):
            print("  第 %2d 章 %-14s %3d 个实验 %7.1f KB   ✓ 入库" % (no, payload.get("name", ""), items, size))
            ok.append(no)
        else:
            print("  第 %2d 章 ✗ %s %s" % (no, status, data.get("error", "")))
            fail.append(no)

    print("\n成功 %d 章%s" % (len(ok), ("，失败: " + "、".join("第%d章" % n for n in fail)) if fail else ""))
    if not args.dry:
        print("可回后台检查：后台「🎟 解锁码」页顶部会显示已入库章节数。")


if __name__ == "__main__":
    main()
