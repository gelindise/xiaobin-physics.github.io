-- ============================================================
-- 趣味实验「玩」全攻略 · 解锁码
-- 在 Supabase → SQL Editor 里整段执行一次即可（可重复执行）
--
-- 设计说明：
--   · funexp_codes     ：一张码一行，记录有效期、可绑定设备数、已用次数
--   · funexp_bindings  ：一个码绑定过的设备（换电脑/清缓存会占用一个名额）
--   · 两张表都开启 RLS 且不给任何 policy ⇒ 匿名 key 读写不了，
--     生成、列表、停用、兑换全部经由 /api/proxy-user（服务端 service_role）
--   · 兑换逻辑：码存在 + 未停用 + 未过期 + 还能再绑一台设备 → 绑定并 +1
-- ============================================================

create table if not exists public.funexp_codes (
  id           bigserial primary key,
  code         text not null unique,                -- 形如 FXABCD2345EF（无连字符，展示时加）
  note         text default '',                     -- 备注：发给谁 / 哪一批
  status       text not null default 'active',      -- active / disabled
  device_limit int  not null default 1,             -- 可绑定设备数
  used_count   int  not null default 0,             -- 已绑定设备数
  expires_at   timestamptz,                         -- null = 长期有效
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.funexp_bindings (
  id         bigserial primary key,
  code       text not null,
  device     text not null,
  created_at timestamptz not null default now(),
  unique (code, device)
);

create index if not exists idx_funexp_bindings_code on public.funexp_bindings (code);
create index if not exists idx_funexp_codes_status on public.funexp_codes (status);

alter table public.funexp_codes    enable row level security;
alter table public.funexp_bindings enable row level security;

-- 不创建任何 policy：anon / authenticated 均无法直接读写，只有 service_role 能操作。

-- 可选：查看当前所有码
-- select code, note, status, used_count, device_limit, expires_at, created_at from public.funexp_codes order by created_at desc;

-- ============================================================
-- 章节正文表（硬门禁）
--   · 正文不再以静态文件发布，统一存这里，只有校验过解锁码的请求才能取
--   · payload 形如：{"no":1,"name":"…","icon":"…","items":[…]}（即原 chN.js 的内容）
--   · 仍开启 RLS 且无 policy，只有服务端 service_role 能读
-- ============================================================
create table if not exists public.funexp_chapters (
  chapter    int primary key,
  payload    jsonb not null,
  bytes      int,
  updated_at timestamptz not null default now()
);

alter table public.funexp_chapters enable row level security;

-- 可选：查看哪些章已入库
-- select chapter, bytes, updated_at from public.funexp_chapters order by chapter;
