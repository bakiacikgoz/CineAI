import type { CSSProperties } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useUIStore } from "@/store/ui.store";

export function AppLayout() {
  const sidebarExpanded = useUIStore((state) => state.sidebarExpanded);
  const location = useLocation();

  return (
    <div
      className="app-shell"
      style={
        {
          "--sidebar-panel-current": sidebarExpanded ? "var(--sidebar-panel-w)" : "0px",
        } as CSSProperties
      }
    >
      <div className="topbar-slot">
        <TopBar />
      </div>
      <div className="sidebar-slot">
        <Sidebar />
      </div>
      <main className="main-panel">
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
