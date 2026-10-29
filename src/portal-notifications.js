// Bell rows: text and destination, ported from the iOS app (NotificationEventCopy,
// TenancyTerminatedNotice and NotificationsView.destination(for:)). Pure functions,
// no DOM and no Supabase, so the same rules can be checked outside the browser.
// Server title and summary are shown as they arrive unless iOS replaces them locally.

const T = {
  "inspection.fillRequested": "Utleier har bedt deg fylle ut innflyttingsprotokollen.",
  "inspection.tenantFillDone": "%@ er ferdig med å fylle ut innflyttingsprotokollen",
  "inspection.sent": "Utleier har sendt innflyttingsprotokollen. Godkjenn eller kommenter.",
  "inspection.moveInApproved": "%@ har godkjent innflyttingsprotokollen.",
  "inspection.comment": "Det ligger en ny kommentar på innflyttingsprotokollen.",
  "inspection.reviewDone.move_in": "%@ er ferdig med gjennomgangen av innflyttingen",
  "inspection.reviewDone.move_out": "%@ er ferdig med gjennomgangen av utflyttingen",
  "inspection.finalized": "%@ er ferdigstilt",
  "inspection.finalized.move_in": "Innflyttingen er godkjent",
  "inspection.finalized.move_in.tenant": "Innflyttingsprotokollen er ferdigstilt, du må godkjenne eller kommentere.",
  "inspection.finalized.move_out": "Utflyttingen er godkjent",
  "inspection.started.move_in": "Innflytting er startet",
  "inspection.started.move_out": "Utflytting er startet",
  "inspection.started": "Protokollen er startet",
  "review.landlord": "Utleier",
  "review.tenant": "Leietaker",
  "lease.personSigned": "%@ har signert leiekontrakten",
  "lease.awaitingApproval": "Leiekontrakten er klar. Du kan se over den før den signeres.",
  "lease.awaitingSignature": "Utleier har sendt deg en ny leiekontrakt. Se gjennom og signer kontrakten.",
  "lease.landlordSigned": "Utleier har signert leieavtalen",
  "lease.tenantSigned": "Leietaker har signert leiekontrakten",
  "lease.revision.proposed": "Åpne for å se og signere forslaget.",
  "lease.revision.proposed.title": "Utleier har foreslått en endring i kontrakten",
  "lease.revision.requested": "Du har mottatt et forslag til endring av leieavtalen",
  "lease.revision.acceptedSigned": "Leietakeren har godkjent og signert det nye kontraktsforslaget.",
  "lease.revision.acceptedSigned.title": "Leietaker har godkjent og signert",
  "lease.revision.accepted": "Forslaget til endring av leieavtalen er godtatt",
  "lease.revision.rejected": "Forslaget til endring av leieavtalen er avslått",
  "lease.cancellation.requested": "Du har mottatt en forespørsel om sletting av leiekontrakten",
  "lease.cancellation.accepted": "Sletting av leiekontrakten er godtatt. Kontrakten er slettet for begge parter.",
  "lease.cancellation.rejected": "Sletting av leiekontrakten er avslått. Kontrakten beholdes.",
  "lease.bothSigned": "%@ har godkjent og signert leiekontrakten.",
  "lease.bothSigned.fallbackName": "Leietakeren",
  "lease.bothSigned.title": "Begge har signert kontrakten",
  "lease.received.title": "Ny leiekontrakt mottatt",
  "lease.completed": "Kontrakten er signert og tilgjengelig.",
  "calendar.response.accepted": "Leietaker har godtatt kalenderhendelsen",
  "calendar.reminder": "Påminnelse om kalenderhendelse",
  "calendar.created": "Utleier har lagt til en kalenderhendelse. Svar på forespørselen.",
  "calendar.relevant": "En relevant kalenderhendelse nærmer seg",
  "calendar.responseReminder": "Påminnelse: Utleier venter på svaret ditt på en kalenderhendelse.",
  "chat.attachment": "Nytt vedlegg",
  "chat.document": "Du har mottatt «%@» i chatten.",
  "invitation.accepted": "Leieinvitasjonen er godtatt",
  "invitation.declined": "Leieinvitasjonen er avslått",
  "invitation.received": "Invitasjon fra %@",
  "invitation.revoked": "Leieinvitasjonen er trukket tilbake",
  "maintenance.closed": "Vedlikeholdssaken er lukket",
  "maintenance.created": "Ny vedlikeholdssak",
  "maintenance.reopened": "Vedlikeholdssaken er åpnet igjen",
  "maintenance.resolved": "Vedlikeholdssaken er løst",
  "maintenance.scheduleChanged": "Utleier har foreslått en dato. Venter på godkjenning.",
  "maintenance.scheduleChanged.title": "Ny dato for vedlikehold",
  "maintenance.status": "Status endret til %@",
  "maintenance.comment": "Ny kommentar: %@",
  "maintenance.followUp": "Vedlikeholdssaken trenger oppfølging. Den planlagte datoen har passert.",
  "tenancy.cancelled": "Leieforholdet er kansellert",
  "tenancy.terminated": "Leieforholdet er avsluttet",
  "rentPayment.reported": "Leietaker har meldt husleien betalt",
  "rentPayment.reportedForMonth": "Leietaker har meldt husleien for %@ betalt",
  "deposit.claims": "Utleier har sendt depositumsoppgjøret. Åpne appen for å godta eller bestride.",
  "deposit.accepted": "Leietaker har godtatt kravene mot depositumet.",
  "deposit.declined": "Leietaker har avslått kravene mot depositumet.",
  "deposit.fullRefund": "Utleier godkjente utflyttingen uten krav mot depositumet.",
  "deposit.disputed": "Leietaker har bestridt oppgjøret. Utleier kan ikke trekke depositumet automatisk.",
  "moveOut.notice": "Oppsigelse registrert.",
  "moveOut.notice.dated": "Oppsigelse registrert. Utflytting %@.",
  "moveOut.reminder.tomorrow": "Utflytting er i morgen.",
  "moveOut.reminder.week": "Utflytting er om 7 dager.",
  "moveOut.ended": "Utflyttingen er fullført.",
  unknown: "Nytt varsel",
};
const MAINTENANCE_STATUS = { reported: "meldt inn", in_progress: "pågår", waiting: "venter", resolved: "løst", closed: "lukket" };
const INSPECTION_TYPE = { move_in: "Innflyttingsprotokollen", move_out: "Utflyttingsprotokollen" };
const PHOTO_ONLY = "📷 Bilde";
const BOTH_SIGNED_SERVER_TITLES = new Set(["Begge har signert kontrakten", "Both parties have signed the contract"]);

