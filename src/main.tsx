import "@fontsource/inter";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "./db";
import { initFal } from "./services/fal.service";
import { initializeJobQueuePersistence } from "./services/jobqueue-persistence.service";
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

function FoundationBootstrap() {
  useEffect(() => {
    initializeJobQueuePersistence();
    void bootstrapFoundation();
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
