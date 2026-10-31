// App-equivalent validation and Supabase operations, separate from page rendering.
export const authReturnURL = 'https://enkelutleie.com/logg-inn/';
export function passwordIssue(password, confirmation) {
  const length = [...new Intl.Segmenter('nb', { granularity: 'grapheme' }).segment(password)].length;
  if (length < 8) return 'Passordet er for kort. Velg minst 8 tegn.';
  if (confirmation !== undefined && password !== confirmation) return 'Passordene er ikke like.';
  return null;
}
function checkedEmail(email) {
  const value = email.trim();
  if (!value.includes('@')) throw new Error('Skriv inn e-postadressen du bruker i Enkel Utleie.');
  return value;
}
export async function registerAccount(client, { email, password, confirmation, accepted }) {
  if (!accepted) throw new Error('Du må godta vilkårene før du oppretter en konto.');
  const issue = typeof confirmation !== "string" ? "Passordene er ikke like." : passwordIssue(password, confirmation);
  if (issue) throw new Error(issue);
  const normalizedEmail = checkedEmail(email);
  return client.auth.signUp({ email: normalizedEmail, password, options: { emailRedirectTo: authReturnURL } });
}
export async function requestPasswordReset(client, email) {
  const normalizedEmail = checkedEmail(email);
  return client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: authReturnURL });
}
export async function updatePassword(client, password, confirmation) {
  const issue = typeof confirmation !== "string" ? "Passordene er ikke like." : passwordIssue(password, confirmation);
  if (issue) throw new Error(issue);
  return client.auth.updateUser({ password });
}
export async function readAuthCallback(client, url) {
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const error = query.get('error_description') || hash.get('error_description') || query.get('error') || hash.get('error');
  if (error) return { error: new Error(error), callback: true };
  const code = query.get('code');
  if (code) {
    const result = await client.auth.exchangeCodeForSession(code);
    return { ...result, callback: true, recovery: result.data?.redirectType === 'recovery' };
  }
  // Compatibility with email templates using the implicit flow. SDK validates
  // and stores the session; never store URL tokens or trust a flow marker alone.
  if (hash.has('access_token') || hash.has('refresh_token')) {
    if (!hash.get('access_token') || !hash.get('refresh_token')) {
      return { error: new Error('Lenken er utløpt eller ugyldig.'), callback: true };
    }
    const result = await client.auth.setSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') });
    return { ...result, callback: true, recovery: hash.get('type') === 'recovery' };
  }
  return { callback: false, recovery: false };
}
