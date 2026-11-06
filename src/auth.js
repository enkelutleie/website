import { supabase, setAuthState } from './supabase.js';
import { initHeader } from './header.js';
import { authReturnURL, passwordIssue, registerAccount, requestPasswordReset, updatePassword, readAuthCallback } from './auth-actions.mjs';
import './login.css';

const header = document.querySelector('[data-site-header]');
if (header) {
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}
initHeader();

const root = document.querySelector('section[data-auth]');
if (root) {
  const panel = root.querySelector('[data-auth-panel]');
  const title = root.querySelector('h1');
  const subtitle = root.querySelector('[data-auth-intro]');
  const recoveryKey = 'eu-web-password-recovery-account';
  let leaving = false;
  let mode = 'signin';
  let working = false;
  let email = '';
  let recoveryAccount = null;

  const storedRecovery = () => { try { return sessionStorage.getItem(recoveryKey); } catch { return null; } };
  const rememberRecovery = (id) => { try { id ? sessionStorage.setItem(recoveryKey, id) : sessionStorage.removeItem(recoveryKey); } catch { /* Current page still works without storage. */ } };
  const say = (text, success = false) => {
    const message = panel.querySelector('[data-auth-message]');
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('is-success', success);
  };
  const friendlyError = (error) => {
    const raw = error?.message ?? '';
    if (/invalid login credentials/i.test(raw)) return 'Feil e-post eller passord.';
    if (/email not confirmed/i.test(raw)) return 'E-posten er ikke bekreftet ennå. Åpne lenken i e-posten før du logger inn.';
    if (/already registered|already been registered/i.test(raw)) return 'Det finnes allerede en konto med denne e-postadressen. Logg inn i stedet.';
    if (/rate.limit|too many|after.*seconds/i.test(raw)) return 'For mange forsøk. Vent litt og prøv igjen.';
    if (/same.password|different.*password/i.test(raw)) return 'Det nye passordet kan ikke være det samme som det tidligere passordet.';
    if (/weak.password|pwned/i.test(raw)) return 'Dette passordet er ikke trygt nok. Velg et annet passord.';
    if (/expired|invalid.*(link|code|token)|code verifier|flow state|pkce/i.test(raw)) return 'Lenken er brukt, utløpt eller åpnet i en annen nettleser. Be om en ny lenke og åpne den i samme nettleser.';
    if (/access_denied|user_cancelled/i.test(raw)) return 'Innloggingen ble avbrutt. Prøv igjen.';
    if (['Passordet er for kort. Velg minst 8 tegn.', 'Passordene er ikke like.', 'Du må godta vilkårene før du oppretter en konto.', 'Skriv inn e-postadressen du bruker i Enkel Utleie.', 'Lenken er utløpt eller ugyldig.'].includes(raw)) return raw;
    return 'Handlingen kunne ikke fullføres. Kontroller internettilkoblingen og prøv igjen.';
  };
  const goToPortal = () => {
    if (leaving) return;
    leaving = true;
    rememberRecovery(null);
    setAuthState(true);
    panel.replaceChildren();
    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.textContent = 'Du er logget inn. Sender deg til Min side …';
    panel.append(note);
    location.replace('/portal/');
  };
  const legalLinks = '<a href="/vilkar/" target="_blank" rel="noopener">vilkårene</a> og <a href="/personvern/" target="_blank" rel="noopener">personvernerklæringen</a>';
  const passwordField = (confirm = false) => `<label for="${confirm ? 'bekreft-passord' : 'passord'}">${confirm ? 'Gjenta passord' : mode === 'reset' ? 'Nytt passord' : 'Passord'}</label><input id="${confirm ? 'bekreft-passord' : 'passord'}" name="${confirm ? 'confirmation' : 'password'}" type="password" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" required ${mode === 'signin' ? '' : 'minlength="8"'} aria-describedby="password-help" />`;
  const render = (next) => {
    mode = next;
    working = false;
    root.classList.remove('is-checking');
    const copy = {
      signin: ['Logg inn', 'Samme konto som i appen. Logg inn med Apple, Google eller e-post.'],
      register: ['Opprett konto', 'Opprett én konto for Enkel Utleie i appen og på nett.'],
      forgot: ['Glemt passord?', 'Skriv inn e-postadressen du bruker i Enkel Utleie.'],
      reset: ['Velg nytt passord', 'Velg et nytt passord for kontoen din.'],
      confirmation: ['Bekreft e-postadressen', 'Åpne lenken i e-posten for å bekrefte kontoen din. Gå deretter tilbake hit og logg inn.'],
    }[mode];
    title.textContent = copy[0];
    subtitle.textContent = copy[1];
    const accountForm = mode === 'signin' || mode === 'register';
    panel.innerHTML = `${accountForm ? '<button class="btn btn-apple" type="button" data-provider="apple">Fortsett med Apple</button><button class="btn btn-google" type="button" data-provider="google">Fortsett med Google</button><p class="login-or">eller</p>' : ''}
      ${mode !== 'confirmation' ? `<form data-email-form method="post">
        ${mode !== 'reset' ? '<label for="epost">E-post</label><input id="epost" name="email" type="email" autocomplete="username" required />' : ''}
        ${mode !== 'forgot' ? passwordField() : ''}
        ${mode === 'register' || mode === 'reset' ? passwordField(true) : ''}
        ${mode !== 'forgot' ? '<p class="password-help" id="password-help">Passordet må ha minst 8 tegn.</p>' : ''}
        ${mode === 'register' ? `<label class="terms-choice"><input name="terms" type="checkbox" required /><span>Jeg godtar ${legalLinks}.</span></label>` : ''}
        ${mode === 'signin' ? '<button class="auth-text-action auth-forgot" type="button" data-mode="forgot">Glemt passord?</button>' : ''}
        <button class="btn" type="submit">${{signin:'Logg inn',register:'Opprett konto',forgot:'Send passordlenke',reset:'Lagre nytt passord'}[mode]}</button>
      </form>` : '<button class="btn" type="button" data-resend>Send bekreftelseslenke på nytt</button>'}
      <p class="login-message" data-auth-message role="status" aria-live="polite" hidden></p>
      ${mode === 'signin' ? `<p class="auth-legal-note">Ved å opprette konto med Apple eller Google godtar du ${legalLinks}.</p><p class="auth-switch">Har du ikke konto? <button type="button" class="auth-text-action" data-mode="register">Opprett konto</button></p>` : '<p class="auth-switch"><button type="button" class="auth-text-action" data-mode="signin">Tilbake til innlogging</button></p>'}`;
    const emailInput = panel.querySelector('[name="email"]');
    if (emailInput) emailInput.value = email;
    if (next === 'reset') {
      // A recovery session must stay on this form on refresh rather than being
      // mistaken for a completed sign-in and redirected to the portal.
      setAuthState(false);
    }
  };
  const run = async (operation) => {
    if (working) return;
    working = true;
    say('');
    panel.setAttribute('aria-busy', 'true');
    const controls = [...panel.querySelectorAll('button, input')];
    controls.forEach(el => { el.disabled = true; });
    try { await operation(); } catch (error) { say(friendlyError(error)); }
    finally { working = false; panel.removeAttribute('aria-busy'); controls.forEach(el => { el.disabled = false; }); }
  };

  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || working) return;
    if (button.dataset.mode) {
      email = panel.querySelector('[name="email"]')?.value.trim() ?? email;
      if (mode === 'reset') {
        await run(async () => {
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          if (error) throw error;
          recoveryAccount = null;
          rememberRecovery(null);
          setAuthState(false);
          render('signin');
        });
      } else render(button.dataset.mode);
      title.focus();
    } else if (button.dataset.provider) {
      if (mode === 'register' && !panel.querySelector('[name="terms"]').checked) {
        say('Du må godta vilkårene før du oppretter en konto.');
        panel.querySelector('[name="terms"]').focus();
        return;
      }
      await run(async () => {
        const { error } = await supabase.auth.signInWithOAuth({ provider: button.dataset.provider, options: { redirectTo: authReturnURL } });
        if (error) throw error;
      });
    } else if (button.hasAttribute('data-resend')) {
      await run(async () => {
        const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authReturnURL } });
        if (error) throw error;
        say('Hvis kontoen venter på bekreftelse, er en ny bekreftelseslenke sendt.', true);
      });
    }
  });

  panel.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form.matches('[data-email-form]') || working) return;
    const data = new FormData(form);
    email = String(data.get('email') ?? email).trim();
    const password = String(data.get('password') ?? '');
    const confirmation = String(data.get('confirmation') ?? '');
    const accepted = data.get('terms') === 'on';
    await run(async () => {
      if (mode === 'forgot') {
        const { error } = await requestPasswordReset(supabase, email);
        if (error) throw error;
        say('Hvis det finnes en konto med denne e-postadressen, er en passordlenke sendt. Åpne lenken i samme nettleser.', true);
      } else if (mode === 'register') {
        const { data, error } = await registerAccount(supabase, { email, password, confirmation, accepted });
        if (error) throw error;
        if (!data.user) throw new Error('Registreringen kunne ikke fullføres.');
        if (data.session) goToPortal();
        else if (data.user?.identities?.length === 0) say('Det finnes allerede en bekreftet konto med denne e-postadressen. Logg inn i stedet.');
        else render('confirmation');
      } else if (mode === 'reset') {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user || user.id !== recoveryAccount) throw new Error('Lenken er utløpt eller ugyldig.');
        const { error } = await updatePassword(supabase, password, confirmation);
        if (error) throw error;
        goToPortal();
      } else {
        const issue = passwordIssue(password);
        if (issue) throw new Error(issue);
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error('Innloggingen kunne ikke fullføres.');
        goToPortal();
      }
    });
  });

  // Capture then remove callback secrets before asynchronous work or rendering.
  const callbackURL = new URL(location.href);
  if (callbackURL.search || callbackURL.hash) history.replaceState(history.state, '', location.pathname);
  render('signin');
  root.classList.add('is-checking');
  await run(async () => {
    const callback = await readAuthCallback(supabase, callbackURL);
    if (callback.error) throw callback.error;
    if (callback.callback) {
      if (!callback.data?.session) throw new Error('Lenken er utløpt eller ugyldig.');
      if (callback.recovery) {
        recoveryAccount = callback.data.session.user.id;
        rememberRecovery(recoveryAccount);
        render('reset');
      } else goToPortal();
    } else {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session) {
        if (storedRecovery() === data.session.user.id) {
          recoveryAccount = data.session.user.id;
          render('reset');
        } else goToPortal();
      } else { rememberRecovery(null); setAuthState(false); }
    }
  });
  root.classList.remove('is-checking');
}
