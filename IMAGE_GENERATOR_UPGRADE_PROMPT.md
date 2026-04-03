# CineAI Studio — Görsel Üretim Bölümü Kapsamlı Yükseltme Promptu

> Bu promptu bir kodlama ajanına (Claude Code, Cursor, vb.) direkt yapıştır. Ajan, aşağıdaki görevleri sırasıyla uygulayacak.

---

## BAĞLAM

CineAI Studio, Tauri v2 + React 19 masaüstü uygulamasıdır. Görsel üretim bölümü şu 3 ana dosyadan oluşur:

1. `src/screens/image-generator/ImageGenerator.tsx` (~1322 satır) — Sol panel kontrolleri + generate butonu
2. `src/screens/image-generator/GeneratedImageGallery.tsx` (~1073 satır) — Sağ taraftaki galeri grid'i, kart bileşenleri, batch operasyonlar
3. `src/components/media/ImageEditModal.tsx` (~600+ satır) — Çizim tabanlı düzenleme modalı (fırça, silgi, katman, geçmiş)

Ek bileşenler: `MediaLightbox.tsx`, `MediaPaginationControls.tsx`, `ModalShell.tsx`

**Teknoloji**: React 19 + Zustand v5 + Framer Motion + Lucide Icons + Tailwind CSS v4. UI dili Türkçe. Strict TypeScript.

**CSS Değişkenleri** (`src/index.css`): `--bg-base`, `--bg-surface`, `--bg-elevated`, `--border-subtle`, `--border-default`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--on-accent`, `--surface-hover`, `--surface-active`, `--glass-bg`, `--glass-border`, `--canvas-bg`, `--shadow-sm/md/lg/modal`, `--backdrop-bg`. Light ve dark tema mevcut.

**Mevcut sorunlar**: Hardcoded rgba değerleri (CSS variable kullanılmalı), tutarsız transition süreler (80-400ms arası dağınık), Framer Motion minimal kullanım (yalnızca section entry ve lightbox), galeri kartlarında hover efektleri eklendi ama bazı inline shadow'lar hâlâ hardcoded, ImageEditModal'da panel grid düzeni showLayers/showHistory'ye göre dinamik değil.

---

## GÖREV LİSTESİ (SIRALI UYGULA)

### GÖREV 1: CSS Token Sistemi Oluştur

`src/index.css` dosyasının `:root` ve `.dark` bloklarına ekle:

```css
/* Zamanlama tokenleri */
--duration-instant: 80ms;
--duration-fast: 150ms;
--duration-normal: 250ms;
--duration-slow: 400ms;
--ease-out: cubic-bezier(0.4, 0, 0.2, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

/* Ek shadow'lar */
--shadow-card: 0 1px 4px rgba(0,0,0,0.06);
--shadow-card-hover: 0 8px 24px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.05);
--shadow-card-selected: 0 0 0 2px var(--accent), 0 8px 24px rgba(0,0,0,0.12);
--shadow-float: 0 12px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04);

