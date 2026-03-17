import { useEffect } from "react";
import {
  BookText,
  Bot,
  Clapperboard,
  Film,
  FolderOpen,
  Image,
  LayoutDashboard,
  ListOrdered,
  Settings,
  UserRound,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useUIStore, type ActiveScreen } from "@/store/ui.store";

type NavItem = {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  screen: ActiveScreen;
};

const NAV_ITEMS: NavItem[] = [
  {
    path: "/dashboard",
    label: "Dashboard",
    description: "Genel kontrol merkezi",
    icon: LayoutDashboard,
    screen: "dashboard",
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
  {
    path: "/job-queue",
    label: "Is Kuyrugu",
    description: "Paralel calisma paneli",
    icon: ListOrdered,
    screen: "job-queue",
  },
  {
    path: "/asset-library",
    label: "Asset Kutuphanesi",
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
    label: "Maliyet",
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
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeScreen = useUIStore((state) => state.activeScreen);
  const setActiveScreen = useUIStore((state) => state.setActiveScreen);
  const sidebarExpanded = useUIStore((state) => state.sidebarExpanded);

  useEffect(() => {
    const nextItem = NAV_ITEMS.find((item) => location.pathname.startsWith(item.path));

    if (nextItem && nextItem.screen !== activeScreen) {
      setActiveScreen(nextItem.screen);
    }
  }, [activeScreen, location.pathname, setActiveScreen]);

  return (
    <aside className="sidebar-shell">
      <nav aria-label="Primary" className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
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
            </button>
          );
        })}
      </nav>

      {sidebarExpanded ? (
        <div className="sidebar-footer">
          <div className="sidebar-footer-card">
            <span className="sidebar-footer-title">Foundation v0.1</span>
            <span className="sidebar-footer-copy">
              Tema, routing, store ve migration tabani hazir. Sonraki fazda ekranlar
              islevsel hale gelecek.
            </span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
