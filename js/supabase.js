const SUPABASE_URL = "https://dacboefvooxgsngxkavx.supabase.co";

const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhY2JvZWZ2b294Z3NuZ3hrYXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTc4MjEsImV4cCI6MjA5OTg3MzgyMX0.xiLcmTG8YUaBKlqjYtigvltFD-N2q14LSvkM4AKWY38";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

window.supabaseClient = supabaseClient;

console.log("✅ Supabase connected");

// A short-lived PKCE client keeps its verifier in the installed app's memory.
// It never refreshes or persists its temporary session alongside the main client.
window.createGooglePopupClient = function () {
    var values = Object.create(null);
    var storage = {
        getItem: function (key) { return values[key] || null; },
        setItem: function (key, value) { values[key] = value; },
        removeItem: function (key) { delete values[key]; }
    };
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { flowType: 'pkce', detectSessionInUrl: false,
            autoRefreshToken: false, persistSession: true, storage: storage,
            storageKey: 'detectlab-google-popup' }
    });
};
