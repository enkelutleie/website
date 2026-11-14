// CalendarItemPresentation.upcomingSectionItems (iOS): «Kommende» drops rows the
// selected-day card already draws. Other dates stay, in the same order. An empty
// shown list leaves the upcoming list unchanged. An empty result hides the section.
export const upcomingSectionItems = (upcoming, shownOnSelectedDay) => {
  const list = upcoming ?? [];
  const shown = shownOnSelectedDay ?? [];
  if (!shown.length) return list;
  const ids = new Set();
  for (const item of shown) if (item?.id != null) ids.add(item.id);
  if (!ids.size) return list;
  return list.filter((item) => !ids.has(item.id));
};
