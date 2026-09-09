import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const hasKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  if (!url || !hasKey) {
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('schools').select('school_id', { head: true, count: 'exact' }).limit(1)
    return NextResponse.json({ ok: !error })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
