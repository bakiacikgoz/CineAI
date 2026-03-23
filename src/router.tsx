import { Suspense, lazy, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

const AssetLibrary = lazy(async () => ({
  default: (await import("@/screens/asset-library/AssetLibrary")).AssetLibrary,
}));
const Characters = lazy(async () => ({
  default: (await import("@/screens/characters/Characters")).Characters,
}));
const CostDashboard = lazy(async () => ({
  default: (await import("@/screens/cost-dashboard/CostDashboard")).CostDashboard,
}));
const Dashboard = lazy(async () => ({
  default: (await import("@/screens/dashboard/Dashboard")).Dashboard,
}));
const ImageGenerator = lazy(async () => ({
  default: (await import("@/screens/image-generator/ImageGenerator")).ImageGenerator,
}));
const JobQueue = lazy(async () => ({
  default: (await import("@/screens/job-queue/JobQueue")).JobQueue,
}));
const ModelManager = lazy(async () => ({
  default: (await import("@/screens/model-manager/ModelManager")).ModelManager,
}));
const PromptLibrary = lazy(async () => ({
  default: (await import("@/screens/prompt-library/PromptLibrary")).PromptLibrary,
}));
const Settings = lazy(async () => ({
  default: (await import("@/screens/settings/Settings")).Settings,
}));
const Storyboard = lazy(async () => ({
  default: (await import("@/screens/storyboard/Storyboard")).Storyboard,
}));
const VideoGenerator = lazy(async () => ({
  default: (await import("@/screens/video-generator/VideoGenerator")).VideoGenerator,
}));

function RouteFallback() {
  return (
    <section className="screen-shell">
      <section
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "calc(100vh - var(--topbar-h) - 110px)",
          borderRadius: 24,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        Panel yukleniyor...
      </section>
    </section>
  );
}

function withRouteFallback(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />} path="/">
          <Route element={<Navigate replace to="/dashboard" />} index />
          <Route element={withRouteFallback(<Dashboard />)} path="dashboard" />
          <Route element={withRouteFallback(<ImageGenerator />)} path="image-generator" />
          <Route element={withRouteFallback(<VideoGenerator />)} path="video-generator" />
          <Route element={withRouteFallback(<Storyboard />)} path="storyboard" />
          <Route element={withRouteFallback(<JobQueue />)} path="job-queue" />
          <Route element={withRouteFallback(<AssetLibrary />)} path="asset-library" />
          <Route element={withRouteFallback(<Characters />)} path="characters" />
          <Route element={withRouteFallback(<PromptLibrary />)} path="prompt-library" />
          <Route element={withRouteFallback(<ModelManager />)} path="model-manager" />
          <Route element={withRouteFallback(<CostDashboard />)} path="cost-dashboard" />
          <Route element={withRouteFallback(<Settings />)} path="settings" />
          <Route element={<Navigate replace to="/dashboard" />} path="*" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
