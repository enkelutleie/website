import { createClient } from "@supabase/supabase-js";
import "./login.css";

const header = document.querySelector("[data-site-header]");
if (header) {
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

const root = document.querySelector("[data-auth]");
if (root) {
  const supabase = createClient(
    "https://ginrgzxyimdmwvnuolgq.supabase.co",
    "sb_publishable_GQvu82usWD_Ynh1su-as9w_KmymXlcf",
    {
      auth: {
        // The OAuth return (?code=… or ?error=…) is handled explicitly below,
        // so a failed exchange is shown instead of silently resetting the page.
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
      },
    },
  );

  const redirectTo = "https://enkelutleie.com/logg-inn/";
  const message = root.querySelector("[data-auth-message]");
  const form = root.querySelector("[data-email-form]");
  const panel = root.querySelector("[data-auth-panel]");

  const say = (text) => {
    if (!message) return;
    message.hidden = !text;
    message.textContent = text ?? "";
  };

  const norwegian = (error) => {
    const raw = error?.message ?? "";
    if (/invalid login credentials/i.test(raw)) return "Feil e-post eller passord.";
    if (/email not confirmed/i.test(raw)) return "E-posten er ikke bekreftet ennå.";
    if (/redirect/i.test(raw)) return "Apple eller Google godtok ikke returadressen. Prøv e-post og passord.";
    if (/code verifier|code challenge|flow state|auth code|pkce/i.test(raw)) {
      return "Innloggingen ble startet i en annen fane eller nettleser, eller den er allerede brukt. Prøv igjen her.";
    }
    if (/access_denied|user_cancelled/i.test(raw)) return "Innloggingen ble avbrutt. Prøv igjen.";
    if (/external code|external provider/i.test(raw)) return "Apple eller Google kunne ikke fullføre innloggingen. Prøv igjen.";
    return "Innloggingen kunne ikke fullføres. Prøv igjen.";
  };

  const accountLabel = (user) => {
    const email = user?.email ?? "";
    if (!email) return null;
    if (/@privaterelay\.appleid\.com$/i.test(email)) return null;
    return email;
  };

  const showSession = (session) => {
    const email = accountLabel(session.user);
    const viaApple = session.user?.app_metadata?.provider === "apple";
    panel.innerHTML = "";
    const title = document.createElement("p");
    title.className = "login-signed-in";
    if (email) {
      title.textContent = `Du er logget inn som ${email}.`;
    } else if (viaApple) {
      title.textContent = "Du er logget inn med Apple (skjult e-post).";
    } else {
      title.textContent = "Du er logget inn.";
    }
    const note = document.createElement("p");
    note.className = "login-note";
    note.textContent = "Webportalen kommer snart. Frem til da bruker du appen.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-login";
    button.textContent = "Logg ut";
    button.addEventListener("click", async () => {
      button.disabled = true;
      await supabase.auth.signOut();
      location.assign("/logg-inn/");
    });
    panel.append(title, note, button);
    panel.classList.add("is-signed-in");
    say("");
  };

  root.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", async () => {
      say("");
      button.disabled = true;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: button.dataset.provider,
        options: { redirectTo },
      });
      if (error) {
        button.disabled = false;
        say(norwegian(error));
      }
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    say("");
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const submit = form.querySelector("button[type=submit]");
    if (submit) submit.disabled = true;
    const { data: result, error } = await supabase.auth.signInWithPassword({ email, password });
    if (submit) submit.disabled = false;
    if (error || !result.session) {
      say(norwegian(error));
      return;
    }
    showSession(result.session);
  });

  // Return from Apple/Google: read ?code= / ?error= (and #error=), then clean the URL.
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const code = query.get("code");
  const returnError =
    query.get("error_description") ?? hash.get("error_description") ?? query.get("error") ?? hash.get("error");

  if (code || returnError || hash.has("access_token")) {
    history.replaceState(history.state, "", location.pathname);
  }

  let shown = false;
  const render = (session) => {
    if (session && !shown) {
      shown = true;
      showSession(session);
    }
  };

  if (returnError) {
    say(norwegian({ message: returnError }));
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) {
      say(norwegian(error));
    } else {
      render(data.session);
    }
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") render(session);
  });

  const { data } = await supabase.auth.getSession();
  render(data.session);
}