/* Focus ring */
--focus-ring: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent);
```

Dark temada shadow değerlerini güncelle (opaklıklar ~2x).

Sonra tüm 3 ana dosyadaki hardcoded `rgba(0,0,0,0.X)` shadow/border değerlerini ve hardcoded transition sürelerini bu tokenlara taşı.

---

### GÖREV 2: ImageEditModal Profesyonel Seviyeye Çıkar

**Dosya**: `src/components/media/ImageEditModal.tsx`

Mevcut yapıyı koru, aşağıdaki iyileştirmeleri uygula:

#### 2A. Panel Grid Düzeni Düzelt
Sağ panel `gridTemplateColumns` şu an showLayers/showHistory'den bağımsız aynı değeri veriyor. Düzelt:
- Layers veya History açıkken: `"minmax(0, 1fr) 320px"`
- İkisi de kapalıyken: `"minmax(0, 1fr) 290px"`

#### 2B. Gelişmiş Fırça İmleci
Canvas üzerindeki SVG fırça cursor'u şu an sabit 800px referans kullanıyor (`size / 800`). Bunu gerçek canvas boyutuna oranla hesapla:
```typescript
// Canvas container'ın gerçek boyutunu ref ile al
const canvasBounds = canvasContainerRef.current?.querySelector('[data-canvas-surface]')?.getBoundingClientRect();
const maxDim = canvasBounds ? Math.max(canvasBounds.width, canvasBounds.height) : 800;
const cursorRadius = size / maxDim / 2;
```

#### 2C. Smooth Stroke Rendering Optimizasyonu
`smoothPath()` fonksiyonu Catmull-Rom spline kullanıyor ama `simplifyPoints()` tolerance değeri (0.0005) çok agresif. Bunu fırça boyutuna oranla dinamik yap:
```typescript
const tolerance = Math.max(0.0002, size / 5000);
```

#### 2D. Preset Prompt Sistemi Genişlet
Her preset kategorisine 2 ek prompt daha ekle. Ayrıca "Son kullanilan" kategorisi ekle — kullanıcı bir preset'e tıkladığında `localStorage`'a kaydet, modal açılınca geri yükle. (Tauri ortamında localStorage çalışır, bu web artifact değil.)

#### 2E. Eraser Visual Feedback
Silgi aracı aktifken canvas cursor'ını `url(data:image/svg+xml,...) center` ile özel eraser SVG cursor yap. Ayrıca floating toolbar'daki aktif araç göstergesine animasyonlu indicator ekle.

#### 2F. Submission Flow İyileştirmesi
`handleSubmit()` içinde progress feedback ekle:
1. "Kilavuz olusturuluyor..." — buildRefs sırasında
2. "Kuyruga ekleniyor..." — onSubmit sırasında
Bu aşamaları `submissionPhase` state'i ile takip et ve footer'da göster.

#### 2G. Mini-map Navigasyonu
Zoom > 1 olduğunda canvas sol alt köşesinde küçük bir mini-map göster:
- Orijinal görselin küçük versiyonu (max 120px genişlik)
- Viewport'u temsil eden dikdörtgen overlay
- Tıklanarak pan pozisyonu değiştirilebilsin
- Glassmorphism stilinde panel

#### 2H. Before/After Karşılaştırma İyileştirmesi
Mevcut `showCompare` sadece görüntüyü solduruyor. Bunun yerine slider-based comparison yap:
- Dikey bölme çizgisi (sürüklenebilir)
- Sol taraf: orijinal, Sağ taraf: markup'lı
- Çizgi üzerinde tutamak ikonu

---

### GÖREV 3: GeneratedImageGallery Profesyonel Seviyeye Çıkar

**Dosya**: `src/screens/image-generator/GeneratedImageGallery.tsx`

#### 3A. Kart Grid Layout İyileştirmesi
Grid'i `repeat(auto-fill, minmax(220px, 1fr))` yerine responsive breakpoint'li yap:
```typescript
const gridColumns = viewportWidth >= 1600 ? "repeat(auto-fill, minmax(260px, 1fr))"
  : viewportWidth >= 1200 ? "repeat(auto-fill, minmax(220px, 1fr))"
  : "repeat(auto-fill, minmax(180px, 1fr))";
```
Bunu `useEffect` ile `window.innerWidth` dinleyerek hesapla.

#### 3B. Galeri Filtre ve Sıralama Araç Çubuğu
Mevcut grup butonlarının üstüne profesyonel bir araç çubuğu ekle:
- **Sıralama**: Tarih (yeni→eski, eski→yeni), Model adı, Boyut
- **Görünüm**: Grid (mevcut), Liste (kompakt tablo görünümü)
- **Arama**: Asset filename veya prompt içinde arama

Bu kontrolleri `galleryViewMode`, `gallerySortBy`, `gallerySearchQuery` state'leri ile yönet. Screen state store'a da persist et.

#### 3C. Kart Hover Mikro-etkileşimleri
ImageCard'a Framer Motion ekle:
```tsx
<motion.article
  layout
  initial={{ opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.96 }}
  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
  whileHover={{ y: -3 }}
