// Per-property inventory load (iOS AssetListLoad, #1677).
// Cancellation — AbortError, or a load superseded by navigation, re-render or
// refresh — is not a failure. Each property is read on its own and retried
// twice (0.4 s, then 1.2 s) before it counts as failed. A failed or cancelled
// property keeps the rows already shown. «Kunne ikke laste eiendeler.» is
// returned only when every property failed and nothing is left to show.
// showsFailure: false is the «Ny eiendel» context load: the list is only
// context, so a failed read never becomes that message.
import { itemInput, scopeFor } from "./portal-inventory.js";

export const ASSET_LOAD_ERROR = "Kunne ikke laste eiendeler.";
export const LIST_RETRY_DELAYS_MS = [400, 1200];

const SUPERSEDED = new Set(["navigation", "render", "refresh"]);

const abortText = (error) => `${error?.message ?? ""} ${error?.details ?? ""}`;

export function isCancellation(error) {
  if (error == null || error === false) return false;
  if (typeof error === "string") return error === "abort" || SUPERSEDED.has(error);
  if (typeof error !== "object") return false;
  if (error.cancelled === true) return true;
  if (typeof error.reason === "string" && SUPERSEDED.has(error.reason)) return true;
  if (typeof error.superseded === "string" && SUPERSEDED.has(error.superseded)) return true;
  const name = String(error.name ?? "");
  if (name === "AbortError") return true;
  // DOMException.ABORT_ERR is 20. Require the abort name so an unrelated code cannot match.
  if ((error.code === 20 || error.code === "20") && (name === "AbortError" || name === "DOMException")) return true;
  if (/AbortError|The user aborted|The operation was aborted|signal is aborted|aborted a request|Request was aborted/i.test(abortText(error))) return true;
  if (error.cause != null && error.cause !== error && isCancellation(error.cause)) return true;
  return false;
}

export function accountingModeValue(res) {
  const data = res?.data;
  if (Array.isArray(data)) return data[0]?.accounting_mode ?? data[0] ?? null;
  if (data == null) return null;
  return data.accounting_mode ?? data;
}

export function electionsFromRows(rows) {
  const elections = {};
  for (const row of rows ?? []) (elections[row.scope_key] ??= {})[row.tax_year] = row;
  return elections;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One property's list_property_assets. Cancellation is returned immediately and
// is not retried. Any other failure is tried again after each delay.
export async function readPropertyAssets(read, {
  retryDelays = LIST_RETRY_DELAYS_MS,
  sleep = delay,
  isCancelled = () => false,
} = {}) {
  let attempt = 0;
  for (;;) {
    if (isCancelled()) return { cancelled: true };
    let result;
    try {
      result = await read();
    } catch (error) {
      if (isCancellation(error) || isCancelled()) return { cancelled: true };
      result = { error };
    }
    if (result?.cancelled || isCancellation(result?.error) || isCancelled()) return { cancelled: true };
    if (!result?.error) return { data: Array.isArray(result?.data) ? result.data : [] };
    if (attempt >= retryDelays.length) return { failed: true, error: result.error };
    await sleep(retryDelays[attempt]);
    attempt += 1;
  }
}

function present(bundles, elections, extra) {
  const items = bundles.flatMap((bundle) => bundle.rawRows.map((row) => itemInput(row, bundle.label, bundle.scope)));
  items.sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || a.name.localeCompare(b.name, "nb"));
  return {
    items,
    elections,
    scopes: Object.fromEntries(bundles.map((bundle) => [bundle.id, bundle.scope])),
    assets: Object.fromEntries(bundles.flatMap((bundle) => bundle.rawRows.map((row) => [row.id, row]))),
    bundles,
    failedPropertyIds: extra.failedPropertyIds ?? [],
    cancelled: Boolean(extra.cancelled),
    settled: extra.settled !== false,
    error: Boolean(extra.error),
  };
}

