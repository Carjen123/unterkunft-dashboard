import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://spbeckfnpmwnzyvdqyqx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_z4-zdbfP4nlt1GLQhHdJrQ_x6fWarw1'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
