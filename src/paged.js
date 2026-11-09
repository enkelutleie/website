// Stop when a page is short, empty, or repeats rows already seen.
// A server that ignores the offset must not keep the caller looping.
export async function collectPages(loadPage, { pageSize = 200, idOf = (row) => row?.id } = {}) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (;;) {
    const { data, error } = await loadPage(offset);
    if (error) return { error };
    const page = Array.isArray(data) ? data : [];
    if (!page.length) return { data: rows };
    let added = 0;
    for (const row of page) {
      const id = idOf(row);
      if (id != null && seen.has(id)) continue;
      if (id != null) seen.add(id);
      rows.push(row);
      added += 1;
    }
    offset += page.length;
    if (added === 0 || page.length < pageSize) return { data: rows };
  }
}
