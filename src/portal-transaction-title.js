// EconomyTransactionPresentation.listTitle (iOS #1590): the description is the title for both
// income and expense. Older rows without one fall back to «Leieinntekt <måned år>» for rent,
// then the category name, then «Inntekt»/«Utgift». Never an empty title.
const MONTH = new Intl.DateTimeFormat("nb-NO", { month: "long", year: "numeric", timeZone: "UTC" });

export const rentIncomeTitle = (periodDate) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(periodDate ?? ""));
  if (!m) return null;
  return `Leieinntekt ${MONTH.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))}`;
};

// categoryName: the shown category («Vedlikehold»), or null when the row has no category.
export const transactionListTitle = (row, categoryName) => {
  const description = String(row?.description ?? "");
  if (description.trim()) return description;
  const income = row?.transaction_type === "income";
  if (income && row?.category === "rent") {
    const rent = rentIncomeTitle(row.series_occurrence_date || row.transaction_date);
    if (rent) return rent;
  }
  if (categoryName) return categoryName;
  return income ? "Inntekt" : "Utgift";
};

