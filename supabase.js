import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rpxbsbmwylhyswxcuqiz.supabase.co'
const SUPABASE_KEY = 'sb_publishable_lTYxezkwaRozXF86IpRFqA_e9s7mQG2'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
