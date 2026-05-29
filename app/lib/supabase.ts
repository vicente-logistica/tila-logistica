import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://imbtepvdscdtpxkleihi.supabase.co";
const supabaseAnonKey = "sb_publishable_rpOk0QmsJhg-QsngXIE91w_bqHzl7hQ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);