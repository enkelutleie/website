import { supabase, setAuthState } from "./supabase.js";
import { initHeader } from "./header.js";
import "./login.css";

const header = document.querySelector("[data-site-header]");
if (header) {
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}
initHeader();

const root = document.querySelector("[data-auth]");
if (root) {
  const redirectTo = "https://enkelutleie.com/logg-inn/";
  const portal = "/portal/";
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

  // Short in-between state, then on to the portal (Apple, Google and e-mail alike).
  let leaving = false;
  const goToPortal = () => {
    if (leaving) return;
    leaving = true;
    setAuthState(true);
    panel.innerHTML = "";
    const note = document.createElement("p");
    note.className = "login-signed-in";
    note.setAttribute("role", "status");
    note.textContent = "Du er logget inn. Sender deg til Min side …";
    panel.append(note);
    location.replace(portal);
  };

  const showForm = () => {
    setAuthState(false);
    root.classList.remove("is-checking");
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
    goToPortal();
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

  if (returnError) {
    showForm();
    say(norwegian({ message: returnError }));
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) {
      showForm();
      say(norwegian(error));
    } else {
      goToPortal();
    }
  }

  if (!leaving) {
    // Already signed in when opening /logg-inn/: go straight to the portal.
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      goToPortal();
    } else {
      showForm();
    }
  }
}