>
```
AnimatePresence ile kart ekleme/silme animasyonları da ekle.

#### 3D. Batch İşlem Paneli Redesign
Mevcut batch işlem alanı (taşı/sil/temizle butonları) düz bir row. Bunu sticky bir "action bar" olarak redesign et:
- Seçili kart sayısı > 0 olduğunda galeri'nin altından yukarı kayarak (Framer Motion) ortaya çıksın
- Glassmorphism arka plan, blur efekti
- Taşı, sil, seçimi temizle butonları + seçili kart sayısı badge
- Tümünü seç / seçimi ters çevir butonları da ekle

#### 3E. İmage Skeleton Gelişmiş Animasyon
`ImageSkeleton` bileşenine shimmer/pulse animasyonu ekle:
```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```
Ayrıca skeleton kartın aspect ratio'sunu üretilen görselin gerçek aspect ratio'suyla eşleştir (job metadata'dan al).

#### 3F. Lightbox Navigasyonu
`MediaLightbox` açıkken sol/sağ ok tuşlarıyla mevcut sayfadaki görseller arasında gezinme ekle:
- `pagedAssets` array'ini lightbox'a ilet
- Sol/sağ ok tuşları + ekran kenarındaki yarı-saydam butonlarla navigasyon
- Geçiş animasyonu: crossfade veya slide

---

### GÖREV 4: ImageGenerator Sol Panel İyileştirmeleri

**Dosya**: `src/screens/image-generator/ImageGenerator.tsx`

#### 4A. Model Seçim Kartlarını Zenginleştir
Her model kartına:
- Model logosu veya ayırt edici ikon
- "img2img", "text2img" gibi yetenek badge'leri
- Seçili modelin arka planında subtil glow efekti

#### 4B. Prompt Alanı İyileştirmeleri
- Karakter sayacı (sağ üst köşe, prompt uzunluğu)
- Token tahmini gösterge (yaklaşık ~4 karakter = 1 token)
- Prompt temizle butonu (X ikonu)
- Shift+Enter ile satır atla, Enter ile (eğer `canGenerate` true ise) direkt generate tetikle — opsiyonel, bir toggle ile açılıp kapansın

#### 4C. Adet Stepper Görsel İyileştirmesi
Mevcut stepper basit +/- butonları. Bunu:
- Butonlar arasındaki sayıyı daha büyük ve belirgin yap
- Hızlı seçim için preset butonları ekle: 1, 2, 4, 8
- Maliyet göstergesiyle birlikte (adet × birim fiyat)

#### 4D. Collapsible Section Animasyonları
`CollapsibleSection` açılma/kapanma animasyonu yoksa Framer Motion ile ekle:
```tsx
<motion.div
  initial={false}
  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
  style={{ overflow: "hidden" }}
