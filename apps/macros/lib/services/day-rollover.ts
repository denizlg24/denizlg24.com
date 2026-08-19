import { sql } from "drizzle-orm"
import { db } from "@/db/connection"

export type DayRolloverResult = {
  usersChecked: number
  usersAdvanced: number
  summaryDaysUpserted: number
}

type DayRolloverRow = {
  users_checked: number
  users_advanced: number
  summary_days_upserted: number
}

export async function finalizeClosedNutritionDays(): Promise<DayRolloverResult> {
  const result = await db.execute<DayRolloverRow>(sql`
    with eligible_users as (
      select
        up."userId",
        up."timezone",
        (now() at time zone up."timezone")::date as today,
        ((now() at time zone up."timezone")::date - 1) as last_closed_date
      from "user_profiles" up
      inner join pg_timezone_names tz on tz.name = up."timezone"
      where ((now() at time zone up."timezone")::date - 1) is not null
    ),
    eligible_dates as (
      select fle."userId", fle."logDate"
      from "food_log_entries" fle
      inner join eligible_users eu on eu."userId" = fle."userId"
      left join "user_day_rollover_states" state
        on state."userId" = fle."userId"
      where fle."logDate" < eu.today
        and (
          state."lastFinalizedLogDate" is null
          or fle."logDate" > state."lastFinalizedLogDate"
          or fle."updatedAt" > state."lastRunAt"
        )
      group by fle."userId", fle."logDate"
    ),
    nutrient_totals as (
      select
        ed."userId",
        ed."logDate",
        flen."nutrientKey",
        sum(flen."amount") as amount
      from eligible_dates ed
      inner join "food_log_entries" fle
        on fle."userId" = ed."userId"
        and fle."logDate" = ed."logDate"
      inner join "food_log_entry_nutrients" flen
        on flen."entryId" = fle."id"
      group by ed."userId", ed."logDate", flen."nutrientKey"
    ),
    summary_rows as (
      select
        ed."userId",
        ed."logDate",
        coalesce(
          jsonb_object_agg(nt."nutrientKey", to_jsonb(nt.amount))
            filter (where nt."nutrientKey" is not null),
          '{}'::jsonb
        ) as nutrients,
        coalesce(sum(nt.amount) filter (where nt."nutrientKey" = 'calories'), 0) as calories,
        coalesce(sum(nt.amount) filter (where nt."nutrientKey" = 'protein'), 0) as protein,
        coalesce(sum(nt.amount) filter (where nt."nutrientKey" = 'carbs'), 0) as carbs,
        coalesce(sum(nt.amount) filter (where nt."nutrientKey" = 'fat'), 0) as fat
      from eligible_dates ed
      left join nutrient_totals nt
        on nt."userId" = ed."userId"
        and nt."logDate" = ed."logDate"
      group by ed."userId", ed."logDate"
    ),
    upserted_summaries as (
      insert into "daily_nutrition_summaries" (
        "userId",
        "logDate",
        "nutrients",
        "calories",
        "protein",
        "carbs",
        "fat",
        "updatedAt"
      )
      select
        "userId",
        "logDate",
        nutrients,
        calories,
        protein,
        carbs,
        fat,
        now()
      from summary_rows
      on conflict ("userId", "logDate") do update set
        "nutrients" = excluded."nutrients",
        "calories" = excluded."calories",
        "protein" = excluded."protein",
        "carbs" = excluded."carbs",
        "fat" = excluded."fat",
        "updatedAt" = excluded."updatedAt"
      returning "userId", "logDate"
    ),
    advanced_states as (
      insert into "user_day_rollover_states" (
        "userId",
        "lastFinalizedLogDate",
        "lastRunAt",
        "updatedAt"
      )
      select
        eu."userId",
        eu.last_closed_date,
        now(),
        now()
      from eligible_users eu
      where exists (
        select 1
        from eligible_dates ed
        where ed."userId" = eu."userId"
      )
      on conflict ("userId") do update set
        "lastFinalizedLogDate" = greatest(
          coalesce(
            "user_day_rollover_states"."lastFinalizedLogDate",
            excluded."lastFinalizedLogDate"
          ),
          excluded."lastFinalizedLogDate"
        ),
        "lastRunAt" = excluded."lastRunAt",
        "updatedAt" = excluded."updatedAt"
      returning "userId"
    )
    select
      (select count(*) from eligible_users)::int as users_checked,
      (select count(*) from advanced_states)::int as users_advanced,
      (select count(*) from upserted_summaries)::int as summary_days_upserted
  `)

  const row = result.rows[0]

  return {
    usersChecked: row?.users_checked ?? 0,
    usersAdvanced: row?.users_advanced ?? 0,
    summaryDaysUpserted: row?.summary_days_upserted ?? 0,
  }
}
