import { useEffect } from "react";
import {
  AudioLines,
  BookText,
  Bot,
  Clapperboard,
  Film,
  FolderOpen,
  Image,
  LayoutDashboard,
  ListOrdered,
  ScrollText,
  Settings,
  UserRound,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";
import { useUIStore, type ActiveScreen } from "@/store/ui.store";

type NavItem = {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  screen: ActiveScreen;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "URETIM",
    items: [
      {
        path: "/dashboard",
        label: "Dashboard",
        description: "Genel kontrol merkezi",
        icon: LayoutDashboard,
        screen: "dashboard",
      },
      {
        path: "/scenario-studio",
        label: "Senaryo Studio",
        description: "AI ile shot uretimi",
        icon: ScrollText,
        screen: "scenario-studio",
      },
      {
        path: "/image-generator",
        label: "Gorsel Uret",
        description: "Tekil kare olusturma",
        icon: Image,
        screen: "image-generator",
      },
      {
        path: "/video-generator",
        label: "Video Uret",
        description: "Hareket ve render akisi",
        icon: Film,
        screen: "video-generator",
      },
      {
        path: "/storyboard",
        label: "Storyboard",
        description: "Sekans ve sahne akisi",
        icon: Clapperboard,
        screen: "storyboard",
      },
    ],
  },
  {
    label: "YONETIM",
    items: [
      {
        path: "/job-queue",
        label: "Is Kuyrugu",
        description: "Paralel calisma paneli",
        icon: ListOrdered,
        screen: "job-queue",
      },
      {
        path: "/asset-library",
        label: "Varlik Kutuphanesi",
        description: "Uretilen medya arsivi",
        icon: FolderOpen,
        screen: "asset-library",
      },
      {
        path: "/characters",
        label: "Karakterler",
        description: "Karakter tutarliligi",
        icon: UserRound,
        screen: "characters",
      },
      {
        path: "/audio-pipeline",
        label: "Seslendirme",
        description: "Diyalog seslendirme hatti",
        icon: AudioLines,
        screen: "audio-pipeline",
      },
    ],
  },
  {
    label: "ARACLAR",
    items: [
      {
        path: "/prompt-library",
        label: "Prompt Kutuphanesi",
        description: "Sablon ve varyasyonlar",
        icon: BookText,
        screen: "prompt-library",
      },
      {
        path: "/model-manager",
        label: "Model Yonetici",
        description: "Saglayici ve presetler",
        icon: Bot,
        screen: "model-manager",
      },
      {
        path: "/cost-dashboard",
        label: "Maliyet Paneli",
        description: "Harcama gorunurlugu",
        icon: Wallet,
        screen: "cost-dashboard",
      },
      {
        path: "/settings",
        label: "Ayarlar",
        description: "API ve uygulama ayarlari",
        icon: Settings,
        screen: "settings",
      },
    ],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

const DIVIDER_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  padding: "16px 0 6px 16px",
};

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeScreen = useUIStore((state) => state.activeScreen);
  const setActiveScreen = useUIStore((state) => state.setActiveScreen);
  const sidebarExpanded = useUIStore((state) => state.sidebarExpanded);
  const activeJobCount = useQueueStore(
    (state) => state.jobs.filter((job) => job.status === "active").length,
  );
  const activeProject = useProjectStore((state) => state.activeProject);

  useEffect(() => {
    const nextItem = ALL_NAV_ITEMS.find((item) => location.pathname.startsWith(item.path));

    if (nextItem && nextItem.screen !== activeScreen) {
      setActiveScreen(nextItem.screen);
    }
  }, [activeScreen, location.pathname, setActiveScreen]);

  return (
    <aside className="sidebar-shell">
      <nav aria-label="Primary" className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {sidebarExpanded ? (
              <div style={DIVIDER_STYLE}>{group.label}</div>
            ) : null}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;

              return (
                <button
                  key={item.path}
                  className={cn(
                    "sidebar-link",
                    isActive && "is-active",
                    !sidebarExpanded && "is-collapsed",
                  )}
                  onClick={() => {
                    setActiveScreen(item.screen);
                    navigate(item.path);
                  }}
                  title={item.label}
                  type="button"
                >
                  <span className="sidebar-icon">
                    <Icon size={18} />
                  </span>
                  <span className="sidebar-copy">
                    <span className="sidebar-label">{item.label}</span>
                    <span className="sidebar-meta">{item.description}</span>
                  </span>
                  {item.path === "/job-queue" && activeJobCount > 0 ? (
                    <span
                      style={
                        sidebarExpanded
                          ? {
                              marginLeft: "auto",
                              display: "inline-flex",
                              width: 18,
                              height: 18,
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 999,
                              background: "var(--accent)",
                              color: "var(--on-accent)",
                              fontSize: 10,
                              fontWeight: 800,
                            }
                          : {
                              position: "absolute",
                              top: 6,
                              right: 6,
                              display: "inline-flex",
                              width: 18,
                              height: 18,
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 999,
                              background: "var(--accent)",
                              color: "var(--on-accent)",
                              fontSize: 10,
                              fontWeight: 800,
                            }
                      }
                    >
                      {Math.min(activeJobCount, 99)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {sidebarExpanded ? (
        <div className="sidebar-footer">
          <div className="sidebar-footer-card">
            <span className="sidebar-footer-title">
              {activeProject ? activeProject.name : "CineAI Studio"}
            </span>
            <span className="sidebar-footer-copy">
              {activeProject ? "aktif proje" : "v1.0"}
            </span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