>
```

#### 4E. Generate Butonu Mikro-etkileşimi
- Hover'da subtil scale + glow
- Tıklamada ripple efekti veya press animasyonu
- Generating sırasında pulsing border animasyonu
- Başarılı ekleme sonrası kısa success flash (yeşil border, 600ms)

---

### GÖREV 5: Birleşik Modal Yönetimi (Opsiyonel ama Önerilir)

`src/contexts/ModalContext.tsx` oluştur:
```typescript
type ModalState = {
  lightbox: MediaLightboxItem | null;
  editDraft: ImageEditModalDraft | null;
  // gelecekte: videoPlayer, characterDetail, vb.
};
```
Bu context ile:
- ImageGenerator'da `imageEditDraft` ve `lightboxItem` state'lerini kaldır
- Gallery ve ImageCard'dan context üzerinden modal aç
- Modal'dan modal'a geçiş (edit → lightbox preview) mümkün olsun

---

### GÖREV 6: Edit Modal'dan Model Seçimi

`ImageGenerator.tsx` satır ~566'da edit submit handler'ında model sabit `"fal-ai/nano-banana-2"` olarak kodlanmış. Bunu düzelt:
- ImageEditModal'a `availableModels` prop'u ekle (veya context'ten al)
- Modal içinde sağ panele minimal bir model seçici dropdown koy
- Default olarak mevcut generator'daki seçili modeli kullan
- Sadece `supportsImg2Img: true` olan modelleri listele

---

### GÖREV 7: Erişilebilirlik ve Klavye Desteği

- Tüm interaktif elementlere `aria-label` ekle (Türkçe)
- ImageCard'lara `tabIndex={0}` ve `onKeyDown` Enter/Space handler'ları ekle (zaten var ama eksik olanları tamamla)
- Focus ring'leri `--focus-ring` token'ını kullansın
- Edit Modal'daki tüm kısayolları `aria-keyshortcuts` ile belgelendir
- Galeri grid'ine `role="grid"` ve kartlara `role="gridcell"` ekle

---

### GÖREV 8: Performans Optimizasyonları

- `ImageCard` bileşenini `React.memo()` ile wrap et (props karşılaştırma fonksiyonu ile)
- Gallery asset listesinde `useMemo` zaten var, ama `pagedAssets` hesaplamasını da memo'la
- Büyük galeriler için (100+ asset) `Intersection Observer` ile lazy image loading ekle (mevcut `loading="lazy"` yeterli olmayabilir, explicit observer ile `src` atamasını geciktir)
- ImageEditModal'daki stroke rendering'i SVG `<use>` ile optimize et (tekrarlayan stroke pattern'leri için)

---

## KRİTİK KURALLAR

1. **TypeScript Strict Mode**: Unused variable, any tipi yasak. Her değişiklikten sonra `npx tsc --noEmit` çalıştır.
2. **CSS Değişkenleri**: Yeni hardcoded rgba değeri EKLEME. Her renk/shadow/border mevcut `--` token'larını kullansın.
3. **Mevcut API Kontratları**: Export edilen type'ları (ImageEditModalDraft, ImageEditSubmitPayload, GalleryAsset, vb.) BOZMA. Yeni field ekleyebilirsin ama mevcut field'ları silme.
4. **UI Dili Türkçe**: Tüm yeni label, placeholder, tooltip Türkçe olacak. ASCII Türkçe kabul (ö→o, ş→s, vb. mevcut pattern'e uy).
5. **Framer Motion**: Yeni animasyonlar için `framer-motion` kullan (zaten dependency'de var). CSS-only animasyonlar yalnızca `@keyframes` shimmer gibi basit efektler için.
6. **Import Pattern**: `@/` alias'ı `src/` dizinine resolve eder. Bunu kullan.
7. **Tema Uyumu**: Light ve dark tema DESTEKLENMELİ. Hardcoded beyaz/siyah kullanma, CSS variable kullan.
8. **Test**: `src/lib/` dışında test yok. Yeni test yazma zorunlu değil ama TypeScript derlemesi temiz olmalı.
9. **Dosya boyutu**: Tek dosya 1500 satırı geçmesin. Gerekirse alt bileşenlere böl (örn: `ImageEditToolbar.tsx`, `ImageEditCanvas.tsx`).

---

## SIRALI UYGULAMA PLANI

```
1. CSS Tokenleri → index.css (15 dk)
2. Token Migration → 3 ana dosyada hardcoded değerleri değiştir (30 dk)
3. ImageEditModal iyileştirmeleri (2A-2H) (90 dk)
4. GeneratedImageGallery iyileştirmeleri (3A-3F) (90 dk)
5. ImageGenerator sol panel (4A-4E) (45 dk)
6. Model seçim fix (Görev 6) (20 dk)
7. Erişilebilirlik pass (Görev 7) (30 dk)
8. Performans pass (Görev 8) (30 dk)
9. TypeScript final check + düzeltmeler (15 dk)
```

Her görev grubundan sonra `npx tsc --noEmit` çalıştır ve hataları düzelt.
