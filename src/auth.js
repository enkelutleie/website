import { createClient } from "@supabase/supabase-js";

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
        detectSessionInUrl: true,
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
    return "Innloggingen kunne ikke fullføres. Prøv igjen.";
  };

  const showSession = (session) => {
    const email = session.user.email ?? "kontoen din";
    panel.innerHTML = "";
    const title = document.createElement("p");
    title.className = "login-signed-in";
    title.textContent = `Du er logget inn som ${email}.`;
    const note = document.createElement("p");
    note.textContent = "Samme Staging-konto som i appen. Forsiden er uendret.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-login";
    button.textContent = "Logg ut";
    button.addEventListener("click", async () => {
      await supabase.auth.signOut();
      location.assign("/logg-inn/");
    });
    panel.append(title, note, button);
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

  const params = new URLSearchParams(location.search);
  const authError = params.get("error_description");
  if (authError) say(norwegian({ message: authError }));

  const { data } = await supabase.auth.getSession();
  if (data.session) showSession(data.session);
}
