import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { AssetLibrary } from "@/screens/asset-library/AssetLibrary";
import { Characters } from "@/screens/characters/Characters";
import { CostDashboard } from "@/screens/cost-dashboard/CostDashboard";
import { Dashboard } from "@/screens/dashboard/Dashboard";
import { ImageGenerator } from "@/screens/image-generator/ImageGenerator";
import { JobQueue } from "@/screens/job-queue/JobQueue";
import { ModelManager } from "@/screens/model-manager/ModelManager";
import { PromptLibrary } from "@/screens/prompt-library/PromptLibrary";
import { Settings } from "@/screens/settings/Settings";
import { Storyboard } from "@/screens/storyboard/Storyboard";
import { VideoGenerator } from "@/screens/video-generator/VideoGenerator";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />} path="/">
          <Route element={<Navigate replace to="/dashboard" />} index />
          <Route element={<Dashboard />} path="dashboard" />
          <Route element={<ImageGenerator />} path="image-generator" />
          <Route element={<VideoGenerator />} path="video-generator" />
          <Route element={<Storyboard />} path="storyboard" />
          <Route element={<JobQueue />} path="job-queue" />
          <Route element={<AssetLibrary />} path="asset-library" />
          <Route element={<Characters />} path="characters" />
          <Route element={<PromptLibrary />} path="prompt-library" />
          <Route element={<ModelManager />} path="model-manager" />
          <Route element={<CostDashboard />} path="cost-dashboard" />
          <Route element={<Settings />} path="settings" />
          <Route element={<Navigate replace to="/dashboard" />} path="*" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
