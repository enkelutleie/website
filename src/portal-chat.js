// Tenancy group chat (iOS #1689). One conversation per tenancy. The RPCs,
// tables and realtime filters are unchanged by migration
// 20261114211547_tenancy_group_chat_full_history, so this works before that
// migration is applied. Full history for a new co-tenant is enforced by the
// server (visible_from_sequence_no = 1); the client shows every row the
// conversation RPC returns and never a row from another tenancy.

const GENERIC_SENDER = "En bruker";

const sameId = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

const messageKey = (m) => m?.message_id || m?.id || null;

// Landlord/co-landlord counterparts are tenants. A tenant's counterparts are everyone else.
export function isCounterpartRole(senderRole, currentRole) {
  return currentRole === "tenant" ? senderRole !== "tenant" : senderRole === "tenant";
}

// Group when there are at least two counterparts, or the loaded messages
// already show more than two distinct senders including yourself.
// Two tenants plus the landlord is a group before the co-tenant has written.
export function showsSenderNames({ counterpartCount = 0, messages = [], currentMemberId } = {}) {
  const senders = new Set();
  for (const m of messages) {
    if (!m?.is_system && m?.sender_member_id) senders.add(m.sender_member_id);
  }
  if (currentMemberId) senders.add(currentMemberId);
  return Number(counterpartCount) > 1 || senders.size > 2;
}

// Roster size and avatar rows both count. The list may draw fewer avatars
// than there are participants; that cap must not hide a group.
export function groupCounterpartCount({ rosterCount = 0, avatarCount = 0 } = {}) {
  const roster = Number(rosterCount);
  const avatars = Number(avatarCount);
  return Math.max(0, Number.isFinite(roster) ? roster : 0, Number.isFinite(avatars) ? avatars : 0);
}

export function joinRosterNames(people) {
  const names = (people ?? []).map((p) => p.display_name?.trim() || p.email?.trim()).filter(Boolean);
  return names.length ? names.join(", ") : null;
}

// Every known opposite-side snapshot, in first-seen order. A later sender
// is added; they do not replace the people already in the title.
export function counterpartFallbackName({ messages = [], currentMemberId, currentRole, fallback = "Leietaker" } = {}) {
  const names = new Map();
  const order = [];
  for (const message of messages) {
    if (!message || message.sender_member_id === currentMemberId || message.is_system) continue;
    if (!isCounterpartRole(message.sender_role_snapshot, currentRole)) continue;
    const trimmed = String(message.sender_display_name_snapshot ?? "").trim();
    if (!trimmed || trimmed === GENERIC_SENDER) continue;
    if (!names.has(message.sender_member_id)) order.push(message.sender_member_id);
    names.set(message.sender_member_id, trimmed);
  }
  return order.length ? order.map((id) => names.get(id)).join(", ") : fallback;
}

// The authorized roster wins. Snapshots are only the stand-in while it loads.
export function chatTitle({ isPropertyChat, rosterName, messages, currentMemberId, currentRole, fallback = "Leietaker" } = {}) {
  if (isPropertyChat) return "Alle i boligen";
  const roster = typeof rosterName === "string" ? rosterName.trim() : "";
  if (roster) return roster;
  return counterpartFallbackName({ messages, currentMemberId, currentRole, fallback });
}

// Rows the open tenancy may show. A later tenancy on the same property never
// receives the previous conversation. Rows are not filtered by sender, tenant
// user id or property id: those fields stay when the conversation matches.
export function messagesForTenancy(rows, conversation) {
  if (!conversation?.conversation_id) return [];
  const seen = new Set();
  const kept = [];
  for (const m of rows ?? []) {
    if (!m || typeof m !== "object") continue;
    if (m.conversation_id && !sameId(m.conversation_id, conversation.conversation_id)) continue;
    if (!conversation.is_property_chat && m.tenancy_id && conversation.tenancy_id && !sameId(m.tenancy_id, conversation.tenancy_id)) continue;
    const key = messageKey(m);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(m);
  }
  kept.sort((a, b) => Number(a.sequence_no) - Number(b.sequence_no) || String(messageKey(a) ?? "").localeCompare(String(messageKey(b) ?? "")));
  return kept;
}

const managerRole = (role) => !!role && role !== "tenant";

// Exact conversation from a fresh authorized list. No other conversation on
// the same property, and not the first tenant, is a substitute.
export function matchChatDestination(conversations, dest) {
  if (!dest?.conversationId) return null;
  if (dest.recipientUserId && dest.userId && !sameId(dest.recipientUserId, dest.userId)) return null;
  const hits = (conversations ?? []).filter((c) => {
    if (!sameId(c.conversation_id, dest.conversationId)) return false;
    if (dest.propertyId && !sameId(c.property_id, dest.propertyId)) return false;
    const rowTenancy = c.tenancy_id || (c.is_property_chat ? c.conversation_id : null);
    if (dest.tenancyId) {
      if (!sameId(rowTenancy, dest.tenancyId)) return false;
    } else if (!c.is_property_chat) return false;
    if (dest.scope === "tenant") return c.role_snapshot === "tenant";
    return managerRole(c.role_snapshot);
  });
  return hits.length === 1 ? hits[0] : null;
}

// Bell/push: the conversation and its tenancy. The inbox (#meldinger) is only
// used when the row names no conversation.
export function chatDestinationHash(n) {
  const id = n?.destination_id || null;
  if (!id) return "#meldinger";
  return n.tenancy_id ? `#meldinger/${id}/${n.tenancy_id}` : `#meldinger/${id}`;
}
