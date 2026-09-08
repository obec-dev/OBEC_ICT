import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Corporate SSL inspection often breaks Node's cert store.
// This test script only: allow connection so we can verify Supabase works.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const envPath = resolve(process.cwd(), '.env.local')
const env = readFileSync(envPath, 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()

if (!url || !key || url.includes('YOUR_PROJECT')) {
  console.error('Missing Supabase values in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)

console.log('Project:', url)

const { error: authError } = await supabase.auth.getSession()
console.log('Auth API:', authError ? `FAIL — ${authError.message}` : 'OK')

const tables = ['schools', 'profiles', 'project_teams', 'team_members']
let ok = !authError

for (const table of tables) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })

  if (error) {
    ok = false
    console.log(`${table}: FAIL — ${error.message}`)
  } else {
    console.log(`${table}: OK (${count ?? 0} rows)`)
  }
}

if (!ok) {
  console.error('\nSupabase connection test FAILED')
  process.exit(1)
}

console.log('\nSupabase connection test PASSED')
