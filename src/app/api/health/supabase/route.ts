import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const hasKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  if (!url || !hasKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
      },
      { status: 500 }
    )
  }

  try {
    const supabase = await createClient()

    const { error: authError } = await supabase.auth.getSession()

    const tables = ['schools', 'profiles', 'project_teams', 'team_members'] as const
    const tableResults: Record<string, { ok: boolean; count: number | null; error?: string }> = {}

    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })

      if (error) {
        tableResults[table] = { ok: false, count: null, error: error.message }
      } else {
        tableResults[table] = { ok: true, count: count ?? 0 }
      }
    }

    const allTablesOk = Object.values(tableResults).every((t) => t.ok)

    return NextResponse.json({
      ok: !authError && allTablesOk,
      projectUrl: url,
      auth: authError ? { ok: false, error: authError.message } : { ok: true },
      tables: tableResults,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        projectUrl: url,
        error: err instanceof Error ? err.message : 'Unknown connection error',
      },
      { status: 500 }
    )
  }
}
