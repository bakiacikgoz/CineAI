import "@fontsource/inter";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "./db";
import { hydrateAppState } from "./services/app-bootstrap.service";
import { initFal } from "./services/fal.service";
import { initializeJobQueuePersistence } from "./services/jobqueue-persistence.service";
import { getAppSetting } from "./lib/store";
import { useUIStore, type ThemeMode } from "./store/ui.store";
import { AppRouter } from "./router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
    },
  },
});

async function bootstrapFoundation() {
  try {
    await Promise.all([getDb("workspace"), initFal()]);
  } catch (error) {
    console.error("Foundation bootstrap failed", error);
  }
}

function applyThemeToDOM(theme: ThemeMode): void {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme === "light") {
    document.documentElement.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}

function FoundationBootstrap() {
  useEffect(() => {
    initializeJobQueuePersistence();
    void (async () => {
      try {
        await hydrateAppState();
      } catch (error) {
        console.error("App state hydration failed", error);
      }

      // Initialize theme from persisted preference
      try {
        const savedTheme = await getAppSetting<ThemeMode>("THEME_PREFERENCE");
        const theme: ThemeMode = savedTheme === "dark" || savedTheme === "system" ? savedTheme : "light";
        applyThemeToDOM(theme);
        useUIStore.getState().setTheme(theme);
      } catch (error) {
        console.error("Theme initialization failed", error);
      }

      await bootstrapFoundation();
    })();
  }, []);

  // Listen for system color scheme changes when in "system" mode
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentTheme = useUIStore.getState().theme;
      if (currentTheme === "system") {
        applyThemeToDOM("system");
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <FoundationBootstrap />
      <AppRouter />
    </QueryClientProvider>
  </React.StrictMode>,
);