const kept = (shown) => present(shown?.bundles ?? [], shown?.elections ?? {}, {
  cancelled: true, settled: false, error: false, failedPropertyIds: [],
});

// What a superseded or aborted load should leave on screen. Not a page error.
export const unsettledInventory = kept;

async function readMode(property, accountingMode, isCancelled) {
  if (isCancelled()) return { cancelled: true };
  try {
    const res = await accountingMode(property.id);
    if (isCancellation(res?.error) || isCancelled()) return { cancelled: true };
    if (res?.error) return { failed: true };
    return { value: accountingModeValue(res) };
  } catch (error) {
    if (isCancellation(error) || isCancelled()) return { cancelled: true };
    return { failed: true };
  }
}

async function readElections(listElections, isCancelled) {
  if (isCancelled()) return { cancelled: true };
  try {
    const res = await listElections();
    if (isCancellation(res?.error) || isCancelled()) return { cancelled: true };
    if (res?.error) return { failed: true };
    return { elections: electionsFromRows(res?.data) };
  } catch (error) {
    if (isCancellation(error) || isCancelled()) return { cancelled: true };
    return { failed: true };
  }
}

/**
 * properties: portal property records. previous: { bundles, elections } already shown.
 * listAssets / accountingMode / listElections return { data } or { error }, or throw.
 * isCancelled() is true once this load was superseded (navigation, re-render, refresh).
 * A settled view can be cached. A superseded or fully cancelled load (settled: false)
 * must not be cached and must not replace what is already shown.
 */
export async function loadManagedInventory({
  properties,
  labelOf,
  previous = { bundles: [], elections: {} },
  listAssets,
  accountingMode,
  listElections,
  showsFailure = true,
  isCancelled = () => false,
  sleep,
  retryDelays,
}) {
  const previousBundles = new Map((previous.bundles ?? []).map((bundle) => [bundle.id, bundle]));
  const listed = Promise.all(properties.map(async (property) => {
    const [assets, mode] = await Promise.all([
      readPropertyAssets(() => listAssets(property.id), { sleep, retryDelays, isCancelled }),
      readMode(property, accountingMode, isCancelled),
    ]);
    return { property, assets, mode };
  }));
  const electionsRead = readElections(listElections, isCancelled);
  const [perProperty, electionsResult] = await Promise.all([listed, electionsRead]);

  // A newer load, a navigation or a refresh owns the screen. Leave the rows alone.
  if (isCancelled()) return kept(previous);

  const failedPropertyIds = [];
  let anyCancelled = false;
  const bundles = [];
  for (const { property, assets, mode } of perProperty) {
    const prior = previousBundles.get(property.id);
    if (Array.isArray(assets.data)) {
      const scope = mode.cancelled
        ? (prior?.scope ?? scopeFor(null, property))
        : scopeFor(mode.failed ? null : mode.value, property);
      bundles.push({ id: property.id, label: labelOf(property), scope, rawRows: assets.data });
    } else if (assets.failed) {
      failedPropertyIds.push(property.id);
      if (prior) bundles.push({ ...prior, label: labelOf(property) });
    } else {
      anyCancelled = true;
      if (prior) bundles.push({ ...prior, label: labelOf(property) });
    }
  }

  // Nothing new arrived. Keep the screen and let the next visit try again.
  const loadedAny = perProperty.some((row) => Array.isArray(row.assets.data));
  if (anyCancelled && !loadedAny) return kept(previous);

  const elections = electionsResult.elections ?? previous.elections ?? {};
  const rowCount = bundles.reduce((sum, bundle) => sum + bundle.rawRows.length, 0);
  const message = showsFailure
    && properties.length > 0
    && failedPropertyIds.length === properties.length
    && rowCount === 0
    ? ASSET_LOAD_ERROR
    : null;
  return present(message ? [] : bundles, message ? {} : elections, {
    failedPropertyIds,
    cancelled: anyCancelled,
    settled: true,
    error: Boolean(message),
  });
}
