/* Runs before first paint (classic script in <head>). Reads the stored Supabase
   session so the header and protected pages start in the right state without
   flashing. The real session check happens later in src/supabase.js. */
(function () {
  var state = "out";
  try {
    var raw = window.localStorage.getItem("sb-ginrgzxyimdmwvnuolgq-auth-token");
    var session = raw ? JSON.parse(raw) : null;
    if (session && session.refresh_token) state = "in";
  } catch (error) {
    state = "out";
  }
  document.documentElement.setAttribute("data-auth", state);
})();
