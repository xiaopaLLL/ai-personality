-- =============================================================================
--  AI 人格测试 · Supabase 数据库初始化脚本
--  用法：Supabase 控制台 → 左侧 SQL Editor → New query → 粘贴全部内容 → Run
--  可以重复执行，不会报错，也不会清掉已有数据。
-- =============================================================================

-- 1) 建表 ---------------------------------------------------------------------
create table if not exists public.ai_personality_responses (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  survey_id       text,
  survey_version  text,
  result_code     text,
  result_name     text,
  scores          jsonb,
  percents        jsonb,
  answers         jsonb,
  answer_detail   jsonb,
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

comment on table public.ai_personality_responses is 'AI 人格测试作答记录';

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

-- 4) 只有登录用户（= 你自己的后台账号）能读取和删除 ----------------------------
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

-- 5)（可选）按天统计视图 -------------------------------------------------------
create or replace view public.ai_personality_daily as
select
  date_trunc('day', created_at)::date as day,
  result_code,
  count(*)                            as responses
from public.ai_personality_responses
group by 1, 2
order by 1 desc, 3 desc;

-- 6)（可选）常用统计示例，需要时自己在 SQL Editor 里跑 --------------------------
-- 各类型人数：
--   select result_code, result_name, count(*) from public.ai_personality_responses
--   group by 1,2 order by 3 desc;
-- 每题选项分布（示例题 q01）：
--   select answers->>'q01' as option_index, count(*) from public.ai_personality_responses
--   group by 1 order by 2 desc;
-- 最近 20 条：
--   select created_at, result_code, result_name, nickname, duration_ms
--   from public.ai_personality_responses order by created_at desc limit 20;

-- 7)（可选）防止同一台设备无限刷数据：改成按 ip 限流需要服务端，
--    简单的做法是在后台定期清理明显重复的记录：
--   delete from public.ai_personality_responses a using public.ai_personality_responses b
--   where a.id <> b.id and a.user_agent = b.user_agent
--     and a.duration_ms < 3000 and b.duration_ms < 3000;
