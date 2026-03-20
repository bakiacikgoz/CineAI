# CineAI Studio

Tauri + React tabanli yerel bir sinematik AI workstation. Proje; storyboard import, still/video generation, otonom aday akislari, asset yonetimi, karakter referanslari ve queue recovery akisini tek masaustu uygulamasinda toplar.

## Temel Ozellikler

- Proje olusturma, proje klasoru acma ve son aktif projeyi otomatik geri yukleme
- Film-kit `SHOT*.md` storyboard import ve board tabanli timeline gorunumu
- START, END, coverage image ve video queue uretimi
- Otonom aday uretimi ve shot bazli secim akisi
- Asset Library uzerinden tag, atama, preview, reveal ve guvenli delete
- Character reference yonetimi ve shot external reference atama
- Cost dashboard, model preset yonetimi ve yerel settings saklama

## Gereksinimler

- Node.js 20+
- Rust toolchain
- macOS uzerinde Tauri icin Xcode Command Line Tools

## Kurulum

```bash
npm install
```

## Gelistirme

```bash
npm run tauri -- dev
```

Yalnizca web arayuzunu calistirmak icin:

```bash
npm run dev
```

## Build ve Test

```bash
npm run build
npm test
```

## Gerekli Ayarlar

`Settings` ekranindan asagidaki anahtarlar yerel store icine yazilir:

- `FAL_API_KEY`
- `TENSORPIX_API_KEY`
- `OPENROUTER_API_KEY`

Ayni ekranda varsayilan image/video modelleri, queue parallel limit ve TensorPix filter ayari da saklanir.

## Proje Yapisi

- `src/screens`: uygulama ekranlari
- `src/services`: Tauri, DB ve generation akislari
- `src/lib`: saf helper ve parse/merge karar mantigi
- `src-tauri`: Tauri/Rust katmani

## Tipik Akis

1. Dashboard uzerinden proje olustur veya mevcut klasoru ac.
2. Storyboard ekraninda Film-kit output klasorunu import et.
3. Shot detail veya Bulk Production ile START, END, coverage ve video isleri kuyrukla.
4. Asset Library ve Characters ekranlariyla continuity referanslarini yonet.
5. Job Queue ve Cost Dashboard ile uretim durumunu izle.

## Notlar

- Queue ve son aktif proje acilista otomatik geri yuklenir.
- Dashboard kartlari `project.json` icindeki thumbnail ve metadata ozetini kullanir.
- Vitest testleri pure helper katmanini korur; UI entegrasyon testleri su an kapsam disidir.
