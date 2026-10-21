-- =============================================================================
--  AI 协作机体测试 · Supabase 数据库初始化脚本
--  用法：Supabase 控制台 → 左侧 SQL Editor → New query → 粘贴全部内容 → Run
--  可以重复执行，不会报错，也不会清掉已有数据。
--
--  说明（v2.0）：表结构没有变化，v1 时期的 16 型数据和新版 8 机体数据共用这张表。
--  区分方式：survey_version（v2.0 起）和 result_code（M01–M08）。
--  新版匹配信息（profileCode / 并列候选 / 距离）保存在 percents 这个 JSON 列里，
--  路径为 percents.match，不需要新增列，也不需要重跑本脚本。
-- =============================================================================

-- 1) 建表 ---------------------------------------------------------------------
create table if not exists public.ai_personality_responses (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  survey_id       text,
  survey_version  text,
  result_code     text,          -- 新版：M01–M08（内部类别标识，前端不展示）
  result_name     text,          -- 新版：机体中文名，如「机魂总调度」
  scores          jsonb,         -- 四维原始分：{drive, heart, order, role}，范围 -8..8
  percents        jsonb,         -- 四维展示百分比；新版额外带 percents.match 匹配元数据
  answers         jsonb,         -- 每题所选选项下标：{q01: 2, ...}
  answer_detail   jsonb,         -- 每题所选选项的文字与主维度分值
  answered        int,
  total           int,
  duration_ms     int,
  nickname        text,
  user_agent      text,
  referrer        text,
  lang            text,
  screen          text,
  timezone        text
);

comment on table public.ai_personality_responses is 'AI 协作机体测试作答记录（v1 16 型 / v2.0 8 机体共用）';

create index if not exists ai_personality_created_idx on public.ai_personality_responses (created_at desc);
create index if not exists ai_personality_code_idx    on public.ai_personality_responses (result_code);

-- 2) 开启行级安全（RLS）-------------------------------------------------------
alter table public.ai_personality_responses enable row level security;

-- 3) 给匿名访客只开「插入」权限：前端提交答卷用 --------------------------------
drop policy if exists "anon_can_insert" on public.ai_personality_responses;
create policy "anon_can_insert"
  on public.ai_personality_responses
  for insert
  to anon, authenticated
  with check (true);

-- 4) 只有登录用户（= 你自己）能读取和删除 --------------------------------------
drop policy if exists "auth_can_read" on public.ai_personality_responses;
create policy "auth_can_read"
  on public.ai_personality_responses
  for select
  to authenticated
  using (true);

drop policy if exists "auth_can_delete" on public.ai_personality_responses;
create policy "auth_can_delete"
  on public.ai_personality_responses
  for delete
  to authenticated
  using (true);

-- 注意：这里故意不给 anon 开 select。所以即使别人拿到你的 anon key，
--       也只能往表里写数据，看不到任何人的作答内容。
--       查看数据请登录 Supabase 控制台（Table Editor / SQL Editor），前台没有后台入口。

-- 5)（可选）按天统计视图 -------------------------------------------------------
create or replace view public.ai_personality_daily as
select
  date_trunc('day', created_at)::date as day,
  survey_version,
  result_code,
  result_name,
  count(*)                            as responses
from public.ai_personality_responses
group by 1, 2, 3, 4
order by 1 desc, 5 desc;

-- 6)（可选）常用统计 SQL，需要时自己在 SQL Editor 里跑 --------------------------
-- 新版各机体人数：
--   select result_name, count(*) from public.ai_personality_responses
--   where survey_version = 'v2.0'
--   group by 1 order by 2 desc;
-- 四维平均倾向（左侧百分比，>50 偏探索/共情/结构/主导）：
--   select
--     round(avg((percents->'drive'->>'left')::numeric), 1) as drive_left,
--     round(avg((percents->'heart'->>'left')::numeric), 1) as heart_left,
--     round(avg((percents->'order'->>'left')::numeric), 1) as order_left,
--     round(avg((percents->'role'->>'left')::numeric), 1)  as role_left
--   from public.ai_personality_responses where survey_version = 'v2.0';
-- 并列 / 全中性答卷：
--   select created_at, result_name, percents->'match'->>'candidates' as candidates,
--          percents->'match'->>'tie' as tie
--   from public.ai_personality_responses where (percents->'match'->>'tie')::boolean
--   order by created_at desc limit 20;
-- 单题选项分布（示例题 q01）：
--   select answers->>'q01' as option_index, count(*) from public.ai_personality_responses
--   group by 1 order by 2 desc;
-- 最近 20 条：
--   select created_at, survey_version, result_code, result_name, nickname, duration_ms
--   from public.ai_personality_responses order by created_at desc limit 20;

-- 7)（可选）防止同一台设备无限刷数据：改成按 ip 限流需要服务端，
--    简单的做法是定期清理明显重复的短时记录：
--   delete from public.ai_personality_responses a using public.ai_personality_responses b
--   where a.id <> b.id and a.user_agent = b.user_agent
--     and a.duration_ms < 3000 and b.duration_ms < 3000;
