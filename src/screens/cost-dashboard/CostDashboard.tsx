import { type ReactNode, useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AudioLines,
  BarChart3,
  Download,
  DollarSign,
  Film,
  Image as ImageIcon,
  RefreshCcw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  exportCostOverviewCsv,
  getCostOverview,
  type CostLogRow,
  type CostOverview,
  type CostRange,
} from "@/services/cost-dashboard.service";
import { useProjectStore } from "@/store/project.store";
import { SegmentGroup, ProEmptyState } from "@/components/ui";

const RANGE_OPTIONS: Array<{ value: CostRange; label: string }> = [
  { value: "7d", label: "Son 7 gun" },
  { value: "30d", label: "Son 30 gun" },
  { value: "90d", label: "Son 90 gun" },
  { value: "all", label: "Tum zamanlar" },
];

const SEGMENT_OPTIONS = RANGE_OPTIONS.map((o) => ({ key: o.value, label: o.label }));

export function CostDashboard() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const [range, setRange] = useState<CostRange>("30d");
  const [overview, setOverview] = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!activeProject) {
      setOverview(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadOverview() {
      setLoading(true);
      setError(null);

      try {
        const nextOverview = await getCostOverview({ range });
        if (!cancelled) {
          setOverview(nextOverview);
        }
      } catch (loadError) {
        console.error("Failed to load cost overview", loadError);
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Maliyet verileri yuklenemedi.");
          setOverview(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [activeProject, range, refreshToken]);

  const totals = useMemo(
    () =>
      overview
        ? [
            {
              label: "Toplam harcama",
              value: formatUsd(overview.totalUsd),
              detail: `${overview.spendDays || 0} aktif gun`,
              icon: <DollarSign size={16} />,
            },
            {
              label: "Gorsel",
              value: formatUsd(overview.imageUsd),
              detail: `${overview.byType.find((row) => row.type === "image")?.count ?? 0} is`,
              icon: <ImageIcon size={16} />,
            },
            {
              label: "Video",
              value: formatUsd(overview.videoUsd),
              detail: `${overview.byType.find((row) => row.type === "video")?.count ?? 0} is`,
              icon: <Film size={16} />,
            },
            {
              label: "Upscale",
              value: formatUsd(overview.upscaleUsd),
              detail: `${overview.byType.find((row) => row.type === "upscale")?.count ?? 0} is`,
              icon: <TrendingUp size={16} />,
            },
            {
              label: "TTS",
              value: formatUsd(overview.ttsUsd),
              detail: `${overview.byType.find((row) => row.type === "tts")?.count ?? 0} is`,
              icon: <AudioLines size={16} />,
            },
            {
              label: "Dosyaya inen harcama",
              value: formatUsd(overview.assetBackedUsd),
              detail: "Dosyaya inmis uretimler",
              icon: <BarChart3 size={16} />,
            },
            {
              label: "Gunluk ortalama",
              value: formatUsd(overview.avgDailyUsd),
              detail: range === "all" ? "Tum zamanlar" : RANGE_OPTIONS.find((item) => item.value === range)?.label ?? "",
              icon: <Sparkles size={16} />,
            },
          ]
        : [],
    [overview, range],
  );

  async function handleExportCsv() {
    if (!overview) {
      return;
    }

    setExporting(true);

    try {
      const destination = await save({
        title: "Harcama paneli CSV indirme",
        defaultPath: `cineai-costs-${range}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!destination) {
        return;
      }

      await writeTextFile(destination, exportCostOverviewCsv(overview));
    } catch (exportError) {
      console.error("Failed to export cost overview", exportError);
      setError(exportError instanceof Error ? exportError.message : "CSV export tamamlanamadi.");
    } finally {
      setExporting(false);
    }
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <ProEmptyState
          icon={DollarSign}
          title="Harcama Analizi"
          description="Harcamalari gormek icin once bir proje ac."
        />
      </section>
    );
  }

  return (
    <section className="screen-shell">
      <section style={{ display: "grid", gap: 18 }}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <DollarSign size={13} />
              Harcama Analizi
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Harcama Analizi
            </div>
            <p style={copyStyle}>
              Cost log ve asset kayitlarindan uretilen harcama panosu. Model bazli dagilim,
              shot maliyetleri ve zaman icindeki harcama egilimini bu panelde izleyebilirsin.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={() => setRefreshToken((value) => value + 1)} type="button">
              <RefreshCcw size={14} />
              Yenile
            </button>
            <button
              className="btn-primary"
              disabled={!overview || exporting}
              onClick={() => void handleExportCsv()}
              type="button"
            >
              <Download size={14} />
              {exporting ? "Indiriliyor..." : "CSV Indir"}
            </button>
          </div>
        </header>

        <section style={toolbarStyle}>
          <SegmentGroup
            options={SEGMENT_OPTIONS}
            value={range}
            onChange={(key) => setRange(key as CostRange)}
          />
          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
            {overview ? `${overview.recentLogs.length} son hareket gosteriliyor` : "Filtre sec"}
          </div>
        </section>

        {loading ? (
          <ProEmptyState icon={DollarSign} title="Yukleniyor..." description="Maliyet verileri okunuyor." />
        ) : error ? (
          <ProEmptyState icon={DollarSign} title="Yuklenemedi" description={error} />
        ) : !overview || overview.totalUsd <= 0 ? (
          <ProEmptyState
            icon={DollarSign}
            title="Harcama verisi yok"
            description="Bu projede cost log kaydi bulunmuyor. Uretim, video veya upscale akisi calistiginda panel dolacak."
          />
        ) : (
          <>
            <section style={metricsGridStyle}>
              {totals.map((item) => (
                <MetricCard
                  detail={item.detail}
                  icon={item.icon}
                  key={item.label}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </section>

            <section style={twoColumnGridStyle}>
              <article style={panelStyle}>
                <SectionHeader
                  copy="Gunluk toplam harcama egilimi"
                  title="Harcama egilimi"
                />
                <TrendChart data={overview.daily} />
              </article>

              <article style={panelStyle}>
                <SectionHeader
                  copy="En pahali modeller ve is tipleri"
                  title="Model dagilimi"
                />
                <div style={{ display: "grid", gap: 18 }}>
                  <BarList
                    emptyLabel="Model kaydi yok."
                    rows={overview.byModel.map((row) => ({
                      label: row.model,
                      value: row.totalUsd,
                      detail: `${row.count} log`,
                    }))}
                  />
                  <BarList
                    emptyLabel="Tip kaydi yok."
                    rows={overview.byType.map((row) => ({
                      label: row.type.toUpperCase(),
                      value: row.totalUsd,
                      detail: `${row.count} log`,
                    }))}
                  />
                </div>
              </article>
            </section>

            <section style={twoColumnGridStyle}>
              <article style={panelStyle}>
                <SectionHeader
                  copy="Shot bazli toplam harcama"
                  title="Shot maliyetleri"
                />
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Shot</th>
                        <th style={thStyle}>Log</th>
                        <th style={thStyle}>Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.byShot.map((row) => (
                        <tr key={row.shotNumber}>
                          <td style={tdPrimaryStyle}>{row.shotNumber}</td>
                          <td style={tdMutedStyle}>{row.count}</td>
                          <td style={tdPrimaryStyle}>{formatUsd(row.totalUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article style={panelStyle}>
                <SectionHeader
                  copy="En yeni maliyet loglari"
                  title="Son islemler"
                />
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Zaman</th>
                        <th style={thStyle}>Tur</th>
                        <th style={thStyle}>Model</th>
                        <th style={thStyle}>Shot</th>
                        <th style={thStyle}>Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.recentLogs.map((row) => (
                        <RecentLogRowView key={row.id} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          </>
        )}
      </section>
    </section>
  );
}

function TrendChart({ data }: { data: CostOverview["daily"] }) {
  if (data.length === 0) {
    return (
      <div style={chartEmptyStyle}>
        Bu aralikta gunluk harcama verisi yok.
      </div>
    );
  }

  const width = 760;
  const height = 220;
  const paddingX = 28;
  const paddingY = 22;
  const maxValue = Math.max(...data.map((point) => point.totalUsd), 1);
  const stepX = data.length === 1 ? width / 2 : (width - paddingX * 2) / (data.length - 1);

  const points = data.map((point, index) => {
    const x = paddingX + stepX * index;
    const ratio = point.totalUsd / maxValue;
    const y = height - paddingY - ratio * (height - paddingY * 2);
    return { ...point, x, y };
  });

  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = [
    `${points[0]?.x ?? paddingX},${height - paddingY}`,
    ...points.map((point) => `${point.x},${point.y}`),
    `${points[points.length - 1]?.x ?? width - paddingX},${height - paddingY}`,
  ].join(" ");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <svg style={chartStyle} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="costAreaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--surface-active)" />
            <stop offset="100%" stopColor="var(--surface-hover)" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = height - paddingY - tick * (height - paddingY * 2);
          return (
            <line
              key={tick}
              stroke="var(--surface-active)"
              strokeDasharray="4 8"
              x1={paddingX}
              x2={width - paddingX}
              y1={y}
              y2={y}
            />
          );
        })}

        <polygon fill="url(#costAreaFill)" points={area} />
        <polyline
          fill="none"
          points={polyline}
          stroke="var(--accent)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />

        {points.map((point) => (
          <g key={point.day}>
            <circle cx={point.x} cy={point.y} fill="var(--accent)" r="4.5" />
            <circle cx={point.x} cy={point.y} fill="var(--glass-border)" r="10" />
          </g>
        ))}
      </svg>

      <div style={chartAxisStyle}>
        {points.map((point) => (
          <div key={point.day} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {point.day.slice(5)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {formatUsd(point.totalUsd)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({
  rows,
  emptyLabel,
}: {
  rows: Array<{ label: string; value: number; detail: string }>;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <div style={chartEmptyStyle}>{emptyLabel}</div>;
  }

  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {rows.slice(0, 8).map((row) => {
        const width = `${Math.max((row.value / maxValue) * 100, 6)}%`;

        return (
          <div key={`${row.label}-${row.detail}`} style={{ display: "grid", gap: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{row.label}</strong>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{row.detail}</span>
              </div>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {formatUsd(row.value)}
              </span>
            </div>
            <div style={barTrackStyle}>
              <div style={{ ...barFillStyle, width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentLogRowView({ row }: { row: CostLogRow }) {
  return (
    <tr>
      <td style={tdMutedStyle}>
        {new Date(row.loggedAt).toLocaleDateString("tr-TR", {
          day: "2-digit",
          month: "short",
        })}
      </td>
      <td style={tdMutedStyle}>{row.type}</td>
      <td style={tdPrimaryStyle}>{row.model}</td>
      <td style={tdMutedStyle}>{row.shotNumber ?? row.assetFilename ?? "—"}</td>
      <td style={tdPrimaryStyle}>{formatUsd(row.amountUsd)}</td>
    </tr>
  );
}

function SectionHeader({ title, copy }: { title: string; copy: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>{copy}</div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article style={metricCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={metricIconStyle}>{icon}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {label}
        </span>
      </div>
      <strong style={{ fontSize: 28, letterSpacing: "-0.03em" }}>{value}</strong>
      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{detail}</span>
    </article>
  );
}


function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value);
}

const heroStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
  padding: 24,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background: "linear-gradient(135deg, var(--surface-hover), transparent 28%), var(--bg-surface)",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid var(--border-default)",
  background: "var(--surface-hover)",
  color: "var(--text-primary)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies React.CSSProperties;

const copyStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies React.CSSProperties;

const toolbarStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  padding: 18,
  borderRadius: 22,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;


const metricsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
} satisfies React.CSSProperties;

const metricCardStyle = {
  display: "grid",
  gap: 10,
  padding: 18,
  borderRadius: 20,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const metricIconStyle = {
  display: "inline-grid",
  placeItems: "center",
  width: 34,
  height: 34,
  borderRadius: 12,
  background: "var(--surface-hover)",
  color: "var(--text-primary)",
} satisfies React.CSSProperties;

const twoColumnGridStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)",
  gap: 16,
} satisfies React.CSSProperties;

const panelStyle = {
  display: "grid",
  gap: 18,
  padding: 20,
  borderRadius: 24,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
  minWidth: 0,
} satisfies React.CSSProperties;

const chartStyle = {
  width: "100%",
  height: 220,
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "linear-gradient(180deg, var(--surface-hover), var(--surface-hover))",
} satisfies React.CSSProperties;

const chartAxisStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))",
  gap: 10,
} satisfies React.CSSProperties;

const chartEmptyStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 180,
  borderRadius: 18,
  border: "1px dashed var(--border-default)",
  color: "var(--text-muted)",
  fontSize: 12,
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const barTrackStyle = {
  height: 10,
  borderRadius: 999,
  background: "var(--surface-hover)",
  overflow: "hidden",
} satisfies React.CSSProperties;

const barFillStyle = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, var(--accent), var(--text-muted))",
} satisfies React.CSSProperties;

const tableWrapStyle = {
  overflowX: "auto",
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
} satisfies React.CSSProperties;

const thStyle = {
  padding: "12px 14px",
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
} satisfies React.CSSProperties;

const tdPrimaryStyle = {
  padding: "12px 14px",
  fontSize: 13,
  color: "var(--text-primary)",
  borderBottom: "1px solid var(--surface-hover)",
  whiteSpace: "nowrap",
} satisfies React.CSSProperties;

const tdMutedStyle = {
  ...tdPrimaryStyle,
  color: "var(--text-secondary)",
} satisfies React.CSSProperties;

