// Godta invitasjon som med-utleier (lik iOS #1587, TENANCY_INVITATION_SHARED_ACCEPT_ANDROID_PARITY).
// Under Prod-last kan accept_property_co_landlord_invitation_by_id få statement timeout (57014),
// og da rulles hele kallet tilbake. Derfor:
// 1. Én pågående godta per invitasjon i hele portalen. Et nytt trykk eller en ny tegning av kortet
//    venter på samme kall og får samme svar.
// 2. Ved forbigående feil (57014, 40001, 40P01, 55P03, HTTP 5xx, brutt forbindelse) prøves det én
//    gang til etter ca. 1,2 s. Ikke når nettleseren er uten nett.
// 3. Før en feil vises, sjekkes det om invitasjonen faktisk ble godtatt: den er ikke lenger ventende
//    i list_my_property_co_landlord_invitations, og du er utleier eller med-utleier på boligen.
//    En lesing som feiler beviser ingenting, og da vises den vanlige feilen.

export const RETRY_DELAY_MS = 1200;
export const TRANSIENT_CODES = new Set(["57014", "40001", "40P01", "55P03"]);
const NETWORK_TEXT = /failed to fetch|fetch failed|networkerror|network request failed|load failed|timed? ?out|econnreset|socket/i;

// error: PostgrestError-like ({ code, message }); status: HTTP status from the response (0 = no answer).
export const isTransientFailure = (error, status) => {
  if (!error) return false;
  if (TRANSIENT_CODES.has(String(error.code ?? ""))) return true;
  const s = Number(status ?? error.status ?? NaN);
  if (s >= 500 && s < 600) return true;
  if (s === 0) return true;
  return NETWORK_TEXT.test(`${error.name ?? ""} ${error.message ?? ""} ${error.details ?? ""}`);
};

// Outcomes that mean the invitation was used before; check whether it was by us.
const VERIFY_OUTCOMES = new Set(["inactive", "already_used", "already_accepted", "not_pending"]);

/**
 * deps:
 *  accept(invitationId) -> { result } | { error, status }
 *  listMine() -> { data, error }                       (list_my_property_co_landlord_invitations)
 *  managesProperty(propertyId) -> { ok: boolean } | { error }
 *  isOffline() -> boolean
 *  sleep(ms) -> Promise
 */
export const createCoInviteAcceptGate = ({
  accept, listMine, managesProperty,
  isOffline = () => false,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  retryDelay = RETRY_DELAY_MS,
}) => {
  const inflight = new Map();

  const verify = async (invitationId, propertyId) => {
    if (!propertyId) return false;
    try {
      const [mine, member] = await Promise.all([listMine(), managesProperty(propertyId)]);
      if (mine?.error || member?.error) return false;
      const stillPending = (mine?.data ?? []).some((i) => String(i.invitation_id) === String(invitationId));
      return !stillPending && member?.ok === true;
    } catch {
      return false;
    }
  };

  const attempt = async (invitationId) => {
    try { return await accept(invitationId); } catch (error) { return { error, status: 0 }; }
  };

  const run = async (invitationId, propertyId) => {
    let res = await attempt(invitationId);
    if (res.error && !isOffline() && isTransientFailure(res.error, res.status)) {
      await sleep(retryDelay);
      res = await attempt(invitationId);
    }
    const outcome = res.result?.outcome;
    if (!res.error && outcome === "accepted") return res;
    if (res.error || VERIFY_OUTCOMES.has(outcome) || !outcome) {
      if (await verify(invitationId, propertyId)) {
        return { result: { outcome: "accepted", property_id: propertyId, verified: true } };
      }
    }
    return res;
  };

  return {
    accept(invitationId, propertyId) {
      const key = String(invitationId);
      if (inflight.has(key)) return inflight.get(key);
      const p = run(invitationId, propertyId).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    isPending: (invitationId) => inflight.has(String(invitationId)),
  };
};
