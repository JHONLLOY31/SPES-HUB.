
/* ==========================================
   SPES HUB - SUPABASE CONNECTION
========================================== */

const SUPABASE_URL =
  "https://lxyyhhwjiucmziuzzohd.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_FMM4oygPbtCQ_MJVka9xwQ_e3W1GNGa";

// Check Supabase library
if (!window.supabase) {
  throw new Error(
    "Supabase library was not loaded. Check index.html."
  );
}

// Prevent duplicate initialization
if (!window.supabaseClient) {

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    }
  );

  console.log("SPES Hub: Supabase client initialized!");

} else {
  console.log("SPES Hub: Supabase client already initialized!");
}
