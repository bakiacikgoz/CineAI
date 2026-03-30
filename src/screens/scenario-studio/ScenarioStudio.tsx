import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  History,
  FileText,
  Loader2,
  PlayCircle,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  CollapsibleSection,
  MetricCard,
  ProCard,
  ProEmptyState,
  SegmentGroup,
  StatusDot,
} from "@/components/ui";
import { getAppSetting, setAppSetting } from "@/lib/store";
import { useProjectStore } from "@/store/project.store";
import { useScenarioStore, type GenerationLogEntry } from "@/store/scenario.store";
import type { OpenRouterModelOption } from "@/services/llm.service";
import {
  formatOpenRouterProvider,
  inferOpenRouterProvider,
  listOpenRouterModels,
} from "@/services/llm.service";
import type { ScenarioHistoryEntry } from "@/services/scenario-history.service";
import { listScenarioHistory } from "@/services/scenario-history.service";
import { analyzeScenario, generateShotsFromPlan } from "@/services/scenario-generation.service";
import { insertGeneratedShots, persistGeneratedShotFiles } from "@/services/scenario-insert.service";
import type { TargetVideoModel, KlingPreset, ShotPlan } from "@/lib/scenario-types";

type WizardPhase = "input" | "plan" | "generating" | "done";

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      error?: unknown;
      details?: unknown;
      cause?: unknown;
      code?: unknown;
    };

    for (const value of [candidate.message, candidate.error, candidate.details, candidate.cause]) {
      const nested = extractErrorMessage(value, "");

      if (nested) {
        return candidate.code ? `[${String(candidate.code)}] ${nested}` : nested;
      }
    }

    try {
      const serialized = JSON.stringify(error, null, 2);

      if (serialized && serialized !== "{}") {
        return serialized.slice(0, 1200);
      }
    } catch {
      // ignore serialization failures
    }
  }

  return fallback;
}

function formatModelPricing(option: OpenRouterModelOption): string {
  if (option.promptPricePerM === null && option.completionPricePerM === null) {
    return "";
  }

  const prompt = option.promptPricePerM !== null ? `$${option.promptPricePerM.toFixed(2)}` : "-";
  const completion = option.completionPricePerM !== null ? `$${option.completionPricePerM.toFixed(2)}` : "-";
  return `${prompt}/${completion} per 1M`;
}

function formatModelContextLength(option: OpenRouterModelOption): string {
  if (!option.contextLength) {
    return "Context bilinmiyor";
  }

  if (option.contextLength >= 1_000_000) {
    return `${(option.contextLength / 1_000_000).toFixed(1).replace(/\.0$/, "")}M context`;
  }

  if (option.contextLength >= 1_000) {
    const precision = option.contextLength >= 100_000 ? 0 : 1;
    return `${(option.contextLength / 1_000).toFixed(precision).replace(/\.0$/, "")}K context`;
  }

  return `${option.contextLength} context`;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function compareProviderKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left === "openrouter") {
    return -1;
  }

  if (right === "openrouter") {
    return 1;
  }

  return formatOpenRouterProvider(left).localeCompare(formatOpenRouterProvider(right), "tr-TR");
}

function formatScenarioDate(value: number): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function formatScenarioStatus(status: string): string {
  switch (status) {
    case "done":
      return "Tamamlandi";
    case "planned":
      return "Planlandi";
    case "generating":
      return "Uretiliyor";
    case "analyzing":
      return "Analiz";
    case "error":
      return "Hata";
    default:
      return "Taslak";
  }
}

function getScenarioStatusTone(status: string): "success" | "active" | "warning" | "error" | "pending" {
  switch (status) {
    case "done":
      return "success";
    case "generating":
    case "analyzing":
      return "active";
    case "planned":
      return "warning";
    case "error":
      return "error";
    default:
      return "pending";
  }
}

function getScenarioExcerpt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

