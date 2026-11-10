// Fully signed contract stuck in partially_signed (iOS #1583).
// The last signer's contract-pdf stored the ink, then finalize_signed_lease_pdf timed
// out. Nothing else finishes that step, so the open contract view asks contract-pdf
// (intent "refresh_signature_pdf") to build the PDF with the saved signatures and mark
// it signed. It stores no new signature. At most once per 30 s per version, silent on
// failure, and the caller reloads the agreement after a successful call.

export const STUCK_FINALIZE_RETRY_MS = 30_000;

const asRows = (data) => (Array.isArray(data) ? data : data ? [data] : []);

// Every party that must sign has a signature, or the lease row counts enough of them.
export function allRequiredSigned(lease) {
  const row = lease?.data ?? {};
  const required = asRows(lease?.parties).filter((p) => p && p.required_to_sign !== false);
  if (required.length && required.every((p) => p.has_signature === true)) return true;
  const recorded = Number(row.recorded_signature_count);
  const needed = Number(row.required_signature_count);
  return Number.isFinite(needed) && needed > 0 && Number.isFinite(recorded) && recorded >= needed;
}

export const stuckVersionId = (agreement, lease) =>
  agreement?.current_version_id ?? lease?.data?.version_id ?? lease?.data?.current_version_id ?? null;

export function isStuckFullySigned(agreement, lease) {
  const status = agreement?.agreement_status ?? lease?.data?.agreement_status;
  return status === "partially_signed" && !!agreement?.agreement_id && !!stuckVersionId(agreement, lease)
    && allRequiredSigned(lease);
}

export function createStuckFinalizer({ invoke, now = () => Date.now(), retryMs = STUCK_FINALIZE_RETRY_MS }) {
  const lastAttempt = new Map(); // version_id -> ms
  const inFlight = new Map();
  return {
    // Resolves { attempted, ok }. Never throws and never returns a message for the user.
    async finalize(agreement, lease) {
      if (!isStuckFullySigned(agreement, lease)) return { attempted: false, ok: false };
      const versionId = String(stuckVersionId(agreement, lease));
      if (inFlight.has(versionId)) return inFlight.get(versionId);
      const at = now();
      const last = lastAttempt.get(versionId);
      if (last != null && at - last < retryMs) return { attempted: false, ok: false };
      lastAttempt.set(versionId, at);
      const job = (async () => {
        try {
          const { data, error } = await invoke("contract-pdf", {
            body: { agreement_id: agreement.agreement_id, version_id: versionId, intent: "refresh_signature_pdf" },
          });
          if (error) return { attempted: true, ok: false };
          let body = data;
          if (typeof data === "string") { try { body = JSON.parse(data); } catch { body = null; } }
          // sign-handler.mjs answers { outcome: "signed", document_id } once the PDF is finalized.
          return { attempted: true, ok: body?.outcome === "signed" };
        } catch {
          return { attempted: true, ok: false };
        }
      })().finally(() => inFlight.delete(versionId));
      inFlight.set(versionId, job);
      return job;
    },
  };
}
