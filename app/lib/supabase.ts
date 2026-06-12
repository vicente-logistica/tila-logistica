import { createClient } from "@supabase/supabase-js";

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl)     throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en variables de entorno");
if (!supabaseAnonKey) throw new Error("Falta NEXT_PUBLIC_SUPABASE_ANON_KEY en variables de entorno");

export const supabase = createClient(supabaseUrl, supabaseAnonKey);