export function ScenarioStudio() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const scenario = useScenarioStore();
  const [phase, setPhase] = useState<WizardPhase>("input");
  const [targetModel, setTargetModel] = useState<TargetVideoModel>("veo31");
  const [klingPreset, setKlingPreset] = useState<KlingPreset>("ultra-realism");
  const [selectedLlmModel, setSelectedLlmModel] = useState("openrouter/auto");
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [llmSearchQuery, setLlmSearchQuery] = useState("");
  const [availableLlmModels, setAvailableLlmModels] = useState<OpenRouterModelOption[]>([
    {
      id: "openrouter/auto",
      name: "OpenRouter Auto",
      provider: "openrouter",
      contextLength: null,
      promptPricePerM: null,
      completionPricePerM: null,
    },
  ]);
  const [isLoadingLlmModels, setIsLoadingLlmModels] = useState(false);
  const [llmModelError, setLlmModelError] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ScenarioHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [localText, setLocalText] = useState(scenario.scenarioText);
  const abortRef = useRef<AbortController | null>(null);

  const llmModelOptions = useMemo(() => {
    if (availableLlmModels.some((model) => model.id === selectedLlmModel)) {
      return availableLlmModels;
    }

    return [
      {
        id: selectedLlmModel,
        name: selectedLlmModel,
        provider: inferOpenRouterProvider(selectedLlmModel),
        contextLength: null,
        promptPricePerM: null,
        completionPricePerM: null,
      },
      ...availableLlmModels,
    ];
  }, [availableLlmModels, selectedLlmModel]);

  const selectedModelOption = useMemo(
    () => llmModelOptions.find((model) => model.id === selectedLlmModel) ?? null,
    [llmModelOptions, selectedLlmModel],
  );

  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>();

    for (const model of llmModelOptions) {
      counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    }

    return [
      { value: "all", label: `Tum providerlar (${llmModelOptions.length})` },
      ...Array.from(counts.entries())
        .sort(([left], [right]) => compareProviderKeys(left, right))
        .map(([provider, count]) => ({
          value: provider,
          label: `${formatOpenRouterProvider(provider)} (${count})`,
        })),
    ];
  }, [llmModelOptions]);

  const providerScopedLlmModels = useMemo(() => {
    if (selectedProvider === "all") {
      return llmModelOptions;
    }

    return llmModelOptions.filter((model) => model.provider === selectedProvider);
  }, [llmModelOptions, selectedProvider]);

  const filteredLlmModelOptions = useMemo(() => {
    const query = normalizeSearchValue(llmSearchQuery);

    if (!query) {
      return providerScopedLlmModels;
    }

    return providerScopedLlmModels.filter((model) =>
      `${model.name} ${model.id} ${formatOpenRouterProvider(model.provider)}`
        .toLocaleLowerCase("tr-TR")
        .includes(query),
    );
  }, [llmSearchQuery, providerScopedLlmModels]);

  const visibleLlmModelOptions = useMemo(() => {
    if (filteredLlmModelOptions.some((model) => model.id === selectedLlmModel)) {
      return filteredLlmModelOptions;
    }

    if (!selectedModelOption) {
      return filteredLlmModelOptions;
    }

    if (selectedProvider !== "all" && selectedModelOption.provider !== selectedProvider) {
      return filteredLlmModelOptions;
    }

    return [selectedModelOption, ...filteredLlmModelOptions];
  }, [filteredLlmModelOptions, selectedLlmModel, selectedModelOption, selectedProvider]);

  useEffect(() => {
    let cancelled = false;

    async function loadLlmPreferences() {
      const savedModel = (await getAppSetting<string>("SCENARIO_STUDIO_LLM_MODEL"))?.trim();

      if (!cancelled && savedModel) {
        setSelectedLlmModel(savedModel);
        setSelectedProvider(inferOpenRouterProvider(savedModel));
      }

      setIsLoadingLlmModels(true);
      setLlmModelError(null);

      try {
        const models = await listOpenRouterModels();

        if (!cancelled) {
          setAvailableLlmModels(models);
        }
      } catch (error) {
        if (!cancelled) {
          setLlmModelError(extractErrorMessage(error, "OpenRouter model listesi alinamadi."));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLlmModels(false);
        }
      }
    }

    void loadLlmPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (!activeProject?.id) {
        setHistoryEntries([]);
        setHistoryError(null);
        return;
      }

      setIsLoadingHistory(true);
      setHistoryError(null);

      try {
        const entries = await listScenarioHistory(activeProject.id);

        if (!cancelled) {
          setHistoryEntries(entries);
        }
      } catch (error) {
        if (!cancelled) {
          setHistoryError(extractErrorMessage(error, "Senaryo gecmisi alinamadi."));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [activeProject?.id]);

  if (!activeProject) {
    return (
      <section style={screenStyle}>
        <ProEmptyState
          icon={Clapperboard}
          title="Proje secin"
          description="Senaryo Studio'yu kullanmak icin once bir proje secin veya olusturun."
        />
      </section>
    );
  }

  async function handleImportFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Metin", extensions: ["md", "txt"] }],
    });

    if (!selected) {
      return;
    }

    try {
      const content = await readTextFile(selected as string);
      setLocalText(content);
    } catch (error) {
      await message(extractErrorMessage(error, "Dosya okunamadi."), {
        title: "Senaryo Studio",
        kind: "error",
      });
    }
  }

  async function handleAnalyze() {
    if (!localText.trim() || !activeProject) {
      return;
    }

    scenario.setScenarioText(localText);
    scenario.setIsAnalyzing(true);
    scenario.setError(null);
    abortRef.current = new AbortController();

    try {
      const result = await analyzeScenario({
        scenarioText: localText,
        targetModel,
        klingPreset: targetModel === "kling-3.0" ? klingPreset : undefined,
        llmModel: selectedLlmModel,
        projectId: activeProject.id,
        abortSignal: abortRef.current.signal,
      });
      scenario.setScenarioId(result.scenarioId);
      scenario.setShotPlan(result.plan);
      void listScenarioHistory(activeProject.id).then(setHistoryEntries).catch(() => undefined);
      setPhase("plan");
    } catch (error) {
      const errorMsg = extractErrorMessage(error, "Analiz basarisiz.");
      scenario.setError(errorMsg);
      await message(errorMsg, { title: "Senaryo Studio", kind: "error" });
    } finally {
      scenario.setIsAnalyzing(false);
    }
  }

  async function handleGenerate() {
    if (!scenario.shotPlan || !scenario.scenarioId || !activeProject) {
      return;
    }

    scenario.setIsGenerating(true);
    scenario.setError(null);
    setPhase("generating");
    abortRef.current = new AbortController();

    try {
      const result = await generateShotsFromPlan({
        scenarioId: scenario.scenarioId,
        scenarioText: scenario.scenarioText,
        plan: scenario.shotPlan,
        targetModel,
        klingPreset: targetModel === "kling-3.0" ? klingPreset : undefined,
        llmModel: selectedLlmModel,
        projectId: activeProject.id,
        abortSignal: abortRef.current.signal,
        onProgress: (progress) => scenario.setGenerationProgress(progress),
        onLogEntry: (pass, msg, shotNum) => scenario.addLogEntry({ pass, message: msg, shotNumber: shotNum }),
        onShotCompleted: (shotNum) => scenario.addCompletedShot(shotNum),
      });

      scenario.addLogEntry({ pass: 5, message: "SHOT markdown dosyalari diske yaziliyor..." });

      try {
        await persistGeneratedShotFiles({
          projectFolderPath: activeProject.folderPath,
          scenarioId: scenario.scenarioId,
          shotFiles: result.shotFiles,
        });
      } catch (error) {
        throw new Error(
          `SHOT markdown dosyalari yazilamadi: ${extractErrorMessage(error, "Bilinmeyen dosya sistemi hatasi.")}`,
        );
      }

      scenario.addLogEntry({ pass: 5, message: "Storyboard veritabanina insert basliyor..." });

      try {
        await insertGeneratedShots({
          projectId: activeProject.id,
          shots: result.shots,
          scenarioId: scenario.scenarioId,
          clearExisting: true,
        });
      } catch (error) {
        throw new Error(
          `Uretilen shot'lar storyboard veritabanina yazilamadi: ${extractErrorMessage(error, "Bilinmeyen veritabani hatasi.")}`,
        );
      }

      void listScenarioHistory(activeProject.id).then(setHistoryEntries).catch(() => undefined);
      setPhase("done");
    } catch (error) {
      const errorMsg = extractErrorMessage(error, "Uretim basarisiz.");
      scenario.setError(errorMsg);
      scenario.addLogEntry({
        pass: scenario.generationProgress?.currentPass ?? 5,
        message: `HATA: ${errorMsg}`,
      });
      setPhase("plan");
      await message(errorMsg, { title: "Senaryo Studio", kind: "error" });
    } finally {
      scenario.setIsGenerating(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleReset() {
    scenario.reset();
    setPhase("input");
    setLocalText("");
  }

  function handleSelectLlmModel(nextModel: string) {
    const nextOption = llmModelOptions.find((model) => model.id === nextModel);
    setSelectedLlmModel(nextModel);
    setSelectedProvider(nextOption?.provider ?? inferOpenRouterProvider(nextModel));
    void setAppSetting("SCENARIO_STUDIO_LLM_MODEL", nextModel);
  }

  function handleSelectProvider(nextProvider: string) {
    setSelectedProvider(nextProvider);

    if (nextProvider === "all") {
      return;
    }

    const providerModels = llmModelOptions.filter((model) => model.provider === nextProvider);

    if (providerModels.length === 0) {
      return;
    }

    if (!providerModels.some((model) => model.id === selectedLlmModel)) {
      handleSelectLlmModel(providerModels[0].id);
    }
  }

  function handleRestoreHistory(entry: ScenarioHistoryEntry) {
    scenario.reset();
    scenario.setScenarioText(entry.scenarioText);
    scenario.setScenarioId(entry.id);
    scenario.setShotPlan(entry.shotPlan);
    scenario.setError(null);
    setLocalText(entry.scenarioText);
    setTargetModel(entry.targetModel);
    setKlingPreset(entry.klingPreset ?? "ultra-realism");
    handleSelectLlmModel(entry.llmModel);
    setPhase(entry.shotPlan ? "plan" : "input");
  }

  return (
    <section style={screenStyle}>
      <div style={{ display: "grid", gap: 16 }}>
        {/* ── Header ───────────────────────────────────── */}
        <header style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>
              Senaryo Studio
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              Lead Director planlar, Shot Generator her ana shot icin film-kit tarzinda tek SHOT dosyasi uretir.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusDot
              status={
                phase === "done" ? "success"
                  : phase === "generating" ? "active"
                  : phase === "plan" ? "warning"
                  : "pending"
              }
              label={
                phase === "done" ? "Tamamlandi"
                  : phase === "generating" ? "Uretiliyor"
                  : phase === "plan" ? "Plan hazir"
                  : "Giris bekleniyor"
              }
            />
          </div>
        </header>

        <ProCard title="Senaryo Agent Modeli" subtitle="Lead Director ve Shot Generator icin kullanilacak OpenRouter modeli">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={modelPickerGridStyle}>
              <label style={modelFilterFieldStyle}>
                <span style={modelFilterLabelStyle}>Provider</span>
                <select
                  value={selectedProvider}
                  onChange={(event) => handleSelectProvider(event.target.value)}
                  style={scenarioSelectStyle}
                  disabled={isLoadingLlmModels}
                >
                  {providerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={modelFilterFieldStyle}>
                <span style={modelFilterLabelStyle}>Model ara</span>
                <div style={modelSearchWrapStyle}>
                  <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <input
                    value={llmSearchQuery}
                    onChange={(event) => setLlmSearchQuery(event.target.value)}
                    placeholder="claude, gpt-4.1, gemini, deepseek..."
                    style={modelSearchInputStyle}
                    disabled={isLoadingLlmModels}
                  />
                </div>
              </label>

              <label style={modelFilterFieldStyle}>
                <span style={modelFilterLabelStyle}>Model</span>
                <select
                  value={selectedLlmModel}
                  onChange={(event) => handleSelectLlmModel(event.target.value)}
                  style={scenarioSelectStyle}
                  disabled={isLoadingLlmModels || visibleLlmModelOptions.length === 0}
                >
                  {visibleLlmModelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                      {formatModelPricing(model) ? ` — ${formatModelPricing(model)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={modelMetaRowStyle}>
              <span style={historyMetaBadgeStyle}>{providerOptions.length - 1} provider</span>
              <span style={historyMetaBadgeStyle}>{filteredLlmModelOptions.length} model gorunuyor</span>
              <span style={historyMetaBadgeStyle}>
                Filtre: {selectedProvider === "all" ? "Tum providerlar" : formatOpenRouterProvider(selectedProvider)}
              </span>
            </div>

            {selectedModelOption ? (
              <div style={selectedModelCardStyle}>
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={modelFilterLabelStyle}>Secili ajan modeli</span>
                  <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>{selectedModelOption.name}</strong>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {selectedModelOption.id}
                  </span>
                </div>
                <div style={modelMetaRowStyle}>
                  <span style={historyMetaBadgeStyle}>{formatOpenRouterProvider(selectedModelOption.provider)}</span>
                  <span style={historyMetaBadgeStyle}>{formatModelContextLength(selectedModelOption)}</span>
                  <span style={historyMetaBadgeStyle}>
                    {formatModelPricing(selectedModelOption) || "Fiyat bilgisi yok"}
                  </span>
                </div>
              </div>
            ) : null}

            {filteredLlmModelOptions.length === 0 && !isLoadingLlmModels ? (
              <div style={warningBannerStyle}>
                <AlertTriangle size={14} />
                <span>Bu provider ve arama filtresiyle eslesen model bulunamadi.</span>
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                {isLoadingLlmModels
                  ? "OpenRouter model listesi yukleniyor..."
                  : "Provider bazinda daraltip model aratarak daha ucuz veya daha hizli bir ajan secimi yapabilirsin."}
              </span>
              {llmModelError ? (
                <div style={warningBannerStyle}>
                  <AlertTriangle size={14} />
                  <span style={{ whiteSpace: "pre-wrap" }}>{llmModelError}</span>
                </div>
              ) : null}
            </div>
          </div>
        </ProCard>

        <ScenarioHistoryPanel
          entries={historyEntries}
          isLoading={isLoadingHistory}
          error={historyError}
          onRestore={handleRestoreHistory}
        />

        {/* ── Phase: Input ─────────────────────────────── */}
        {phase === "input" ? (
          <>
            <ProCard title="Hedef Video Modeli" subtitle="Shot prompt'lari bu modele gore olusturulur">
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <SegmentGroup
                  options={[
                    { key: "veo31", label: "Veo 3.1" },
                    { key: "kling-3.0", label: "Kling 3.0" },
                  ]}
                  value={targetModel}
                  onChange={(key) => setTargetModel(key as TargetVideoModel)}
                />
                {targetModel === "kling-3.0" ? (
                  <SegmentGroup
                    options={[
                      { key: "ultra-realism", label: "Ultra Realism" },
                      { key: "balanced", label: "Balanced" },
                      { key: "custom", label: "Custom" },
                    ]}
                    value={klingPreset}
                    onChange={(key) => setKlingPreset(key as KlingPreset)}
                  />
                ) : null}
              </div>
            </ProCard>

            <ProCard
              title="Senaryo Metni"
              subtitle="Senaryonuzu yazin veya bir dosyadan icerik alin"
              headerRight={
                <button
                  className="btn-secondary"
                  onClick={() => void handleImportFile()}
                  type="button"
                  style={{ fontSize: 12, minHeight: 32 }}
                >
                  <Upload size={14} />
                  Dosya yukle (.md / .txt)
                </button>
              }
            >
              <div style={{ display: "grid", gap: 12 }}>
                <textarea
                  onChange={(e) => setLocalText(e.target.value)}
                  placeholder="Senaryonuzu buraya yazin... Sahneler, diyaloglar, aksiyonlar, mekan tasvirleri — ne kadar detay verirseniz o kadar iyi shot'lar uretilir."
                  rows={16}
                  style={textareaStyle}
                  value={localText}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                    {localText.trim().split(/\s+/).filter(Boolean).length} kelime
                  </span>
                  <button
                    className="btn-primary"
                    disabled={!localText.trim() || scenario.isAnalyzing}
                    onClick={() => void handleAnalyze()}
                    type="button"
                    style={{ minHeight: 40, fontSize: 14, padding: "8px 24px" }}
                  >
                    {scenario.isAnalyzing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Analiz ediliyor...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Analiz Et
                      </>
                    )}
                  </button>
                </div>
              </div>
            </ProCard>
          </>
        ) : null}

        {/* ── Phase: Plan Review ───────────────────────── */}
        {phase === "plan" && scenario.shotPlan ? (
          <PlanReview
            plan={scenario.shotPlan}
            targetModel={targetModel}
            isGenerating={scenario.isGenerating}
            error={scenario.error}
            onGenerate={() => void handleGenerate()}
            onBack={handleReset}
          />
        ) : null}

        {phase === "plan" && scenario.error && scenario.generationLog.length > 0 ? (
          <GenerationFailureCard error={scenario.error} log={scenario.generationLog} />
        ) : null}

        {/* ── Phase: Generating ────────────────────────── */}
        {phase === "generating" ? (
          <GeneratingView
            progress={scenario.generationProgress}
            log={scenario.generationLog}
            completedShots={scenario.completedShotNumbers}
            plan={scenario.shotPlan}
            onCancel={handleCancel}
          />
        ) : null}

        {/* ── Phase: Done ──────────────────────────────── */}
        {phase === "done" ? (
          <ProCard title="Uretim Tamamlandi" subtitle="Tum shot'lar basariyla olusturuldu">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--status-success)" }}>
                <CheckCircle2 size={20} />
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {scenario.shotPlan?.totalMainShots ?? 0} ana shot + {scenario.shotPlan?.totalCoverageShots ?? 0} coverage shot uretildi
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    handleReset();
                  }}
                  type="button"
                >
                  <Clapperboard size={14} />
                  Yeni Senaryo
                </button>
              </div>
            </div>
          </ProCard>
        ) : null}

        {/* ── Error display ────────────────────────────── */}
        {scenario.error && phase !== "generating" ? (
          <div style={errorBannerStyle}>
            <AlertTriangle size={14} />
            <span style={{ whiteSpace: "pre-wrap" }}>{scenario.error}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ─── Plan Review Sub-component ──────────────────────────────────────────

function PlanReview(props: {
  plan: ShotPlan;
  targetModel: TargetVideoModel;
  isGenerating: boolean;
  error: string | null;
  onGenerate: () => void;
  onBack: () => void;
}) {
  const { plan } = props;
  const totalShots = plan.totalMainShots + plan.totalCoverageShots;

  return (
    <>
      {/* Metrics */}
      <section style={metricsGridStyle}>
        <MetricCard
          icon={Clapperboard}
          label="Ana Shot"
          value={plan.totalMainShots}
          description="Uretilecek ana shot sayisi"
          accentColor="var(--surface-hover)"
        />
        <MetricCard
          icon={FileText}
          label="Coverage"
          value={plan.totalCoverageShots}
          description="Kurgu esnekligi icin coverage"
          accentColor="rgba(99,102,241,0.7)"
        />
        <MetricCard
          icon={PlayCircle}
          label="Toplam Sure"
          value={`${plan.estimatedDurationS}s`}
          description={`~${Math.round(plan.estimatedDurationS / 60)} dakika`}
          accentColor="var(--status-success)"
        />
        <MetricCard
          icon={Sparkles}
          label="Batch"
          value={plan.batches?.length ?? 0}
          description="Lead Director batch parcasi"
          accentColor="rgba(245,158,11,0.7)"
        />
      </section>

      {/* Scenes */}
      <ProCard
        title="Shot Plani"
        subtitle={`${plan.scenes.length} sahne, ${totalShots} shot`}
        headerRight={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={props.onBack} type="button" style={{ fontSize: 12 }}>
              Geri don
            </button>
            <button
              className="btn-primary"
              disabled={props.isGenerating}
              onClick={props.onGenerate}
              type="button"
              style={{ fontSize: 13, padding: "6px 20px" }}
            >
              <Sparkles size={14} />
              Onayla ve Uret
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          {plan.shotSizing ? (
            <div style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(99,102,241,0.06)",
              border: "1px solid rgba(99,102,241,0.12)",
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}>
              <strong style={{ color: "var(--text-primary)" }}>Director-paced balance:</strong>{" "}
              {plan.shotSizing.globalRationale}
            </div>
          ) : null}
          {plan.scenes.map((scene) => (
            <CollapsibleSection
              key={scene.sceneNumber}
              title={`Sahne ${scene.sceneNumber}: ${scene.title} (${scene.shots.length} shot, gerilim: ${scene.tensionLevel}/5)`}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {scene.summaryTr}
                </p>
                <div style={{ display: "grid", gap: 4, paddingTop: 8 }}>
                  {scene.shots.map((shot) => (
                    <div
                      key={shot.shotNumber}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "6px 10px",
                        borderRadius: 8,
                        background: shot.type === "main" ? "var(--surface-hover)" : "transparent",
                        fontSize: 12,
                      }}
                    >
                      <strong style={{ minWidth: 70, color: "var(--text-primary)" }}>
                        {shot.shotNumber}
                      </strong>
                      <span style={shotTypeBadgeStyle(shot.type)}>
                        {shot.type === "main" ? "ANA" : shot.coverageType?.toUpperCase() ?? "COV"}
                      </span>
                      <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {shot.summaryTr}
                      </span>
                      <span style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>{shot.durationS}s</span>
                      {shot.hasDialogue ? (
                        <span style={{ ...tagBadgeStyle, color: "rgba(99,102,241,0.85)" }}>DYL</span>
                      ) : null}
                      <span style={{ ...tagBadgeStyle, color: tensionColor(shot.tensionLevel) }}>
                        T{shot.tensionLevel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleSection>
          ))}
        </div>
      </ProCard>
    </>
  );
}

function ScenarioHistoryPanel(props: {
  entries: ScenarioHistoryEntry[];
  isLoading: boolean;
  error: string | null;
  onRestore: (entry: ScenarioHistoryEntry) => void;
}) {
  return (
    <ProCard
      title="Senaryo Gecmisi"
      subtitle="Son olusturulan senaryolari tekrar acabilir ve ayni plan uzerinden devam edebilirsin"
      headerRight={<History size={16} style={{ color: "var(--text-tertiary)" }} />}
    >
      <div style={{ display: "grid", gap: 10 }}>
        {props.isLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
            <Loader2 size={14} className="animate-spin" />
            Senaryo gecmisi yukleniyor...
          </div>
        ) : null}

        {props.error ? (
          <div style={warningBannerStyle}>
            <AlertTriangle size={14} />
            <span style={{ whiteSpace: "pre-wrap" }}>{props.error}</span>
          </div>
        ) : null}

        {!props.isLoading && props.entries.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            Bu proje icin kayitli senaryo gecmisi henuz yok.
          </div>
        ) : null}

        {props.entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: "grid",
              gap: 10,
              padding: "14px 16px",
              borderRadius: 14,
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-elevated)",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <StatusDot
                  status={getScenarioStatusTone(entry.status)}
                  label={formatScenarioStatus(entry.status)}
                />
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  {formatScenarioDate(entry.updatedAt)}
                </span>
              </div>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => props.onRestore(entry)}
                style={{ fontSize: 12, minHeight: 32 }}
              >
                <FileText size={14} />
                Yukle
              </button>
            </div>

            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {getScenarioExcerpt(entry.scenarioText)}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={historyMetaBadgeStyle}>
                Video: {entry.targetModel}
                {entry.klingPreset ? ` · ${entry.klingPreset}` : ""}
              </span>
              <span style={historyMetaBadgeStyle}>
                LLM: {entry.llmModel}
              </span>
              {entry.totalMainShots !== null ? (
                <span style={historyMetaBadgeStyle}>
                  {entry.totalMainShots} ana / {entry.totalCoverageShots ?? 0} coverage
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </ProCard>
  );
}

function GenerationFailureCard(props: {
  error: string;
  log: GenerationLogEntry[];
}) {
  const lastEntries = props.log.slice(-8);

  return (
    <ProCard title="Son Uretim Hatasi" subtitle="Ajan son adimlarda burada takildi">
      <div style={{ display: "grid", gap: 12 }}>
        <div style={errorBannerStyle}>
          <AlertTriangle size={14} />
          <span style={{ whiteSpace: "pre-wrap" }}>{props.error}</span>
        </div>
        <div style={{
          display: "grid",
          gap: 6,
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-elevated)",
        }}>
          {lastEntries.map((entry) => (
            <div key={`${entry.timestamp}:${entry.message}`} style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text-primary)" }}>
                PASS {entry.pass}
                {entry.shotNumber ? ` · ${entry.shotNumber}` : ""}
              </strong>
              {" — "}
              {entry.message}
            </div>
          ))}
        </div>
      </div>
    </ProCard>
  );
}

// ─── Generating View Sub-component ──────────────────────────────────────

const PASS_LABELS: Record<number, string> = {
  1: "Sahne Analizi",
  2: "Shot Generator",
  3: "Continuity Editor",
  4: "Delivery Contract",
  5: "Packaging",
};

function GeneratingView(props: {
  progress: import("@/lib/scenario-types").GenerationProgress | null;
  log: GenerationLogEntry[];
  completedShots: string[];
  plan: ShotPlan | null;
  onCancel: () => void;
}) {
  const { progress, log, completedShots, plan } = props;
  const currentPass = progress?.currentPass ?? 2;
  const totalPlanned = (plan?.totalMainShots ?? 0) + (plan?.totalCoverageShots ?? 0);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Pass Timeline */}
      <ProCard title="Uretim Durumu" subtitle={progress ? `${progress.percent}% tamamlandi` : "Baslaniyor..."}>
        <div style={{ display: "grid", gap: 16 }}>
          {/* Overall progress bar */}
          <div style={progressBarContainerStyle}>
            <div style={{ ...progressBarFillStyle, width: `${progress?.percent ?? 0}%` }} />
          </div>

          {/* Pass steps */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[2, 3, 4, 5].map((passNum) => {
              const isDone = currentPass > passNum;
              const isActive = currentPass === passNum;
              return (
                <div
                  key={passNum}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${isActive ? "rgba(99,102,241,0.4)" : "var(--border-subtle)"}`,
                    background: isDone ? "rgba(34,197,94,0.06)" : isActive ? "rgba(99,102,241,0.06)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    {isDone ? (
                      <CheckCircle2 size={13} style={{ color: "var(--status-success)" }} />
                    ) : isActive ? (
                      <Loader2 size={13} className="animate-spin" style={{ color: "rgba(99,102,241,0.8)" }} />
                    ) : (
                      <div style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid var(--border-subtle)" }} />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? "var(--text-primary)" : "var(--text-tertiary)", letterSpacing: "0.03em" }}>
                      PASS {passNum}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: isActive ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                    {PASS_LABELS[passNum]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Current action */}
          {progress?.passLabel ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Loader2 size={14} className="animate-spin" style={{ color: "rgba(99,102,241,0.7)", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {progress.passLabel}
                {progress.shotNumber ? ` — ${progress.shotNumber}` : ""}
              </span>
            </div>
          ) : null}

          <button className="btn-secondary" onClick={props.onCancel} type="button" style={{ justifySelf: "start", fontSize: 12 }}>
            Iptal Et
          </button>
        </div>
      </ProCard>

      {/* Completed shots */}
      {completedShots.length > 0 ? (
        <ProCard
          title={`Tamamlanan Shot'lar (${completedShots.length}/${totalPlanned})`}
          subtitle="Uretilen shot'lar storyboard'a yazilacak"
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {completedShots.map((sn) => (
              <span
                key={sn}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  background: "rgba(34,197,94,0.08)",
                  color: "var(--status-success)",
                  border: "1px solid rgba(34,197,94,0.15)",
                }}
              >
                <CheckCircle2 size={11} />
                {sn}
              </span>
            ))}
          </div>
        </ProCard>
      ) : null}

      {/* Live log */}
      {log.length > 0 ? (
        <CollapsibleSection title={`Uretim Logu (${log.length} kayit)`}>
          <div style={{ maxHeight: 280, overflowY: "auto", display: "grid", gap: 2 }}>
            {log.slice().reverse().map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 0",
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ flexShrink: 0, fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
                  {new Date(entry.timestamp).toLocaleTimeString("tr-TR")}
                </span>
                <span style={{ flexShrink: 0, fontWeight: 700, color: "rgba(99,102,241,0.7)" }}>
                  P{entry.pass}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{entry.message}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

function tensionColor(level: number): string {
  if (level >= 5) return "var(--status-error)";
  if (level >= 4) return "rgba(245,158,11,0.85)";
  if (level >= 3) return "rgba(234,179,8,0.85)";
  return "var(--text-tertiary)";
}

function shotTypeBadgeStyle(type: string): CSSProperties {
  return {
    display: "inline-flex",
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    background: type === "main" ? "rgba(99,102,241,0.15)" : "rgba(156,163,175,0.12)",
    color: type === "main" ? "rgba(99,102,241,0.9)" : "var(--text-tertiary)",
  };
}

const tagBadgeStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.04em",
};

// ─── Styles ─────────────────────────────────────────────────────────────

const screenStyle: CSSProperties = {
  display: "grid",
  gap: 20,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  resize: "vertical",
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "var(--surface-card)",
  padding: "16px 18px",
  font: "inherit",
  fontSize: 14,
  lineHeight: 1.8,
  color: "var(--text-primary)",
};

const scenarioSelectStyle: CSSProperties = {
  width: "100%",
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid var(--border-default)",
  background: "var(--surface-card)",
  color: "var(--text-primary)",
  padding: "10px 12px",
  font: "inherit",
  fontSize: 13,
};

const modelPickerGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const modelFilterFieldStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const modelFilterLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const modelSearchWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 42,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid var(--border-default)",
  background: "var(--surface-card)",
};

const modelSearchInputStyle: CSSProperties = {
  flex: 1,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--text-primary)",
  font: "inherit",
  fontSize: 13,
};

const modelMetaRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

const selectedModelCardStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "14px 16px",
  borderRadius: 16,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--surface-card) 88%, rgba(99,102,241,0.18)), var(--surface-card))",
};

const metricsGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};

const progressBarContainerStyle: CSSProperties = {
  height: 8,
  borderRadius: 4,
  background: "var(--surface-hover)",
  overflow: "hidden",
};

const progressBarFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 4,
  background: "rgba(99,102,241,0.8)",
  transition: "width 300ms ease",
};

const errorBannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(239,68,68,0.3)",
  background: "rgba(239,68,68,0.08)",
  fontSize: 13,
  color: "var(--status-error)",
};

const warningBannerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(245,158,11,0.25)",
  background: "rgba(245,158,11,0.08)",
  fontSize: 12,
  color: "rgba(245,158,11,0.95)",
};

const historyMetaBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  fontSize: 11,
  color: "var(--text-secondary)",
  background: "var(--surface-hover)",
  border: "1px solid var(--border-subtle)",
};
