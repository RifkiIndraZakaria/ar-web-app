# AR Experience Launcher

Proyek ini menyiapkan alur:

`QR -> buka halaman AR di mobile -> marker terdeteksi -> object 3D muncul di atas marker -> audio + interaksi aktif`

QR dipakai sebagai pintu masuk ke halaman experience. Marker dipakai sebagai anchor AR agar object muncul stabil di posisi tertentu.

## Struktur penting

```text
ar-web-app/
|- public/
|  |- index.html              # launcher experience dan preview QR
|  |- ar.html                 # halaman AR marker-based
|  |- data/experiences.json   # semua mapping QR, marker, model, audio
|  |- js/landing.js           # renderer launcher
|  |- js/ar-experience.js     # runtime AR
|  |- models/                 # file .glb / .gltf
|  |- audio/                  # file audio .mp3 / .wav
|  |- markers/                # file .patt untuk marker custom
|  |- qr/                     # hasil generate QR
|- scripts/generateQR.js      # generator QR dari experiences.json
|- .github/workflows/deploy-pages.yml
```

## Cara jalan lokal

```bash
npm install
npm run generate-qr
npm run serve
```

Buka:

```text
http://localhost:8080
```

## Deploy ke GitHub Pages

1. Buat repository GitHub baru.
2. Push isi proyek ini ke branch `main`.
3. Buka `Settings -> Pages` dan set source ke `GitHub Actions`.
4. Workflow `.github/workflows/deploy-pages.yml` akan deploy folder `public/`.

Contoh push awal:

```bash
git init
git add .
git commit -m "Initial AR launcher"
git branch -M main
git remote add origin https://github.com/USERNAME/ar-web-app.git
git push -u origin main
```

Setelah nama repo final, ganti `site.baseUrl` di `public/data/experiences.json`:

```json
{
  "site": {
    "baseUrl": "https://USERNAME.github.io/ar-web-app"
  }
}
```

Lalu generate ulang QR:

```bash
npm run generate-qr
```

Atau untuk sekali generate dengan base URL production:

```powershell
$env:PUBLIC_BASE_URL="https://USERNAME.github.io/ar-web-app"
npm run generate-qr
```

## Menambah experience baru

1. Simpan model ke `public/models/`.
2. Simpan audio ke `public/audio/` jika memakai file audio.
3. Jika memakai marker custom, simpan file `.patt` ke `public/markers/`.
4. Tambah item baru di `public/data/experiences.json`.
5. Jalankan lagi `npm run generate-qr`.
6. Commit lalu push ke GitHub.

Contoh experience baru:

```json
{
  "id": "produk-baru",
  "title": "Produk Baru",
  "description": "Model produk tampil di atas marker custom.",
  "marker": {
    "type": "pattern",
    "patternUrl": "markers/produk-baru.patt",
    "label": "Marker Produk Baru",
    "printHint": "Cetak marker produk-baru.patt dan tempatkan dekat QR."
  },
  "model": {
    "src": "models/produk-baru.glb",
    "position": "0 0.45 0",
    "rotation": "0 0 0",
    "scale": "0.9 0.9 0.9",
    "animationMixer": true
  },
  "audio": {
    "src": "audio/produk-baru.mp3",
    "autoplayOnMarker": true,
    "pauseOnMarkerLost": true,
    "loop": false,
    "volume": 0.85
  },
  "interaction": {
    "rotateStep": 12,
    "scaleStep": 0.12,
    "minScale": 0.5,
    "maxScale": 2.4,
    "autoRotate": false
  }
}
```

## Opsi marker yang didukung

- `preset: "hiro"`
- `preset: "kanji"`
- `type: "barcode"` + `value`
- `type: "pattern"` + `patternUrl`

## Catatan implementasi

- Untuk mobile production, gunakan HTTPS. GitHub Pages sudah memenuhi ini.
- Audio autoplay di mobile bergantung pada interaksi user. Karena itu halaman AR memakai tombol `Mulai AR`.
- Jika object tidak muncul, cek tiga hal: marker cocok, path model benar, dan browser diberi izin kamera.
- Jika Anda ingin QR dan marker berada pada satu media cetak, tempatkan QR sebagai launcher dan marker sebagai area tracking di desain yang sama.

## Referensi resmi

- AR.js marker-based docs: https://ar-js-org.github.io/AR.js-Docs/marker-based/
- AR.js pattern marker generator: https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/generator.html
- A-Frame glTF model docs: https://aframe.io/docs/1.7.0/components/gltf-model.html
