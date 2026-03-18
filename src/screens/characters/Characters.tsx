import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import { Images, Link2, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import {
  createCharacter,
  deleteCharacter,
  importCharacterReferenceFiles,
  listCharacters,
  updateCharacter,
  type CharacterRecord,
} from "@/services/character.service";
import {
  assignShotExternalReferencePath,
  getShots,
  type ShotRow,
} from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";

type CharacterEditorState = {
  id: string | null;
  name: string;
  description: string;
  klingElementId: string;
  styleNotes: string;
  refImages: string[];
  primaryImage: string | null;
};

const EMPTY_EDITOR: CharacterEditorState = {
  id: null,
  name: "",
  description: "",
  klingElementId: "",
  styleNotes: "",
  refImages: [],
  primaryImage: null,
};

export function Characters() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null);
  const [editor, setEditor] = useState<CharacterEditorState>(EMPTY_EDITOR);
  const [assignShotId, setAssignShotId] = useState("");

  const filteredCharacters = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return characters.filter((character) => {
      if (needle.length === 0) {
        return true;
      }

      return (
        character.name.toLowerCase().includes(needle) ||
        character.description?.toLowerCase().includes(needle) ||
        character.styleNotes?.toLowerCase().includes(needle)
      );
    });
  }, [characters, search]);

  useEffect(() => {
    if (!activeProject) {
      setCharacters([]);
      setShots([]);
      setLoading(false);
      return;
    }

    const project = activeProject;
    let cancelled = false;

    async function loadData() {
      setLoading(true);

      try {
        const [nextCharacters, nextShots] = await Promise.all([
          listCharacters(),
          getShots(project.id, { includeArchived: true }),
        ]);

        if (!cancelled) {
          setCharacters(nextCharacters);
          setShots(nextShots.filter((shot) => !shot.parentShotId));
        }
      } catch (error) {
        console.error("Failed to load characters", error);
        if (!cancelled) {
          await message(error instanceof Error ? error.message : "Karakterler yuklenemedi.", {
            title: "Characters",
            kind: "error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  async function refreshCharacters() {
    const nextCharacters = await listCharacters();
    setCharacters(nextCharacters);
  }

  function openCreateEditor() {
    setEditor(EMPTY_EDITOR);
    setShowEditor(true);
  }

  function openEditEditor(character: CharacterRecord) {
    setEditor({
      id: character.id,
      name: character.name,
      description: character.description ?? "",
      klingElementId: character.klingElementId ?? "",
      styleNotes: character.styleNotes ?? "",
      refImages: character.refImages,
      primaryImage: character.primaryImage,
    });
    setShowEditor(true);
  }

  async function handleImportReferences() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });

    if (!selected) {
      return;
    }

    const inputPaths = Array.isArray(selected) ? selected : [selected];
    const importedPaths = await importCharacterReferenceFiles(editor.name || "character", inputPaths);

    setEditor((current) => {
      const nextRefImages = Array.from(new Set([...current.refImages, ...importedPaths]));
      return {
        ...current,
        refImages: nextRefImages,
        primaryImage: current.primaryImage ?? nextRefImages[0] ?? null,
      };
    });
  }

  async function handleSave() {
    if (!editor.name.trim()) {
      await message("Karakter adi zorunludur.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    setSaving(true);

    try {
      if (editor.id) {
        await updateCharacter(editor.id, editor);
      } else {
        await createCharacter(editor);
      }

      await refreshCharacters();
      setShowEditor(false);
      setEditor(EMPTY_EDITOR);
    } catch (error) {
      console.error("Failed to save character", error);
      await message(error instanceof Error ? error.message : "Karakter kaydedilemedi.", {
        title: "Characters",
        kind: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(characterId: string) {
    const accepted = await confirm("Bu karakter kaydi silinecek. Devam edilsin mi?", {
      title: "Karakter sil",
      kind: "warning",
      okLabel: "Sil",
      cancelLabel: "Vazgec",
    });

    if (!accepted) {
      return;
    }

    try {
      await deleteCharacter(characterId);
      await refreshCharacters();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Karakter silinemedi.", {
        title: "Characters",
        kind: "error",
      });
    }
  }

  async function handleAssignReference() {
    if (!selectedCharacter?.primaryImage || !assignShotId) {
      return;
    }

    setAssigning(true);

    try {
      await assignShotExternalReferencePath(assignShotId, selectedCharacter.primaryImage);
      await message(`${selectedCharacter.name} referansi shot'a baglandi.`, {
        title: "Characters",
        kind: "info",
      });
      setShowAssignModal(false);
      setSelectedCharacter(null);
      setAssignShotId("");
    } catch (error) {
      await message(error instanceof Error ? error.message : "Referans atanamadi.", {
        title: "Characters",
        kind: "error",
      });
    } finally {
      setAssigning(false);
    }
  }

  if (!activeProject) {
    return <CharactersState title="Characters" copy="Karakter kutuphanesini yonetmek icin once bir proje ac." />;
  }

  return (
    <section className="screen-shell">
      <section style={{ display: "grid", gap: 18 }}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <UserRound size={13} />
              Continuity vault
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Characters
            </div>
            <p style={copyStyle}>
              Karakter referanslari, stil notlari ve storyboard referans atamalari bu merkezde yonetilir.
            </p>
          </div>

          <button className="btn-primary" onClick={openCreateEditor} type="button">
            <Plus size={15} />
            Yeni Karakter
          </button>
        </header>

        <section style={toolbarStyle}>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Karakter ara"
            style={searchInputStyle}
            value={search}
          />
          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
            {characters.length} karakter / {shots.length} ana shot
          </div>
        </section>

        {loading ? (
          <CharactersState title="Yukleniyor..." copy="Karakter kayitlari okunuyor." />
        ) : filteredCharacters.length === 0 ? (
          <CharactersState
            title={characters.length === 0 ? "Karakter kutuphanesi bos" : "Sonuc bulunamadi"}
            copy={
              characters.length === 0
                ? "Ilk karakter referanslarini ekleyerek storyboard continuity akisini guclendirebilirsin."
                : "Arama sonucunda karakter bulunamadi."
            }
          />
        ) : (
          <div style={gridStyle}>
            {filteredCharacters.map((character) => (
              <CharacterCard
                character={character}
                key={character.id}
                onAssign={() => {
                  setSelectedCharacter(character);
                  setAssignShotId(shots[0]?.id ?? "");
                  setShowAssignModal(true);
                }}
                onDelete={() => void handleDelete(character.id)}
                onEdit={() => openEditEditor(character)}
                projectFolderPath={activeProject.folderPath}
              />
            ))}
          </div>
        )}
      </section>

      {showEditor ? (
        <CharacterEditorModal
          editor={editor}
          onChange={setEditor}
          onClose={() => {
            if (!saving) {
              setShowEditor(false);
            }
          }}
          onImportReferences={() => void handleImportReferences()}
          onSave={() => void handleSave()}
          projectFolderPath={activeProject.folderPath}
          saving={saving}
        />
      ) : null}

      {showAssignModal && selectedCharacter ? (
        <AssignReferenceModal
          assigning={assigning}
          character={selectedCharacter}
          onAssign={() => void handleAssignReference()}
          onClose={() => {
            if (!assigning) {
              setShowAssignModal(false);
            }
          }}
          onShotChange={setAssignShotId}
          projectFolderPath={activeProject.folderPath}
          selectedShotId={assignShotId}
          shots={shots}
        />
      ) : null}
    </section>
  );
}

function CharacterCard({
  character,
  onEdit,
  onDelete,
  onAssign,
  projectFolderPath,
}: {
  character: CharacterRecord;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  projectFolderPath: string;
}) {
  const primaryUrl = character.primaryImage
    ? convertFileSrc(`${projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "")}/${character.primaryImage}`)
    : null;

  return (
    <article style={cardStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 16 }}>
        <div style={mediaStyle}>
          {primaryUrl ? (
            <img alt={character.name} src={primaryUrl} style={mediaImageStyle} />
          ) : (
            <UserRound size={34} style={{ color: "rgba(255,255,255,0.18)" }} />
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 18 }}>{character.name}</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {character.klingElementId ? <span style={mutedTagStyle}>{character.klingElementId}</span> : null}
                <span style={tagStyle}>{character.refImages.length} ref</span>
              </div>
            </div>
            <button className="icon-button" onClick={onEdit} type="button">
              <Pencil size={15} />
            </button>
          </div>

          <div style={textBlockStyle}>{character.description || character.styleNotes || "Karakter notu eklenmedi."}</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={onAssign} type="button">
              <Link2 size={14} />
              Shot referansi ata
            </button>
            <button className="btn-secondary" onClick={onDelete} type="button">
              <Trash2 size={14} />
              Sil
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function CharacterEditorModal({
  editor,
  onChange,
  onClose,
  onImportReferences,
  onSave,
  saving,
  projectFolderPath,
}: {
  editor: CharacterEditorState;
  onChange: (value: CharacterEditorState) => void;
  onClose: () => void;
  onImportReferences: () => void;
  onSave: () => void;
  saving: boolean;
  projectFolderPath: string;
}) {
  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={(event) => event.stopPropagation()} style={modalPanelStyle}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {editor.id ? "Karakter duzenle" : "Yeni karakter"}
          </div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Referans gorselleri proje klasorundeki `assets/characters` altina kopyalanir.
          </p>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            onChange={(event) => onChange({ ...editor, name: event.target.value })}
            placeholder="Karakter adi"
            style={formInputStyle}
            value={editor.name}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input
              onChange={(event) => onChange({ ...editor, description: event.target.value })}
              placeholder="Kisa aciklama"
              style={formInputStyle}
              value={editor.description}
            />
            <input
              onChange={(event) => onChange({ ...editor, klingElementId: event.target.value })}
              placeholder="Kling element ID"
              style={formInputStyle}
              value={editor.klingElementId}
            />
          </div>

          <textarea
            onChange={(event) => onChange({ ...editor, styleNotes: event.target.value })}
            placeholder="Stil ve continuity notlari"
            rows={7}
            style={textareaStyle}
            value={editor.styleNotes}
          />

          <div style={{ display: "grid", gap: 12, padding: 16, borderRadius: 18, border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Referans gorselleri</div>
              <button className="btn-secondary" onClick={onImportReferences} type="button">
                <Images size={14} />
                Gorsel Ekle
              </button>
            </div>

            {editor.refImages.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Henuz referans gorseli eklenmedi.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 10 }}>
                {editor.refImages.map((refImage) => {
                  const absoluteUrl = convertFileSrc(
                    `${projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "")}/${refImage}`,
                  );
                  const isPrimary = editor.primaryImage === refImage;

                  return (
                    <button
                      key={refImage}
                      onClick={() => onChange({ ...editor, primaryImage: refImage })}
                      style={{
                        display: "grid",
                        gap: 8,
                        padding: 8,
                        borderRadius: 14,
                        border: `1px solid ${isPrimary ? "rgba(245,158,11,0.32)" : "var(--border-subtle)"}`,
                        background: isPrimary ? "rgba(245,158,11,0.08)" : "var(--bg-surface)",
                        cursor: "pointer",
                      }}
                      type="button"
                    >
                      <img alt="reference" src={absoluteUrl} style={thumbStyle} />
                      <span style={{ fontSize: 10, color: isPrimary ? "var(--accent)" : "var(--text-secondary)" }}>
                        {isPrimary ? "Primary" : "Set primary"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-secondary" disabled={saving} onClick={onClose} type="button">
            Iptal
          </button>
          <button className="btn-primary" disabled={saving} onClick={onSave} type="button">
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignReferenceModal({
  character,
  shots,
  selectedShotId,
  onShotChange,
  onAssign,
  onClose,
  assigning,
  projectFolderPath,
}: {
  character: CharacterRecord;
  shots: ShotRow[];
  selectedShotId: string;
  onShotChange: (value: string) => void;
  onAssign: () => void;
  onClose: () => void;
  assigning: boolean;
  projectFolderPath: string;
}) {
  const previewUrl = character.primaryImage
    ? convertFileSrc(`${projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "")}/${character.primaryImage}`)
    : null;

  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={(event) => event.stopPropagation()} style={{ ...modalPanelStyle, width: "min(520px, 100%)" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Shot referansi ata</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            {character.name} karakterinin primary referansi secilen shot icin harici referans olarak atanacak.
          </p>
        </div>

        {previewUrl ? <img alt={character.name} src={previewUrl} style={{ ...thumbStyle, width: "100%", height: 220 }} /> : null}

        <select onChange={(event) => onShotChange(event.target.value)} style={formInputStyle} value={selectedShotId}>
          <option value="">Shot sec</option>
          {shots.map((shot) => (
            <option key={shot.id} value={shot.id}>
              {shot.shotNumber}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-secondary" disabled={assigning} onClick={onClose} type="button">
            Iptal
          </button>
          <button className="btn-primary" disabled={!selectedShotId || assigning} onClick={onAssign} type="button">
            {assigning ? "Ataniyor..." : "Ata"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CharactersState({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="screen-shell">
      <div style={emptyStateStyle}>
        <div style={{ display: "grid", gap: 10, justifyItems: "center", maxWidth: 420, textAlign: "center" }}>
          <UserRound size={34} style={{ color: "var(--accent)" }} />
          <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>{copy}</p>
        </div>
      </div>
    </section>
  );
}

const heroStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
  padding: 24,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background: "linear-gradient(135deg, rgba(245,158,11,0.08), transparent 28%), var(--bg-surface)",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(245, 158, 11, 0.24)",
  background: "rgba(245, 158, 11, 0.1)",
  color: "var(--accent)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies React.CSSProperties;

const copyStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies React.CSSProperties;

const toolbarStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  padding: 18,
  borderRadius: 20,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const searchInputStyle = {
  minWidth: 260,
  flex: 1,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
} satisfies React.CSSProperties;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
  gap: 16,
} satisfies React.CSSProperties;

const cardStyle = {
  display: "grid",
  gap: 16,
  padding: 18,
  borderRadius: 22,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const mediaStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 164,
  borderRadius: 18,
  overflow: "hidden",
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const mediaImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} satisfies React.CSSProperties;

const tagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(245,158,11,0.1)",
  color: "var(--accent)",
  fontSize: 11,
} satisfies React.CSSProperties;

const mutedTagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.04)",
  color: "var(--text-secondary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const textBlockStyle = {
  minHeight: 70,
  padding: 12,
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
} satisfies React.CSSProperties;

const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 240,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(0, 0, 0, 0.72)",
  backdropFilter: "blur(10px)",
} satisfies React.CSSProperties;

const modalPanelStyle = {
  width: "min(760px, 100%)",
  display: "grid",
  gap: 18,
  padding: 24,
  borderRadius: 24,
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const formInputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
} satisfies React.CSSProperties;

const textareaStyle = {
  ...formInputStyle,
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.7,
} satisfies React.CSSProperties;

const thumbStyle = {
  width: "100%",
  height: 112,
  objectFit: "cover",
  display: "block",
  borderRadius: 12,
} satisfies React.CSSProperties;

const emptyStateStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 360,
  padding: 24,
  borderRadius: 24,
  border: "1px dashed var(--border-default)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;
