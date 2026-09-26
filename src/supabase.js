import { createClient } from "@supabase/supabase-js";

// The one Supabase client for the website (Production, same project as the app).
// Imported by /logg-inn/, /portal/ and, lazily, by the header's "Logg ut".
export const supabase = createClient(
  "https://jfrorhixjsuomwtjwqla.supabase.co",
  "sb_publishable_26XRJpYFKZBVlotEX-qiMQ_FBGuZCnB",
  {
    auth: {
      // The OAuth return (?code=… or ?error=…) is handled explicitly in
      // src/auth.js, so a failed exchange is shown instead of silently resetting.
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
    },
  },
);

export const setAuthState = (signedIn) => {
  document.documentElement.setAttribute("data-auth", signedIn ? "in" : "out");
};

// Local scope: signing out on the web must not sign the user out of the app.
export const signOut = async () => {
  await supabase.auth.signOut({ scope: "local" });
  setAuthState(false);
};
