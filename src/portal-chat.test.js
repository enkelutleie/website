import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatDestinationHash, chatTitle, counterpartFallbackName, groupCounterpartCount, matchChatDestination,
  messagesForTenancy, showsSenderNames,
} from "./portal-chat.js";

const property = "22222222-2222-4222-8222-222222222222";
const tenancyA = "44444444-4444-4444-8444-444444444444";
const tenancyB = "44444444-4444-4444-8444-44444444aaa1";
const convA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const convB = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const me = "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm";
const kari = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ola = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const msg = (over) => ({
  message_id: over.message_id,
  conversation_id: over.conversation_id,
  tenancy_id: over.tenancy_id,
  property_id: over.property_id ?? property,
  sequence_no: over.sequence_no,
  sender_member_id: over.sender_member_id,
  sender_display_name_snapshot: over.name,
  sender_role_snapshot: over.role ?? "tenant",
  body: over.body,
  is_system: !!over.is_system,
});

const conversation = (id, tenancy, extra = {}) => ({
  conversation_id: id,
  tenancy_id: tenancy,
  property_id: property,
  role_snapshot: "owner",
  is_property_chat: false,
  ...extra,
});

test("group sender names include a co-tenant and a co-landlord before they have written", () => {
  assert.equal(showsSenderNames({ counterpartCount: 2, messages: [], currentMemberId: me }), true);
  assert.equal(showsSenderNames({ counterpartCount: 1, messages: [], currentMemberId: me }), false);
  const messages = [
    { sender_member_id: kari, is_system: false, sender_role_snapshot: "tenant" },
    { sender_member_id: ola, is_system: false, sender_role_snapshot: "co_landlord" },
  ];
  assert.equal(showsSenderNames({ counterpartCount: 0, messages, currentMemberId: me }), true);
  assert.equal(groupCounterpartCount({ rosterCount: 2, avatarCount: 1 }), 2);
  assert.equal(groupCounterpartCount({ rosterCount: 1, avatarCount: 5 }), 5);
});

test("a co-tenant does not replace the other tenant in the header", () => {
  const messages = [
    msg({ message_id: "1", sequence_no: 1, sender_member_id: kari, name: "Kari", body: "Hei" }),
    msg({ message_id: "2", sequence_no: 2, sender_member_id: ola, name: "Ola", body: "Hei" }),
    msg({ message_id: "3", sequence_no: 3, sender_member_id: kari, name: "Kari", body: "Igjen" }),
  ];
  assert.equal(counterpartFallbackName({ messages, currentMemberId: me, currentRole: "owner" }), "Kari, Ola");
  assert.equal(chatTitle({
    rosterName: "Kari, Ola",
    messages: [...messages, msg({ message_id: "4", sequence_no: 4, sender_member_id: ola, name: "Ola", body: "Siste" })],
    currentMemberId: me,
    currentRole: "owner",
  }), "Kari, Ola");
  assert.equal(chatTitle({ isPropertyChat: true, rosterName: "Kari" }), "Alle i boligen");
});

test("messages stay on their tenancy: the next lease never sees the previous history", () => {
  const history = [
    msg({ message_id: "a1", conversation_id: convA, tenancy_id: tenancyA, sequence_no: 2, sender_member_id: ola, name: "Ola", body: "Fra Ola" }),
    msg({ message_id: "a0", conversation_id: convA, tenancy_id: tenancyA, sequence_no: 1, sender_member_id: kari, name: "Kari", body: "Fra Kari" }),
    msg({ message_id: "a0", conversation_id: convA, tenancy_id: tenancyA, sequence_no: 1, sender_member_id: kari, name: "Kari", body: "Fra Kari" }),
    msg({ message_id: "own", conversation_id: convA, tenancy_id: tenancyA, sequence_no: 3, sender_member_id: me, name: "Utleier", role: "owner", body: "Fra utleier" }),
    msg({ message_id: "sys", conversation_id: convA, tenancy_id: tenancyA, sequence_no: 4, sender_member_id: "system", name: "System", is_system: true, body: "Person lagt til" }),
    msg({ message_id: "old", conversation_id: convB, tenancy_id: tenancyB, sequence_no: 1, sender_member_id: "per", name: "Per", body: "Gammel hemmelighet" }),
    msg({ message_id: "old-tenancy", tenancy_id: tenancyB, sequence_no: 2, sender_member_id: "per", name: "Per", body: "Gammel hemmelighet uten samtale-id" }),
    msg({ message_id: "same-property", conversation_id: convA, tenancy_id: tenancyA, property_id: "annen-bolig", sequence_no: 5, sender_member_id: kari, name: "Kari", body: "Samme samtale" }),
  ];
  const rpcRow = msg({ message_id: "rpc-row", sequence_no: 6, sender_member_id: ola, name: "Ola", body: "Uten samtale-id, samme side" });
  const current = messagesForTenancy([...history, rpcRow], conversation(convA, tenancyA));
  assert.deepEqual(current.map((m) => m.message_id), ["a0", "a1", "own", "sys", "same-property", "rpc-row"]);
  assert.equal(current.some((m) => String(m.body).includes("Gammel")), false);
  assert.equal(current.filter((m) => m.sender_member_id === kari).length, 2);
  assert.equal(current.some((m) => m.sender_member_id === ola), true);

  const previous = messagesForTenancy(history, conversation(convB, tenancyB));
  assert.deepEqual(previous.map((m) => m.message_id), ["old", "old-tenancy"]);
  const emptyNext = messagesForTenancy(
    history.filter((m) => m.conversation_id === convA || m.tenancy_id === tenancyA),
    conversation("ny-samtale", "ny-tenancy"),
  );
  assert.deepEqual(emptyNext, []);
});

test("a pushed conversation is matched exactly, never another tenancy on the same property", () => {
  const first = conversation(convA, tenancyA);
  const second = conversation(convB, tenancyB);
  const dest = {
    conversationId: convB, propertyId: property, tenancyId: tenancyB,
    userId: "me", recipientUserId: "me", scope: "manager",
  };
  assert.equal(matchChatDestination([first, second], dest)?.conversation_id, convB);
  assert.equal(matchChatDestination([first], dest), null);
  assert.equal(matchChatDestination([second], { ...dest, userId: "noen-andre" }), null);
  assert.equal(matchChatDestination([second], { ...dest, tenancyId: tenancyA }), null);
  assert.equal(matchChatDestination([second], { ...dest, propertyId: "annen-bolig" }), null);
  assert.equal(matchChatDestination([{ ...second, role_snapshot: "tenant" }], dest), null);
  assert.equal(matchChatDestination([{ ...second, role_snapshot: "landlord" }], dest)?.conversation_id, convB);
  assert.equal(matchChatDestination([{ ...second, role_snapshot: "co_landlord" }], dest)?.conversation_id, convB);
  assert.equal(matchChatDestination([second], { ...dest, tenancyId: null }), null);
  assert.equal(chatDestinationHash({ destination_id: convB, tenancy_id: tenancyB }), `#meldinger/${convB}/${tenancyB}`);
  assert.equal(chatDestinationHash({}), "#meldinger");
});
