type MediaPaginationControlsProps = {
  page: number;
  totalPages: number;
  summary: string;
  onPageChange: (page: number) => void;
};

export function MediaPaginationControls({
  page,
  totalPages,
  summary,
  onPageChange,
}: MediaPaginationControlsProps) {
  const pageWindow = buildPageWindow(page, totalPages);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        paddingTop: 4,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{summary}</div>
      {totalPages > 1 ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            style={{ padding: "7px 10px", fontSize: 11 }}
            type="button"
          >
            Onceki
          </button>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {pageWindow.map((entry, index) =>
              entry === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  style={{ minWidth: 20, textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}
                >
                  ...
                </span>
              ) : (
                <button
                  key={entry}
                  className={page === entry ? "btn-primary" : "btn-secondary"}
                  onClick={() => onPageChange(entry)}
                  style={{ minWidth: 38, padding: "7px 10px", fontSize: 11 }}
                  type="button"
                >
                  {entry}
                </button>
              ),
            )}
          </div>
          <button
            className="btn-secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            style={{ padding: "7px 10px", fontSize: 11 }}
            type="button"
          >
            Sonraki
          </button>
        </div>
      ) : null}
    </div>
  );
}

function buildPageWindow(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const windowStart = Math.max(2, page - 1);
  const windowEnd = Math.min(totalPages - 1, page + 1);
  const entries: Array<number | "ellipsis"> = [1];

  if (windowStart > 2) {
    entries.push("ellipsis");
  }

  for (let value = windowStart; value <= windowEnd; value += 1) {
    entries.push(value);
  }

  if (windowEnd < totalPages - 1) {
    entries.push("ellipsis");
  }

  entries.push(totalPages);
  return entries;
}
