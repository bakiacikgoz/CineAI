import type { CSSProperties } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useUIStore } from "@/store/ui.store";

export function AppLayout() {
  const sidebarExpanded = useUIStore((state) => state.sidebarExpanded);

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
        <Outlet />
      </main>
    </div>
  );
}
