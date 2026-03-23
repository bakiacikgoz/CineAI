import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CopyPlus,
  Crown,
  Images,
  Layers,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import {
  buildCharacterGenerationPrompt,
  buildCharacterPromptHint,
  type CharacterLookAttributes,
  type CharacterProfile,
} from "@/lib/character-studio";
import type { AssetWithTags } from "@/services/asset.service";

/* ═══════════════════════════════════════════════════════════════
   Shared Types & Constants
   ═══════════════════════════════════════════════════════════════ */

export type StudioLookDraft = {
  id: string;
  name: string;
  attributes: CharacterLookAttributes;
  generationPrompt: string;
  promptLocked: boolean;
  refImages: string[];
  primaryImage: string | null;
};

export type CharacterStudioDraft = {
  id: string | null;
  name: string;
  description: string;
  klingElementId: string;
  profile: CharacterProfile;
  looks: StudioLookDraft[];
  defaultLookId: string | null;
};

export type CandidateAsset = AssetWithTags & { assetUrl: string };

export const CANDIDATE_ASPECT_RATIOS = ["3:4", "1:1", "4:5"] as const;

export function toProjectAssetUrl(
  projectFolderPath: string,
  relativePath: string | null,
): string | null {
  if (!relativePath) return null;
  const base = projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "");
  const rel = relativePath.replace(/\\/g, "/").replace(/^\//, "");
  return convertFileSrc(`${base}/${rel}`);
}

/* ═══════════════════════════════════════════════════════════════
   Tab System
   ═══════════════════════════════════════════════════════════════ */

type TabId = "profile" | "looks" | "generation";

const TABS: { id: TabId; label: string; icon: typeof UserRound }[] = [
  { id: "profile", label: "Profil", icon: UserRound },
  { id: "looks", label: "Looks", icon: Layers },
  { id: "generation", label: "Uretim", icon: Sparkles },
];

/* ═══════════════════════════════════════════════════════════════
   Props
   ═══════════════════════════════════════════════════════════════ */

interface CharacterStudioModalProps {
  draft: CharacterStudioDraft;
  activeLook: StudioLookDraft | null;
  activeLookId: string | null;
  projectFolderPath: string;
  saving: boolean;
  generatingCandidates: boolean;
  candidateLoading: boolean;
  candidateAssets: CandidateAsset[];
  candidateAspectRatio: (typeof CANDIDATE_ASPECT_RATIOS)[number];
  candidateQuantity: number;
  queueJobs: number;
  activeTab: TabId;
  onClose: () => void;
  onActiveTabChange: (value: TabId) => void;
  onTextChange: (key: "name" | "description" | "klingElementId", value: string) => void;
  onProfileFieldChange: <K extends keyof CharacterProfile>(key: K, value: CharacterProfile[K]) => void;
  onLookFieldChange: <K extends keyof CharacterLookAttributes>(key: K, value: CharacterLookAttributes[K]) => void;
  onLookNameChange: (value: string) => void;
  onLookSelect: (lookId: string) => void;
  onAddLook: () => void;
  onDuplicateLook: () => void;
  onRemoveLook: () => void;
  onDefaultLookChange: (lookId: string) => void;
  onPromptChange: (value: string) => void;
  onPromptReset: () => void;
  onImportReferences: () => void;
  onMoveReference: (refImage: string, direction: -1 | 1) => void;
  onRemoveReference: (refImage: string) => void;
  onReferencePrimaryChange: (relativePath: string) => void;
  onGenerateCandidates: () => void;
  onUseCandidate: (asset: CandidateAsset, makePrimary: boolean) => void;
  onDiscardCandidate: (asset: CandidateAsset) => void;
  onCandidateAspectRatioChange: (value: (typeof CANDIDATE_ASPECT_RATIOS)[number]) => void;
  onCandidateQuantityChange: (value: number) => void;
  onSave: () => void;
}

/* ═══════════════════════════════════════════════════════════════
   Micro-Components
   ═══════════════════════════════════════════════════════════════ */

function FormField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const filled = value.trim().length > 0;

  return (
    <div style={{ display: "grid", gap: 5 }}>
      <label style={fieldLabelStyle}>
        {label}
        {filled && <span style={filledDotStyle} />}
      </label>
      {multiline ? (
        <textarea
          className="studio-field"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows ?? 3}
          style={textareaStyle}
          value={value}
        />
      ) : (
        <input
          className="studio-field"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
          value={value}
        />
      )}
    </div>
  );
}

function FieldGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section style={groupStyle}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={groupHeaderStyle}
        type="button"
      >
        <span style={groupTitleStyle}>{title}</span>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2 }}
          style={{ display: "inline-flex", color: "var(--text-muted)" }}
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "grid", gap: 14, paddingTop: 14 }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function CharacterPreview({
  draft,
  activeLook,
  projectFolderPath,
}: {
  draft: CharacterStudioDraft;
  activeLook: StudioLookDraft | null;
  projectFolderPath: string;
}) {
  const primaryUrl = toProjectAssetUrl(
    projectFolderPath,
    activeLook?.primaryImage ?? activeLook?.refImages[0] ?? null,
  );
  const name = draft.name.trim() || "Yeni Karakter";
  const subtitle = [draft.profile.role, draft.profile.perceivedAge]
    .filter(Boolean)
    .join(" \u00b7 ");
  const totalRefs = draft.looks.reduce((sum, look) => sum + look.refImages.length, 0);
  const promptHint = activeLook
    ? buildCharacterPromptHint(draft.name, draft.profile, activeLook.attributes)
    : "";

  return (
    <div style={previewCardStyle}>
      <div style={previewAvatarWrapStyle}>
        {primaryUrl ? (
          <img alt={name} src={primaryUrl} style={previewImageStyle} />
        ) : (
          <div style={previewPlaceholderStyle}>
            <div style={previewInitialStyle}>
              {draft.name.trim() ? draft.name.trim()[0].toUpperCase() : "?"}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "14px 16px 18px", display: "grid", gap: 14 }}>
        <div>
          <div style={previewNameStyle}>{name}</div>
          {subtitle && <div style={previewSubtitleStyle}>{subtitle}</div>}
        </div>

        <div style={previewDividerStyle} />

        <div style={{ display: "grid", gap: 8 }}>
          <PreviewStat label="Look varyanti" value={String(draft.looks.length)} />
          <PreviewStat label="Referans gorsel" value={String(totalRefs)} />
          {draft.klingElementId.trim() && (
            <PreviewStat label="Kling Element" value={draft.klingElementId.trim()} />
          )}
        </div>

        {promptHint && (
          <>
            <div style={previewDividerStyle} />
            <div style={previewHintStyle}>
              {promptHint.length > 200 ? `${promptHint.slice(0, 200)}\u2026` : promptHint}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Profile Tab
   ═══════════════════════════════════════════════════════════════ */

function ProfileTab({
  draft,
  onTextChange,
  onProfileFieldChange,
}: {
  draft: CharacterStudioDraft;
  onTextChange: CharacterStudioModalProps["onTextChange"];
  onProfileFieldChange: CharacterStudioModalProps["onProfileFieldChange"];
}) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <FieldGroup title="Kimlik" defaultOpen>
        <FormField label="Karakter adi" value={draft.name} onChange={(v) => onTextChange("name", v)} placeholder="Ana karakter adi" />
        <FormField label="Kisa aciklama" value={draft.description} onChange={(v) => onTextChange("description", v)} placeholder="Tek satirlik tanim" />
        <FormField label="Kling Element ID" value={draft.klingElementId} onChange={(v) => onTextChange("klingElementId", v)} placeholder="Opsiyonel" />
        <div style={fieldGridStyle}>
          <FormField label="Rol / archetype" value={draft.profile.role} onChange={(v) => onProfileFieldChange("role", v)} placeholder="Orn: yasli bilge" />
          <FormField label="Yas algisi" value={draft.profile.perceivedAge} onChange={(v) => onProfileFieldChange("perceivedAge", v)} placeholder="Orn: 35" />
          <FormField label="Cinsiyet ifadesi" value={draft.profile.genderExpression} onChange={(v) => onProfileFieldChange("genderExpression", v)} placeholder="Orn: erkek" />
          <FormField label="Etnik koken" value={draft.profile.ethnicity} onChange={(v) => onProfileFieldChange("ethnicity", v)} placeholder="Orn: Arap" />
        </div>
      </FieldGroup>

      <FieldGroup title="Fiziksel Ozellikler">
        <div style={fieldGridStyle}>
          <FormField label="Ten tonu" value={draft.profile.skinTone} onChange={(v) => onProfileFieldChange("skinTone", v)} placeholder="Orn: olive" />
          <FormField label="Beden tipi" value={draft.profile.bodyType} onChange={(v) => onProfileFieldChange("bodyType", v)} placeholder="Orn: atletik" />
          <FormField label="Yuz yapisi" value={draft.profile.faceShape} onChange={(v) => onProfileFieldChange("faceShape", v)} placeholder="Orn: oval" />
          <FormField label="Goz detaylari" value={draft.profile.eyeDetails} onChange={(v) => onProfileFieldChange("eyeDetails", v)} placeholder="Orn: kahverengi, derin" />
        </div>
      </FieldGroup>

      <FieldGroup title="Sac & Isaretler">
        <div style={fieldGridStyle}>
          <FormField label="Sac stili" value={draft.profile.hairStyle} onChange={(v) => onProfileFieldChange("hairStyle", v)} placeholder="Orn: kisa, daginik" />
          <FormField label="Sac rengi" value={draft.profile.hairColor} onChange={(v) => onProfileFieldChange("hairColor", v)} placeholder="Orn: koyu kahve" />
          <FormField label="Sakal / biyik" value={draft.profile.facialHair} onChange={(v) => onProfileFieldChange("facialHair", v)} placeholder="Orn: kisa sakal" />
          <FormField label="Iz / ben / tattoo" value={draft.profile.marks} onChange={(v) => onProfileFieldChange("marks", v)} placeholder="Opsiyonel" />
        </div>
        <FormField label="Posture / body language" value={draft.profile.posture} onChange={(v) => onProfileFieldChange("posture", v)} placeholder="Opsiyonel" />
      </FieldGroup>

      <FieldGroup title="Notlar">
        <FormField label="Continuity kurallari" value={draft.profile.continuityNotes} onChange={(v) => onProfileFieldChange("continuityNotes", v)} multiline rows={3} placeholder="Shot'lar arasi tutarlilik notlari" />
        <FormField label="Avoid list" value={draft.profile.avoidList} onChange={(v) => onProfileFieldChange("avoidList", v)} multiline rows={2} placeholder="Uretimde kacinilacak unsurlar" />
        <FormField label="Global notlar" value={draft.profile.globalNotes} onChange={(v) => onProfileFieldChange("globalNotes", v)} multiline rows={3} placeholder="Genel stil ve ton notlari" />
      </FieldGroup>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Looks Tab
   ═══════════════════════════════════════════════════════════════ */

function LooksTab({
  draft,
  activeLook,
  activeLookId,
  onLookSelect,
  onAddLook,
  onDuplicateLook,
  onRemoveLook,
  onLookNameChange,
  onDefaultLookChange,
  onLookFieldChange,
}: {
  draft: CharacterStudioDraft;
  activeLook: StudioLookDraft | null;
  activeLookId: string | null;
  onLookSelect: (id: string) => void;
  onAddLook: () => void;
  onDuplicateLook: () => void;
  onRemoveLook: () => void;
  onLookNameChange: (value: string) => void;
  onDefaultLookChange: (lookId: string) => void;
  onLookFieldChange: CharacterStudioModalProps["onLookFieldChange"];
}) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Look selector */}
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
          {draft.looks.map((look) => {
            const isActive = look.id === activeLookId;
            const isDefault = look.id === draft.defaultLookId;
            return (
              <motion.button
                key={look.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onLookSelect(look.id)}
                style={lookCardStyle(isActive)}
                type="button"
              >
                <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400 }}>
                  {look.name}
                </span>
                {isDefault && (
                  <span style={defaultBadgeStyle}>
                    <Star size={9} />
                    default
                  </span>
                )}
              </motion.button>
            );
          })}
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            onClick={onAddLook}
            style={addLookBtnStyle}
            type="button"
          >
            <Plus size={15} />
          </motion.button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={onDuplicateLook} type="button">
            <CopyPlus size={14} />
            Kopyala
          </button>
          <button className="btn-secondary" onClick={onRemoveLook} type="button">
            <Trash2 size={14} />
            Look sil
          </button>
        </div>
      </div>

      {activeLook && (
        <>
          <FieldGroup title="Look Detaylari" defaultOpen>
            <FormField
              label="Look adi"
              value={activeLook.name}
              onChange={onLookNameChange}
              placeholder="Look varyant adi"
            />
            <label style={toggleStyle}>
              <input
                checked={draft.defaultLookId === activeLook.id}
                onChange={() => onDefaultLookChange(activeLook.id)}
                type="checkbox"
              />
              <span>Default look olarak belirle</span>
            </label>
          </FieldGroup>

          <FieldGroup title="Kostum & Stil">
            <div style={fieldGridStyle}>
              <FormField label="Kostum / kiyafet" value={activeLook.attributes.wardrobe} onChange={(v) => onLookFieldChange("wardrobe", v)} placeholder="Kiyafet detaylari" />
              <FormField label="Renk paleti" value={activeLook.attributes.palette} onChange={(v) => onLookFieldChange("palette", v)} placeholder="Baskin renkler" />
              <FormField label="Materyal / doku" value={activeLook.attributes.materials} onChange={(v) => onLookFieldChange("materials", v)} placeholder="Kumas, doku" />
              <FormField label="Aksesuarlar" value={activeLook.attributes.accessories} onChange={(v) => onLookFieldChange("accessories", v)} placeholder="Taki, sapka vs." />
            </div>
          </FieldGroup>

          <FieldGroup title="Override & Mood">
            <div style={fieldGridStyle}>
              <FormField label="Sac override" value={activeLook.attributes.hairOverride} onChange={(v) => onLookFieldChange("hairOverride", v)} placeholder="Bu look'a ozel sac" />
              <FormField label="Makyaj override" value={activeLook.attributes.makeupOverride} onChange={(v) => onLookFieldChange("makeupOverride", v)} placeholder="Grooming detaylari" />
              <FormField label="Mood / enerji" value={activeLook.attributes.mood} onChange={(v) => onLookFieldChange("mood", v)} placeholder="Karakter enerjisi" />
              <FormField label="Sahne baglami" value={activeLook.attributes.sceneContext} onChange={(v) => onLookFieldChange("sceneContext", v)} placeholder="Mekan, zaman" />
            </div>
          </FieldGroup>

          <FormField
            label="Look continuity notlari"
            value={activeLook.attributes.continuityNotes}
            onChange={(v) => onLookFieldChange("continuityNotes", v)}
            multiline
            rows={3}
            placeholder="Bu look icin tutarlilik notlari"
          />
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Generation Tab
   ═══════════════════════════════════════════════════════════════ */

function GenerationTab({
  draft,
  activeLook,
  projectFolderPath,
  candidateAssets,
  candidateLoading,
  candidateAspectRatio,
  candidateQuantity,
  queueJobs,
  generatingCandidates,
  saving,
  onPromptChange,
  onPromptReset,
  onImportReferences,
  onMoveReference,
  onRemoveReference,
  onReferencePrimaryChange,
  onGenerateCandidates,
  onUseCandidate,
  onDiscardCandidate,
  onCandidateAspectRatioChange,
  onCandidateQuantityChange,
}: {
  draft: CharacterStudioDraft;
  activeLook: StudioLookDraft | null;
  projectFolderPath: string;
  candidateAssets: CandidateAsset[];
  candidateLoading: boolean;
  candidateAspectRatio: (typeof CANDIDATE_ASPECT_RATIOS)[number];
  candidateQuantity: number;
  queueJobs: number;
  generatingCandidates: boolean;
  saving: boolean;
  onPromptChange: (v: string) => void;
  onPromptReset: () => void;
  onImportReferences: () => void;
  onMoveReference: (ref: string, dir: -1 | 1) => void;
  onRemoveReference: (ref: string) => void;
  onReferencePrimaryChange: (path: string) => void;
  onGenerateCandidates: () => void;
  onUseCandidate: (asset: CandidateAsset, primary: boolean) => void;
  onDiscardCandidate: (asset: CandidateAsset) => void;
  onCandidateAspectRatioChange: (v: (typeof CANDIDATE_ASPECT_RATIOS)[number]) => void;
  onCandidateQuantityChange: (v: number) => void;
}) {
  const computedPrompt = activeLook
    ? buildCharacterGenerationPrompt(draft.name, draft.profile, activeLook.attributes)
    : "";
  const promptValue = activeLook?.promptLocked ? activeLook.generationPrompt : computedPrompt;
  const promptHint = activeLook
    ? buildCharacterPromptHint(draft.name, draft.profile, activeLook.attributes)
    : "";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Prompt */}
      <FieldGroup title="Generation Prompt" defaultOpen>
        <div style={hintBoxStyle}>
          <WandSparkles size={14} style={{ flexShrink: 0, color: "var(--accent)" }} />
          <span style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            {promptHint || "Profil alanlari dolduruldukca prompt hint otomatik olusur."}
          </span>
        </div>
        <FormField
          label="Full Generation Prompt"
          value={promptValue}
          onChange={onPromptChange}
          multiline
          rows={6}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={onPromptReset} type="button">
            Alanlardan sifirla
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {activeLook?.promptLocked
              ? "Manuel override aktif"
              : "Alanlardan otomatik uretiliyor"}
          </span>
        </div>
      </FieldGroup>

      {/* References */}
      <FieldGroup title="Referanslar" defaultOpen>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Look referans gorselleri
          </span>
          <button className="btn-secondary" onClick={onImportReferences} type="button">
            <Images size={14} />
            Gorsel ekle
          </button>
        </div>

        {!activeLook || activeLook.refImages.length === 0 ? (
          <div style={emptyBoxStyle}>Henuz referans eklenmedi.</div>
        ) : (
          <div style={refGridStyle}>
            {activeLook.refImages.map((refImage) => {
              const url = toProjectAssetUrl(projectFolderPath, refImage);
              const idx = activeLook.refImages.indexOf(refImage);
              const isPrimary = activeLook.primaryImage === refImage;

              return (
                <motion.div
                  key={refImage}
                  whileHover={{ scale: 1.03 }}
                  transition={{ duration: 0.15 }}
                  style={refCardStyle(isPrimary)}
                >
                  {url && <img alt="ref" src={url} style={refImgStyle} />}
                  {isPrimary && (
                    <div style={primaryLabelStyle}>
                      <Crown size={10} />
                      Primary
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 4, padding: "0 6px 6px" }}>
                    {!isPrimary && (
                      <button className="icon-button" onClick={() => onReferencePrimaryChange(refImage)} style={tinyBtnStyle} title="Set primary" type="button">
                        <Star size={12} />
                      </button>
                    )}
                    <button className="icon-button" disabled={idx === 0} onClick={() => onMoveReference(refImage, -1)} style={tinyBtnStyle} type="button">
                      <ArrowLeft size={12} />
                    </button>
                    <button className="icon-button" disabled={idx === activeLook.refImages.length - 1} onClick={() => onMoveReference(refImage, 1)} style={tinyBtnStyle} type="button">
                      <ArrowRight size={12} />
                    </button>
                    <button className="icon-button" onClick={() => onRemoveReference(refImage)} style={{ ...tinyBtnStyle, marginLeft: "auto" }} type="button">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </FieldGroup>

      {/* Candidates */}
      <FieldGroup title="Candidate Galeri" defaultOpen>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="studio-field"
            onChange={(e) =>
              onCandidateAspectRatioChange(
                e.target.value as (typeof CANDIDATE_ASPECT_RATIOS)[number],
              )
            }
            style={{ ...inputStyle, width: "auto", minWidth: 88 }}
            value={candidateAspectRatio}
          >
            {CANDIDATE_ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>

          <div style={stepperWrapStyle}>
            <button
              onClick={() => onCandidateQuantityChange(Math.max(1, candidateQuantity - 1))}
              style={stepperBtnStyle}
              type="button"
            >
              &minus;
            </button>
            <span style={{ minWidth: 24, textAlign: "center", fontWeight: 700, fontSize: 13 }}>
              {candidateQuantity}
            </span>
            <button
              onClick={() => onCandidateQuantityChange(Math.min(6, candidateQuantity + 1))}
              style={stepperBtnStyle}
              type="button"
            >
              +
            </button>
          </div>

          <button
            className="btn-primary"
            disabled={generatingCandidates || saving}
            onClick={onGenerateCandidates}
            type="button"
          >
            <Sparkles size={14} />
            {generatingCandidates ? "Kuyrukta..." : "NB2 Candidate Uret"}
          </button>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {queueJobs > 0
            ? `${queueJobs} aktif candidate isi var.`
            : "Kaydedilmemis taslakta generate denersen karakter once otomatik kaydedilir."}
        </div>

        {candidateLoading ? (
          <div style={emptyBoxStyle}>Candidate galeri yukleniyor...</div>
        ) : candidateAssets.length === 0 && queueJobs === 0 ? (
          <div style={emptyBoxStyle}>Henuz candidate uretilmedi.</div>
        ) : (
          <div style={candidateGridStyle}>
            {candidateAssets.map((asset) => {
              const used = activeLook?.refImages.includes(asset.file_path) ?? false;
              return (
                <motion.div
                  key={asset.id}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.15 }}
                  style={candidateCardStyle}
                >
                  <img alt={asset.filename} src={asset.assetUrl} style={candidateImgStyle} />
                  <div style={{ display: "grid", gap: 6, padding: "8px 10px 10px" }}>
                    <div style={candidateFilenameStyle}>{asset.filename}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn-secondary" onClick={() => onUseCandidate(asset, false)} style={candidateActionBtnStyle} type="button">
                        +Ref
                      </button>
                      <button className="btn-secondary" onClick={() => onUseCandidate(asset, true)} style={candidateActionBtnStyle} type="button">
                        <Star size={10} /> Primary
                      </button>
                      <button className="btn-secondary" disabled={used} onClick={() => onDiscardCandidate(asset)} style={candidateActionBtnStyle} type="button">
                        Sil
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </FieldGroup>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Modal
   ═══════════════════════════════════════════════════════════════ */

export function CharacterStudioModal(props: CharacterStudioModalProps) {
  const {
    draft,
    activeLook,
    activeLookId,
    projectFolderPath,
    activeTab,
    saving,
    generatingCandidates,
    candidateAssets,
    candidateLoading,
    candidateAspectRatio,
    candidateQuantity,
    queueJobs,
    onClose,
    onActiveTabChange,
    onTextChange,
    onProfileFieldChange,
    onLookFieldChange,
    onLookNameChange,
    onLookSelect,
    onAddLook,
    onDuplicateLook,
    onRemoveLook,
    onDefaultLookChange,
    onPromptChange,
    onPromptReset,
    onImportReferences,
    onMoveReference,
    onRemoveReference,
    onReferencePrimaryChange,
    onGenerateCandidates,
    onUseCandidate,
    onDiscardCandidate,
    onCandidateAspectRatioChange,
    onCandidateQuantityChange,
    onSave,
  } = props;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={backdropStyle}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={headerBadgeStyle}>
              <Sparkles size={12} />
              <span>CHARACTER STUDIO</span>
            </div>
            <span style={headerTitleStyle}>
              {draft.id ? draft.name || "Karakter Studio" : "Yeni Karakter"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              className="btn-secondary"
              disabled={saving || generatingCandidates}
              onClick={onClose}
              type="button"
            >
              Taslagi Gizle
            </button>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={onSave}
              type="button"
            >
              {saving ? "Kaydediliyor\u2026" : "Karakteri Kaydet"}
            </button>
          </div>
        </div>

        {/* ── Body: Sidebar + Tabbed Content ─────────────── */}
        <div style={bodyStyle}>
          {/* Left: Character preview */}
          <aside style={sidebarStyle}>
            <CharacterPreview
              activeLook={activeLook}
              draft={draft}
              projectFolderPath={projectFolderPath}
            />
          </aside>

          {/* Right: Content */}
          <div style={contentAreaStyle}>
            {/* Tab bar */}
            <nav style={tabBarStyle}>
              {TABS.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onActiveTabChange(tab.id)}
                    style={tabBtnStyle(isActive)}
                    type="button"
                  >
                    <tab.icon size={14} />
                    {tab.label}
                    {isActive && (
                      <motion.div
                        layoutId="studio-tab-indicator"
                        style={tabIndicatorStyle}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Tab content */}
            <div style={{ padding: 22, flex: 1, minHeight: 0 }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15 }}
                >
                  {activeTab === "profile" && (
                    <ProfileTab
                      draft={draft}
                      onProfileFieldChange={onProfileFieldChange}
                      onTextChange={onTextChange}
                    />
                  )}
                  {activeTab === "looks" && (
                    <LooksTab
                      activeLook={activeLook}
                      activeLookId={activeLookId}
                      draft={draft}
                      onAddLook={onAddLook}
                      onDefaultLookChange={onDefaultLookChange}
                      onDuplicateLook={onDuplicateLook}
                      onLookFieldChange={onLookFieldChange}
                      onLookNameChange={onLookNameChange}
                      onLookSelect={onLookSelect}
                      onRemoveLook={onRemoveLook}
                    />
                  )}
                  {activeTab === "generation" && (
                    <GenerationTab
                      activeLook={activeLook}
                      candidateAssets={candidateAssets}
                      candidateAspectRatio={candidateAspectRatio}
                      candidateLoading={candidateLoading}
                      candidateQuantity={candidateQuantity}
                      draft={draft}
                      generatingCandidates={generatingCandidates}
                      onCandidateAspectRatioChange={onCandidateAspectRatioChange}
                      onCandidateQuantityChange={onCandidateQuantityChange}
                      onDiscardCandidate={onDiscardCandidate}
                      onGenerateCandidates={onGenerateCandidates}
                      onImportReferences={onImportReferences}
                      onMoveReference={onMoveReference}
                      onPromptChange={onPromptChange}
                      onPromptReset={onPromptReset}
                      onReferencePrimaryChange={onReferencePrimaryChange}
                      onRemoveReference={onRemoveReference}
                      onUseCandidate={onUseCandidate}
                      projectFolderPath={projectFolderPath}
                      queueJobs={queueJobs}
                      saving={saving}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════════════════════════ */

const backdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 240,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(0, 0, 0, 0.78)",
  backdropFilter: "blur(14px)",
} satisfies React.CSSProperties;

const panelStyle = {
  width: "min(1440px, 100%)",
  maxHeight: "calc(100vh - 40px)",
  display: "flex",
  flexDirection: "column",
  borderRadius: 24,
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
  boxShadow:
    "0 40px 120px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
  overflow: "hidden",
} satisfies React.CSSProperties;

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  padding: "14px 24px",
  borderBottom: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(180deg, rgba(245,158,11,0.04), transparent 70%)",
  flexShrink: 0,
} satisfies React.CSSProperties;

const headerBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid rgba(245,158,11,0.2)",
  background: "rgba(245,158,11,0.08)",
  color: "var(--accent)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
} satisfies React.CSSProperties;

const headerTitleStyle = {
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: "-0.03em",
} satisfies React.CSSProperties;

const bodyStyle = {
  display: "grid",
  gridTemplateColumns: "260px 1fr",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
} satisfies React.CSSProperties;

const sidebarStyle = {
  overflowY: "auto",
  borderRight: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(180deg, rgba(0,0,0,0.18), rgba(0,0,0,0.08))",
  padding: 14,
} satisfies React.CSSProperties;

const contentAreaStyle = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflowY: "auto",
} satisfies React.CSSProperties;

const tabBarStyle = {
  display: "flex",
  gap: 0,
  borderBottom: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
  position: "sticky",
  top: 0,
  zIndex: 10,
  flexShrink: 0,
} satisfies React.CSSProperties;

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 20px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    transition: "color 150ms ease",
  };
}

const tabIndicatorStyle = {
  position: "absolute",
  bottom: -1,
  left: 12,
  right: 12,
  height: 2,
  borderRadius: 1,
  background: "var(--accent)",
} satisfies React.CSSProperties;

/* ── Preview Card ────────────────────────────────────────── */

const previewCardStyle = {
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(180deg, var(--bg-elevated), var(--bg-surface))",
  overflow: "hidden",
} satisfies React.CSSProperties;

const previewAvatarWrapStyle = {
  position: "relative",
  width: "100%",
  aspectRatio: "3 / 4",
  overflow: "hidden",
  background:
    "linear-gradient(135deg, rgba(245,158,11,0.1), rgba(59,130,246,0.06) 70%)",
} satisfies React.CSSProperties;

const previewImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} satisfies React.CSSProperties;

const previewPlaceholderStyle = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
} satisfies React.CSSProperties;

const previewInitialStyle = {
  width: 56,
  height: 56,
  display: "grid",
  placeItems: "center",
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "rgba(255,255,255,0.04)",
  fontSize: 22,
  fontWeight: 700,
  color: "var(--text-muted)",
} satisfies React.CSSProperties;

const previewNameStyle = {
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: "-0.02em",
} satisfies React.CSSProperties;

const previewSubtitleStyle = {
  fontSize: 12,
  color: "var(--text-secondary)",
  marginTop: 3,
} satisfies React.CSSProperties;

const previewDividerStyle = {
  height: 1,
  background: "var(--border-subtle)",
} satisfies React.CSSProperties;

const previewHintStyle = {
  fontSize: 11,
  lineHeight: 1.6,
  color: "var(--text-muted)",
  fontStyle: "italic",
} satisfies React.CSSProperties;

/* ── Form ────────────────────────────────────────────────── */

const fieldLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 0,
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-muted)",
  letterSpacing: "0.02em",
} satisfies React.CSSProperties;

const filledDotStyle = {
  display: "inline-block",
  width: 4,
  height: 4,
  borderRadius: "50%",
  background: "var(--accent)",
  marginLeft: 6,
} satisfies React.CSSProperties;

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 13,
} satisfies React.CSSProperties;

const textareaStyle = {
  ...inputStyle,
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.65,
} satisfies React.CSSProperties;

const fieldGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
} satisfies React.CSSProperties;

const groupStyle = {
  padding: "16px 18px",
  borderRadius: 16,
  border: "1px solid var(--border-subtle)",
  background: "rgba(255,255,255,0.01)",
} satisfies React.CSSProperties;

const groupHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  padding: 0,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-secondary)",
} satisfies React.CSSProperties;

const groupTitleStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
} satisfies React.CSSProperties;

const toggleStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--text-secondary)",
  fontSize: 13,
  cursor: "pointer",
} satisfies React.CSSProperties;

/* ── Look Cards ──────────────────────────────────────────── */

function lookCardStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 12,
    border: `1px solid ${active ? "rgba(245,158,11,0.36)" : "var(--border-subtle)"}`,
    background: active ? "rgba(245,158,11,0.1)" : "var(--bg-elevated)",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: "pointer",
    transition: "border-color 150ms ease, background 150ms ease",
  };
}

const defaultBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 7px",
  borderRadius: 999,
  background: "rgba(245,158,11,0.12)",
  color: "var(--accent)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.02em",
} satisfies React.CSSProperties;

const addLookBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 42,
  borderRadius: 12,
  border: "1px dashed var(--border-default)",
  background: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
} satisfies React.CSSProperties;

/* ── Prompt & References ─────────────────────────────────── */

const hintBoxStyle = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(245,158,11,0.18)",
  background: "rgba(245,158,11,0.06)",
  lineHeight: 1.6,
} satisfies React.CSSProperties;

const emptyBoxStyle = {
  padding: "16px 18px",
  borderRadius: 12,
  border: "1px dashed var(--border-default)",
  color: "var(--text-muted)",
  background: "var(--bg-elevated)",
  fontSize: 12,
} satisfies React.CSSProperties;

const refGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
  gap: 10,
} satisfies React.CSSProperties;

function refCardStyle(isPrimary: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 6,
    padding: 6,
    borderRadius: 14,
    border: `1px solid ${isPrimary ? "rgba(245,158,11,0.32)" : "var(--border-subtle)"}`,
    background: isPrimary ? "rgba(245,158,11,0.06)" : "var(--bg-elevated)",
    overflow: "hidden",
  };
}

const refImgStyle = {
  width: "100%",
  height: 120,
  objectFit: "cover",
  display: "block",
  borderRadius: 10,
} satisfies React.CSSProperties;

const primaryLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--accent)",
} satisfies React.CSSProperties;

const tinyBtnStyle = {
  width: 28,
  height: 28,
  borderRadius: 8,
} satisfies React.CSSProperties;

/* ── Candidates ──────────────────────────────────────────── */

const stepperWrapStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const stepperBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1,
} satisfies React.CSSProperties;

const candidateGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))",
  gap: 12,
} satisfies React.CSSProperties;

const candidateCardStyle = {
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  overflow: "hidden",
  transition: "border-color 150ms ease, box-shadow 150ms ease",
} satisfies React.CSSProperties;

const candidateImgStyle = {
  width: "100%",
  aspectRatio: "4 / 5",
  objectFit: "cover",
  display: "block",
} satisfies React.CSSProperties;

const candidateFilenameStyle = {
  fontSize: 11,
  color: "var(--text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} satisfies React.CSSProperties;

const candidateActionBtnStyle = {
  padding: "5px 8px",
  fontSize: 11,
  minHeight: 28,
  gap: 4,
} satisfies React.CSSProperties;