const fill = (key, value) => T[key].replace("%@", value);
const json = (text) => { try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const personName = (raw, fallback) => {
  const name = String(raw ?? "").trim();
  return name && !name.includes("@") ? name : fallback;
};
const isoDay = (value) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
const isBothSigned = (n) => n.notification_type === "lease_contract_tenant_signed" && BOTH_SIGNED_SERVER_TITLES.has((n.title ?? "").trim());

export function notificationTitle(n) {
  const type = n.notification_type;
  if (type === "maintenance_schedule_changed") return T["maintenance.scheduleChanged.title"];
  if (type === "lease_contract_change_accepted" && n.summary === "revision") return T["lease.revision.acceptedSigned.title"];
  if (type === "lease_contract_change_requested" && n.summary === "revision") return T["lease.revision.proposed.title"];
  if (type === "lease_contract_awaiting_signature") return T["lease.received.title"];
  if (isBothSigned(n)) return T["lease.bothSigned.title"];
  return n.title || T.unknown;
}

// reasons: [[code, label]] for tenancy_terminated rows (YYYY-MM-DD|reason_code).
export function notificationText(n, scope, reasons = []) {
  const s = n.summary ?? "";
  const trimmed = s.trim();
  switch (n.notification_type) {
    case "tenancy_invitation_received": case "co_landlord_invitation_received": return fill("invitation.received", s);
    case "tenancy_invitation_accepted": return T["invitation.accepted"];
    case "tenancy_invitation_declined": case "co_landlord_invitation_declined": return T["invitation.declined"];
    case "tenancy_invitation_revoked": return T["invitation.revoked"];
    case "tenancy_terminated": {
      const [day, code] = s.split("|");
      const d = code !== undefined && isoDay(day);
      if (d && +d[2] >= 1 && +d[2] <= 12 && +d[3] >= 1 && +d[3] <= 31) {
        const reason = reasons.find(([k]) => k === code)?.[1] ?? code;
        return `Leieforholdet er avsluttet. Utflytting: ${d[3]}.${d[2]}.${d[1]}. ${reason}`;
      }
      return T["tenancy.terminated"];
    }
    case "tenancy_cancelled": return T["tenancy.cancelled"];
    case "maintenance_created": return T["maintenance.created"];
    case "maintenance_schedule_changed": return T["maintenance.scheduleChanged"];
    case "maintenance_status_changed":
      if (s === "follow_up") return T["maintenance.followUp"];
      return fill("maintenance.status", MAINTENANCE_STATUS[s] ?? "en ny verdi");
    case "maintenance_reopened": return T["maintenance.reopened"];
    case "maintenance_resolved": return T["maintenance.resolved"];
    case "maintenance_closed": return T["maintenance.closed"];
    case "rent_payment_reported": {
      const d = isoDay(s);
      if (!d) return T["rentPayment.reported"];
      const month = new Date(Date.UTC(+d[1], +d[2] - 1, 1)).toLocaleDateString("nb-NO", { month: "long", year: "numeric", timeZone: "UTC" });
      return fill("rentPayment.reportedForMonth", month);
    }
    case "maintenance_comment": return fill("maintenance.comment", s === PHOTO_ONLY ? PHOTO_ONLY : s);
    case "inspection_ready": return T[s === "move_in" || s === "move_out" ? `inspection.started.${s}` : "inspection.started"];
    case "inspection_review_done": {
      const p = json(s);
      const name = personName(p.actor_name, T[p.actor_role === "tenant" ? "review.tenant" : "review.landlord"]);
      return fill(p.inspection_type === "move_out" ? "inspection.reviewDone.move_out" : "inspection.reviewDone.move_in", name);
    }
    case "deposit_settlement_claims": return T["deposit.claims"];
    case "deposit_settlement_accepted": return T["deposit.accepted"];
    case "deposit_settlement_declined": return T["deposit.declined"];
    case "deposit_settlement_full_refund": return T["deposit.fullRefund"];
    case "deposit_settlement_disputed": return T["deposit.disputed"];
    case "inspection_fill_requested": return T["inspection.fillRequested"];
    case "inspection_tenant_fill_done": return fill("inspection.tenantFillDone", personName(json(s).actor_name, T["review.tenant"]));
    case "inspection_sent_for_review": return T["inspection.sent"];
    case "inspection_move_in_approved": return fill("inspection.moveInApproved", personName(json(s).actor_name, T["review.tenant"]));
    case "inspection_protocol_comment": return T["inspection.comment"];
    case "inspection_finalized":
      if (scope === "tenant" && s === "move_in") return T["inspection.finalized.move_in.tenant"];
      if (s === "move_in" || s === "move_out") return T[`inspection.finalized.${s}`];
      return fill("inspection.finalized", INSPECTION_TYPE[s] ?? "Protokollen");
    case "calendar_relevant": return T[String(n.notification_id).startsWith("calendar:reminder:") ? "calendar.reminder" : "calendar.relevant"];
    case "calendar_created": return T["calendar.created"];
    case "calendar_response_accepted": return T["calendar.response.accepted"];
    case "calendar_response_reminder": return T["calendar.responseReminder"];
    case "lease_contract_awaiting_approval": return T["lease.awaitingApproval"];
    case "lease_contract_awaiting_signature": return T["lease.awaitingSignature"];
    case "lease_contract_completed": return T["lease.completed"];
    case "lease_contract_tenant_signed":
    case "lease_contract_landlord_signed": {
      if (isBothSigned(n)) return fill("lease.bothSigned", personName(trimmed, T["lease.bothSigned.fallbackName"]));
      const name = personName(trimmed, null);
      if (name) return fill("lease.personSigned", name);
      return T[n.notification_type === "lease_contract_tenant_signed" ? "lease.tenantSigned" : "lease.landlordSigned"];
    }
    case "lease_contract_change_requested":
      if (s === "revision") return T["lease.revision.proposed"];
      return T[s === "cancellation" ? "lease.cancellation.requested" : "lease.revision.requested"];
    case "lease_contract_change_accepted":
      if (s === "revision") return T["lease.revision.acceptedSigned"];
      return T[s === "cancellation" ? "lease.cancellation.accepted" : "lease.revision.accepted"];
    case "lease_contract_change_rejected": return T[s === "cancellation" ? "lease.cancellation.rejected" : "lease.revision.rejected"];
    case "chat_message": return s;
    case "chat_attachment": return T["chat.attachment"];
    case "chat_document": return fill("chat.document", s);
    case "move_out_notice_registered": {
      const d = isoDay(s);
      return d ? fill("moveOut.notice.dated", `${d[3]}.${d[2]}`) : T["moveOut.notice"];
    }
    case "move_out_reminder": return T[trimmed === "1" ? "moveOut.reminder.tomorrow" : "moveOut.reminder.week"];
    case "move_out_ended": return T["moveOut.ended"];
    default: return trimmed || T.unknown;
  }
}

const OPENS_HOME = new Set(["tenancy_terminated", "tenancy_cancelled", "tenancy_invitation_revoked", "tenancy_invitation_declined", "co_landlord_invitation_declined"]);
const MOVE_OUT_TYPES = new Set(["move_out_notice_registered", "move_out_reminder", "move_out_ended"]);
const DEPOSIT_TYPES = new Set(["deposit_settlement_claims", "deposit_settlement_accepted", "deposit_settlement_declined", "deposit_settlement_full_refund", "deposit_settlement_disputed"]);
const inspectionRoute = (n) => (n.summary === "move_out" ? "#inn-utflytting/utflytting" : n.summary === "move_in" ? "#inn-utflytting/innflytting" : "#inn-utflytting");

// NotificationsView.destination(for:), mapped to the portal's pages. null = no own page.
export function notificationRoute(n, scope) {
  const type = n.notification_type;
  const dest = n.destination_type;
  const did = n.destination_id;
  if (OPENS_HOME.has(type)) return "#oversikt";
  if (type === "tenancy_invitation_received" || type === "co_landlord_invitation_received") return "#oversikt";
  if (type === "rent_payment_reported" || type === "tenancy_invitation_accepted") return "#oversikt";
  if (type === "inspection_finalized" && n.summary === "move_out") return "#inn-utflytting/depositum";
  if (scope === "manager" && type === "deposit_settlement_accepted" && n.tenancy_id) return "#inn-utflytting";
  // Tenant schedule rows name the calendar item in source_id; destination stays the case,
  // which is opened instead when the item is gone (#kalender/<item>/<case>).
  if (type === "maintenance_schedule_changed" && scope === "tenant" && n.tenancy_id && dest === "maintenance_request" && did) {
    return n.source_id ? `#kalender/${n.source_id}/${did}` : `#vedlikehold/${did}`;
  }
  if (DEPOSIT_TYPES.has(type)) return "#inn-utflytting/depositum";
  if (dest === "move_out_process" || MOVE_OUT_TYPES.has(type)) return n.tenancy_id ? "#inn-utflytting/utflytting" : "#oversikt";
  if (dest && did) {
    const tenantOk = scope === "manager" || !!n.tenancy_id;
    if (dest === "maintenance_request" && tenantOk) return `#vedlikehold/${did}`;
    if (dest === "calendar_item" && tenantOk) return `#kalender/${did}`;
    if (dest === "inspection") return inspectionRoute(n);
    if (dest === "property") return "#oversikt";
    if (dest === "lease_contract") return "#leiekontrakt";
    if (dest === "chat_conversation") return "#meldinger";
    if (dest === "deposit_settlement") return "#inn-utflytting/depositum";
  }
  switch (n.source_type) {
    case "inspection": return inspectionRoute(n);
    case "lease_contract": return "#leiekontrakt";
    case "tenancy_invitation": case "tenancy_lifecycle": case "maintenance": case "calendar": case "rent_payment": return "#oversikt";
    case "chat": return "#meldinger";
    default: return null;
  }
}
