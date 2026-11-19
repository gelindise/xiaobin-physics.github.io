#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《趣味物理实验“玩”全攻略》docx 解析成网站用的结构化数据。

输出：
  assets/fun-exp/meta.js   章节 + 全部实验索引（公开，目录用）
  assets/fun-exp/img/      文档内图片（公开，正文素材）
  private/fun-exp/ch1.js…  每章正文（★ 不随站点发布，git 已忽略；
                           用 tools/upload_fun_exp_content.py 推进 Supabase）

用法：
  python3 tools/build_fun_exp.py "/path/to/攻略.docx"
"""
import os
import re
import sys
import json
import html
import hashlib
import zipfile
from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.text.hyperlink import Hyperlink

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fun-exp")
IMG_OUT = os.path.join(OUT, "img")
# 正文不进公开目录：解锁后由 /api/proxy-user 按码下发
CH_OUT = os.path.join(ROOT, "private", "fun-exp")

CHAPTERS = [
    (1, "机械运动探秘局", "🚂", "用一张纸币、一块黑板、一段手机视频，把参照物、速度、反应时间讲透。"),
    (2, "声现象指挥部", "🔊", "让声音“看得见”：激光跳舞、盐粒起舞、真空消声、吸管变声器。"),
    (3, "物态变化魔术社", "❄️", "热熔胶、气球河豚、热水重沸，把熔化、汽化、液化变成课堂魔术。"),
    (4, "光现象幻影组", "🌈", "小孔成像、镜子魔术、水中藏钞、喷雾彩虹，光路一走学生就懂了。"),
    (5, "透镜特战基地", "🔍", "让女孩转身、哪吒转向、手机放电影，凸透镜成像规律一次演完。"),
    (6, "质量密度解谜社", "⚖️", "估测教室空气、判断金元宝真假、测食用油密度，密度不再是公式。"),
    (7, "力学法则挑战赛", "🧲", "看见微小形变、托下巴举不起来、易拉罐稳如泰山，力的作用全在现场。"),
    (8, "运动力破译中心", "🏃", "抽纸币、转鸡蛋、抽桌布，惯性这件事，一动手就忘不掉。"),
    (9, "压强暗战实验室", "💨", "口香糖开椰子、手掌碎大石、托里拆利、隔空取水，大气压最能震场。"),
    (10, "浮力拯救行动", "🛶", "会跳舞的玉米粒、垃圾袋热气球、最简密度计，浮沉条件看得见。"),
    (11, "功和机械能", "🎢", "反重力双锥体、回滚瓶、矿泉水自动关门器，能量转化全程可见。"),
    (12, "简单机械创客营", "🏗️", "自制杆秤、徒手掰苹果、三人抬石头，杠杆和滑轮都能上手。"),
    (13, "内能", "🔥", "烧不爆的气球、瓶盖飞天、口罩绳锯笔杆，内能变化有证据。"),
    (14, "内能的利用", "🚗", "脉动瓶热机、易拉罐蒸汽转轮、自制冲击火箭，热机原理一课搞定。"),
    (15, "电荷特工局", "⚡", "气球悬浮、塑料丝飞天、自制莱顿瓶，静电现象一次看够。"),
    (16, "电压电阻", "🔌", "粒子大闯关、铅笔划线导电，把抽象的电阻变得具体。"),
    (17, "欧姆定律", "📐", "电流、电压、电阻三者的关系，用实验和虚拟沙盒一起验证。"),
    (18, "电能特种兵", "💡", "铅笔芯点亮、火柴点火赛，电流热效应在眼前发生。"),
    (19, "家庭电路卫队", "🏠", "短路、保险、用电安全，家里那点电学知识必须讲明白。"),
    (20, "电磁情报局", "🧭", "硬币叠罗汉、泡面桶扬声器、磁铁慢落，电与磁的暗战开打。"),
]

ICONS = [
    (("目标", "目的", "定位"), "🎯"),
    (("难度",), "📊"),
    (("材料", "器材", "清单", "准备", "工具"), "🧰"),
    (("过程", "步骤", "操作", "玩法", "做法"), "🪄"),
    (("原理", "解释", "揭秘", "科学", "推导"), "🧠"),
    (("现象", "观察", "记录"), "👀"),
    (("应用", "生活", "用途"), "🌍"),
    (("进阶", "拓展", "延伸", "创意", "挑战", "思考", "讨论"), "🚀"),
    (("注意", "安全", "提示", "贴士", "提醒"), "⚠️"),
    (("总结", "结论", "评价", "反思"), "✅"),
    (("图片", "二维码", "视频"), "🎬"),
]

CN_NUM = "一二三四五六七八九十"
SEC_PAT = re.compile(r"^([（(][%s]{1,3}[）)])|^([%s]{1,3}\s*[、.．])" % (CN_NUM, CN_NUM))
NUM_PAT = re.compile(r"^\d{1,2}\s*[、.．]\s*")
STEP_PAT = re.compile(r"^(?:\d{1,2}\s*[、.．]\s*)?第[%s]+(?:步|层|部分|环节)" % CN_NUM)
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮"
BULLET_CHARS = "•·●○▲★※"
EXP_HEAD = re.compile(r"^(\d{1,2}(?:\s*\.\s*\d{1,2})*)\s*[：:.．、]?\s*(.*)$")
EMOJI_RE = re.compile(r"^[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200d\s]+")

MATERIAL_KEYS = ("实验材料", "材料", "实验器材", "器材", "材料准备", "工具")

NOISE_PAT = re.compile(r"(根据要求优化|优化改写|以下是根据要求|下面是优化后)")

# 原文档里的钉钉附件 → 站内已有页面
ATTACH_MAP = {
    "声音的特性.html": "声音的特性立体模型.html",
    "声音的音调_交互实验.html": "瓶子的音调.html",
    "4、瓶子音调的奥妙.html": "瓶子的音调.html",
    "5、探究弦的音调奥秘.html": "弦上的驻波立体模型.html",
    "8、小孔成像.html": "小孔成像立体模型.html",
    "2、光的折射.html": "光的折射规律.html",
    "6、探究凸透镜成像规律.html": "探究凸透镜成像规律2.html",
    "牛顿第一定律_交互实验 (1).html": "牛顿第一定律_交互实验.html",
    "7、电阻的微观解释.html": "电阻的微观解释.html",
}
ATTACH_PAT = re.compile(r"请[至到]钉钉文档查看附件《(.+?)》")


def norm(t):
    t = t.replace("\u00a0", " ").replace("\u200b", "")
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()


def esc(t):
    return html.escape(t, quote=False)


URL_RE = re.compile(r"(https?://[^\s，。；、）)\"']+)")


def linkify(text):
    return URL_RE.sub(lambda m: '<a href="%s" target="_blank" rel="noopener">%s</a>' % (m.group(1), m.group(1)), text)


def inline_html(par):
    parts = []
    for item in par.iter_inner_content():
        if isinstance(item, Hyperlink):
            url = item.url or ""
            txt = esc(norm(item.text))
            parts.append('<a href="%s" target="_blank" rel="noopener">%s</a>' % (esc(url), txt) if url else txt)
            continue
        if not item.text:
            continue
        t = linkify(esc(item.text.replace("\u00a0", " ")))
        if item.bold:
            t = "<strong>%s</strong>" % t
        if item.italic:
            t = "<em>%s</em>" % t
        parts.append(t)
    out = "".join(parts)
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


def section_icon(title):
    for keys, ico in ICONS:
        if any(k in title for k in keys):
            return ico
    return "📌"


def clean_title(raw):
    """去掉序号、emoji、结尾冒号，返回 (icon, title)。"""
    t = norm(raw)
    icon = ""
    m = EMOJI_RE.match(t)
    if m:
        icon = m.group(0).strip()
        t = t[m.end():]
    t = SEC_PAT.sub("", t)
    t = NUM_PAT.sub("", t)
    t = t.strip(" ：:、.．")
    t = re.sub(r"\s{2,}", " ", t)
    return icon, t


def split_label(t):
    if re.match(r"^(https?:|//)", t, re.I):
        return None, t
    m = re.match(r"^([^：:]{2,14})[：:]\s*(.*)$", t, re.S)
    if not m:
        return None, t
    label, rest = m.group(1).strip(), m.group(2).strip()
    if any(ch in label for ch in "。！？，、/.") or re.search(r"\d", label) and "第" not in label:
        return None, t
    return label, rest


def strip_prefix_html(h, n):
    """从 HTML 开头删掉 n 个可见字符（跨标签安全）。"""
    out, removed, i, in_tag = [], 0, 0, False
    while i < len(h) and removed < n:
        ch = h[i]
        if ch == "<":
            in_tag = True
            out.append(ch)
        elif ch == ">":
            in_tag = False
            out.append(ch)
        elif in_tag:
            out.append(ch)
        else:
            removed += 1
        i += 1
    return "".join(out) + h[i:]


def is_bullet(par, text):
    pPr = par._p.pPr
    if pPr is not None and pPr.numPr is not None:
        return True
    style = par.style.name if par.style is not None else ""
    if style == "钉钉文档引用":
        return True
    if text[:1] in BULLET_CHARS:
        return True
    if text[:1] in CIRCLED:
        return True
    return False


def strip_bullet_html(h):
    h = re.sub(r"^[%s]\s*" % BULLET_CHARS, "", h)
    if h[:1] in CIRCLED:
        h = h[1:].lstrip()
    m = NUM_PAT.match(re.sub(r"<[^>]+>", "", h))
    if m:
        h = strip_prefix_html(h, len(m.group(0)))
    return h.strip()


class Builder:
    def __init__(self, path):
        self.doc = Document(path)

    def iter_blocks(self):
        for child in self.doc.element.body.iterchildren():
            if child.tag == qn("w:p"):
                yield "p", Paragraph(child, self.doc)
            elif child.tag == qn("w:tbl"):
                yield "tbl", Table(child, self.doc)

    def save_image(self, par):
        outs = []
        for blip in par._p.findall(".//" + qn("a:blip")):
            rid = blip.get(qn("r:embed"))
            if not rid or rid not in par.part.rels:
                continue
            part = par.part.rels[rid].target_part
            blob = part.blob
            ext = os.path.splitext(str(part.partname))[1] or ".png"
            tag = "qr" if self._is_qr(blob) else "photo"
            name = hashlib.md5(blob).hexdigest()[:10] + ext
            path = os.path.join(IMG_OUT, name)
            if not os.path.exists(path):
                os.makedirs(IMG_OUT, exist_ok=True)
                with open(path, "wb") as f:
                    f.write(blob)
            outs.append(("assets/fun-exp/img/" + name, tag))
        return outs

    @staticmethod
    def _is_qr(blob):
        try:
            from PIL import Image
            import io
            im = Image.open(io.BytesIO(blob))
            w, h = im.size
            return abs(w - h) <= 6 and w <= 520
        except Exception:
            return False

    def classify(self, par):
        style = par.style.name if par.style is not None else ""
        text = norm(par.text)
        ph = inline_html(par)

        if not text:
            return None

        if style in ("Heading 1", "Heading 2"):
            icon, title = clean_title(text)
            return {"kind": "h2", "text": title, "icon": icon, "html": esc(title)}
        if style == "Heading 3":
            icon, title = clean_title(text)
            return {"kind": "h3", "text": title, "icon": icon, "html": esc(title)}
        if style == "Heading 4":
            icon, title = clean_title(text)
            return {"kind": "h4", "text": title, "icon": icon, "html": esc(title)}

        # 列表项优先判断（避免“•电路搭建：”被当成小节）
        if is_bullet(par, text):
            item = strip_bullet_html(ph)
            plain = re.sub(r"<[^>]+>", "", item).strip()
            kind = "li"
            if plain and len(plain) <= 14 and plain.endswith(("：", ":")):
                kind = "li_step"
            return {"kind": kind, "text": plain, "html": item}

        # 一、实验原理 / （一）核心材料
        if SEC_PAT.match(text):
            icon, title = clean_title(text)
            if title:
                kind = "h4" if re.match(r"^[（(]", text) else "h3"
                return {"kind": kind, "text": title, "icon": icon, "html": esc(title)}

        # 普通编号条目 1、…… （无正文内容时视为小标题）
        m = NUM_PAT.match(text)
        if m and len(text) > 4:
            rest = text[m.end():].strip()
            if rest and rest.endswith(("：", ":")) and len(rest) <= 16:
                return {"kind": "h4", "text": rest.rstrip("：:"), "icon": "", "html": esc(rest.rstrip("：:"))}
            html_item = strip_bullet_html(ph)
            plain = re.sub(r"<[^>]+>", "", html_item).strip()
            kind = "li"
            if plain and len(plain) <= 14 and plain.endswith(("：", ":")):
                kind = "li_step"
            return {"kind": kind, "text": plain, "html": html_item}

        # 1. 第一步：……
        if STEP_PAT.match(text):
            icon, title = clean_title(text)
            return {"kind": "h4", "text": title, "icon": icon, "html": esc(title)}

        label, rest = split_label(text)
        if label and not rest and len(label) <= 20:
            icon, title = clean_title(label)
            if title:
                return {"kind": "h3", "text": title, "icon": icon, "html": esc(title)}

        if label and rest:
            rest_html = strip_prefix_html(ph, len(label) + 1).lstrip()
            return {"kind": "p", "text": text, "html": ph, "label": label, "rest_html": rest_html}

        return {"kind": "p", "text": text, "html": ph}


def table_html(tbl):
    rows, plain_rows = [], []
    for r_i, row in enumerate(tbl.rows):
        cells, plain = [], []
        for cell in row.cells:
            txt = " ".join(norm(p.text) for p in cell.paragraphs if norm(p.text))
            tag = "th" if r_i == 0 else "td"
            cells.append("<%s>%s</%s>" % (tag, linkify(esc(txt)), tag))
            plain.append(txt)
        rows.append("<tr>%s</tr>" % "".join(cells))
        plain_rows.append(plain)
    html = '<div class="fx-table-wrap"><table class="fx-table">%s</table></div>' % "".join(rows)
    return html, plain_rows


BIG_KEYS = ("实验目标", "实验目的", "实验材料", "实验步骤", "实验过程", "实验原理", "原理解释",
            "实验现象", "生活应用", "注意事项", "思考进阶", "实验准备", "玩法", "原理揭秘",
            "安全提示", "操作步骤")


BIG_LABEL = set(BIG_KEYS)
SMALL_LABEL = {"设计来源", "适用年级", "实验目标", "实验目的", "教学对象", "课时建议", "材料清单",
               "器材清单", "实验器材", "实验难点", "重点难点", "教学建议", "课堂建议", "拓展延伸",
               "思维拓展", "学生活动", "教师演示", "演示流程", "观察要点", "科学原理", "生活应用",
               "思考题", "安全提醒", "安全提示", "参考资料", "参考视频", "视频链接", "实验背景",
               "设计思路", "创意来源", "玩法说明", "评分标准", "评价方式", "现象观察", "课堂实录",
               "操作提示", "注意事项", "实验准备", "玩法", "原理揭秘", "思考进阶"}


def postprocess(blocks):
    """把文档里挤成普通段落的标签和条目还原成小标题与列表。"""
    for b in blocks:
        if b["kind"] != "p":
            continue
        t = b.get("text", "").strip()
        if not t:
            continue
        core = t.rstrip("：:").strip()
        if core in BIG_LABEL and len(core) <= 10:
            b["kind"], b["text"], b["html"] = "h3", core, esc(core)
        elif core in SMALL_LABEL and len(core) <= 12:
            b["kind"], b["text"], b["html"] = "h4", core, esc(core)

    def itemish(b):
        if b["kind"] != "p":
            return False
        t = b.get("text", "").strip()
        if not t or len(t) > 46:
            return False
        if t.endswith(("。", "！", "？", "!", "?")):
            return False
        core = t.rstrip("：:").strip()
        if core in BIG_LABEL or core in SMALL_LABEL:
            return False
        if len(t) <= 9 and "：" not in t:
            return False
        if re.match(r"^[一二三四五六七八九十]+、", t) or re.match(r"^[（(][一二三四五六七八九十]+[）)]", t):
            return False
        return True

    i = 0
    while i < len(blocks):
        if itemish(blocks[i]):
            j = i
            while j < len(blocks) and itemish(blocks[j]):
                j += 1
            prev = blocks[i - 1] if i > 0 else None
            if j - i >= 2 or (prev and prev["kind"] in ("h3", "h4")):
                for k in range(i, j):
                    blocks[k]["kind"] = "li"
            i = j
        else:
            i += 1
    return blocks


def render(blocks, prefix):
    out, sections = [], []
    list_buf = []

    def flush():
        if list_buf:
            out.append('<ul class="fx-list">%s</ul>' % "".join(list_buf))
            list_buf.clear()

    for b in blocks:
        kind = b["kind"]
        if kind in ("li", "li_step"):
            list_buf.append('<li%s>%s</li>' % (' class="fx-sub"' if kind == "li_step" else "", b["html"]))
            continue
        flush()

        if kind == "h3":
            sid = "%s-s%d" % (prefix, len(sections) + 1)
            title = b["text"]
            main, sub = title, ""
            for sep in ("：", "——"):
                if sep in title:
                    a, bb = title.split(sep, 1)
                    if a.strip():
                        main, sub = a.strip(), bb.strip()[:36]
                        break
            icon = b.get("icon") or section_icon(main)
            if not any(x["title"] == main for x in sections):
                sections.append({"id": sid, "title": main, "icon": icon})
            out.append('<h3 class="fx-sec" id="%s"><span class="fx-ico">%s</span><span>%s</span>%s</h3>'
                       % (sid, icon, linkify(esc(main)),
                          ('<em class="fx-sec-sub">%s</em>' % linkify(esc(sub))) if sub else ""))
        elif kind == "h4":
            icon = b.get("icon") or "▸"
            out.append('<h4 class="fx-sub">%s<span>%s</span></h4>' % (icon, linkify(esc(b["text"]))))
        elif kind == "h2":
            out.append('<h3 class="fx-sec"><span class="fx-ico">📌</span><span>%s</span></h3>'
                       % linkify(esc(b["text"])))
        elif kind == "table":
            out.append(b["html"])
        elif kind == "html":
            out.append(b["html"])
        else:
            if b.get("label") and b.get("rest_html"):
                label = b["label"].strip()
                if label in BIG_KEYS and len(label) <= 8:
                    sid = "%s-s%d" % (prefix, len(sections) + 1)
                    icon = section_icon(label)
                    if not any(x["title"] == label for x in sections):
                        sections.append({"id": sid, "title": label, "icon": icon})
                    out.append('<h3 class="fx-sec" id="%s"><span class="fx-ico">%s</span><span>%s</span></h3>'
                               % (sid, icon, esc(label)))
                    out.append('<p class="fx-p">%s</p>' % b["rest_html"])
                else:
                    out.append('<p class="fx-p fx-key"><strong>%s：</strong>%s</p>'
                               % (esc(b["label"]), b["rest_html"]))
            else:
                out.append('<p class="fx-p">%s</p>' % b["html"])
    flush()
    return "".join(out), sections


def parse(path, verbose=False):
    b = Builder(path)
    exps, cur = [], None

    for typ, obj in b.iter_blocks():
        if typ == "tbl":
            if cur is not None:
                html_tbl, cells = table_html(obj)
                cur["blocks"].append({"kind": "table", "html": html_tbl, "text": "", "cells": cells})
            continue

        style = obj.style.name if obj.style is not None else ""
        text = norm(obj.text)

        if style in ("Heading 1", "Heading 4") and re.match(r"^第[%s]+章" % CN_NUM, text):
            continue

        if style == "Heading 2":
            m = EXP_HEAD.match(text)
            if m and m.group(2):
                num = re.sub(r"\s+", "", m.group(1))
                title = re.sub(r"^实验名称[：:]\s*", "", m.group(2)).strip(" ：:、")
                cur = {"num": num, "title": title, "blocks": []}
                exps.append(cur)
            else:
                cur = None
            continue

        if style == "Heading 1":
            cur = None
            continue

        if cur is None:
            continue
        for im in b.save_image(obj):
            url, tag = im
            cur["blocks"].append({"kind": "html", "html":
                '<figure class="fx-fig %s"><img src="%s" alt="实验配图" loading="lazy"></figure>' % (tag, url)})

        m_att = ATTACH_PAT.search(text)
        if m_att:
            name = m_att.group(1).strip()
            url = ATTACH_MAP.get(name)
            friendly = re.sub(r"\.(html?|docx)$", "", name, flags=re.I)
            friendly = re.sub(r"^\d+、", "", friendly)
            friendly = re.sub(r"\s*\(\d+\)$", "", friendly)
            if url:
                cur["blocks"].append({"kind": "html", "html":
                    '<div class="fx-attach"><span>🧩 配套互动资源</span>'
                    '<a href="%s" target="_blank" rel="noopener">打开《%s》 →</a></div>'
                    % (esc(url), esc(friendly))})
            else:
                cur["blocks"].append({"kind": "html", "html":
                    '<div class="fx-attach ghost"><span>📎 原始附件</span>《%s》（随原始文档提供）</div>'
                    % esc(friendly)})
            continue

        blk = b.classify(obj)
        if blk is None:
            continue
        if NOISE_PAT.search(blk.get("text", "")) or blk.get("text") == cur["title"]:
            continue
        cur["blocks"].append(blk)

    # ---- 后处理：抽难度 / 材料 ----
    chapters = {no: {"no": no, "name": name, "icon": icon, "desc": desc, "items": []}
                for no, name, icon, desc in CHAPTERS}
    seen = {}

    for e in exps:
        blocks = e["blocks"]
        diff_text, material = "", ""

        i = 0
        kept = []
        while i < len(blocks):
            blk = blocks[i]
            title = blk.get("text", "")
            core = re.sub(r"（.*?）", "", title).replace(" ", "")

            # 小节标题形式的“难度”＋下一段说明
            if blk["kind"] == "h3" and core in ("难度", "实验难度"):
                if i + 1 < len(blocks) and blocks[i + 1]["kind"] in ("p", "li", "li_step"):
                    diff_text = blocks[i + 1].get("text", "")
                    i += 2
                    continue
                i += 1
                continue

            # 任何一行“实验难度：⭐⭐⭐（…）”
            if not diff_text:
                m = re.match(r"^(实验难度|难度)[：:]\s*(.*)$", title)
                if m:
                    diff_text = m.group(2)
                    i += 1
                    continue

            # 任何一行“实验材料：……”
            if blk.get("label") and not material:
                lb = blk["label"].replace(" ", "")
                rest = re.sub(r"<[^>]+>", "", blk.get("rest_html", ""))
                if lb in MATERIAL_KEYS and rest and len(rest) <= 100:
                    material = rest
                    i += 1
                    continue

            # 材料小节：后面跟表格或前三条短文本
            if blk["kind"] == "h3" and any(k in core for k in ("实验材料", "材料清单", "实验器材")) and not material:
                j = i + 1
                if j < len(blocks) and blocks[j]["kind"] == "table":
                    cells = blocks[j].get("cells", [])
                    col = [row[0] for row in cells[1:] if row and row[0]]
                    if col:
                        material = "、".join(col[:6])[:80]
                else:
                    parts = []
                    j = i + 1
                    while j < len(blocks) and blocks[j]["kind"] != "h3" and len(parts) < 3:
                        t = blocks[j].get("text", "")
                        if t and len(t) <= 40 and blocks[j]["kind"] in ("li", "li_step", "p"):
                            parts.append(t)
                        j += 1
                    if parts:
                        material = "、".join(parts)[:80]

            kept.append(blk)
            i += 1
        e["blocks"] = kept

        stars = diff_text.count("⭐")
        if not stars:
            stars = 3 if re.search(r"(高难|复杂|较难|难)", diff_text) else (
                2 if re.search(r"(中等|适中|中)", diff_text) else (1 if diff_text else 0))
        e["diff"] = max(0, min(stars, 3))
        e["material"] = material.strip()

        ch = 0
        m = re.match(r"^(\d{1,2})", e["num"])
        if m:
            ch = int(m.group(1))
        if not (1 <= ch <= 20):
            ch = 1
        e["ch"] = ch

        base = "e-" + e["num"].replace(".", "-")
        seen[base] = seen.get(base, 0) + 1
        e["id"] = base if seen[base] == 1 else "%s-%d" % (base, seen[base])

        postprocess(e["blocks"])
        html_body, sections = render(e["blocks"], e["id"])
        e["html"] = html_body
        e["sections"] = sections
        plain = re.sub(r"<[^>]+>", "", html_body)
        e["digest"] = re.sub(r"\s+", " ", plain)[:60]
        chapters[ch]["items"].append(e)

    # ---- 写出 ----
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CH_OUT, exist_ok=True)
    meta_ch, index, total = [], [], 0

    for no in sorted(chapters):
        c = chapters[no]
        c["items"].sort(key=lambda e: [int(x) for x in re.findall(r"\d+", e["num"])])
        if not c["items"]:
            continue
        full = "第%s章 %s" % (num_to_cn(no), c["name"])
        meta_ch.append({"no": no, "id": "ch%d" % no, "name": c["name"], "full": full,
                        "icon": c["icon"], "desc": c["desc"], "count": len(c["items"])})
        total += len(c["items"])
        for e in c["items"]:
            index.append({"id": e["id"], "ch": no, "num": e["num"], "title": e["title"],
                          "diff": e["diff"], "material": e["material"], "digest": e["digest"]})

        payload = {"no": no, "name": c["name"], "icon": c["icon"],
                   "items": [{"id": e["id"], "num": e["num"], "title": e["title"],
                              "diff": e["diff"], "material": e["material"],
                              "html": e["html"], "sections": e["sections"]} for e in c["items"]]}
        with open(os.path.join(CH_OUT, "ch%d.js" % no), "w", encoding="utf-8") as f:
            f.write("(window.FEX_CH = window.FEX_CH || {})[%d] = " % no)
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";\n")

    with open(os.path.join(OUT, "meta.js"), "w", encoding="utf-8") as f:
        f.write("window.FEX_META = ")
        json.dump({"total": total, "chapters": meta_ch, "index": index},
                  f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    if verbose:
        print("实验总数:", total)
        for mc in meta_ch:
            print(mc["full"], mc["count"])
        print("目录/索引:", OUT)
        print("正文（不发布）:", CH_OUT)


def num_to_cn(n):
    names = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
             "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"]
    return names[n] if n <= 20 else str(n)


if __name__ == "__main__":
    p = sys.argv[1] if len(sys.argv) > 1 else "/Users/zhouxiaobin/Downloads/_趣味物理实验“玩”全攻略 (3).docx"
    parse(p, verbose=True)
