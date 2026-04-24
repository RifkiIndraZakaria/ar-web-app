# 🎯 PANDUAN LENGKAP - AR 3D Web App

## Oleh: GitHub Copilot

## Tanggal: 24 April 2026

---

## 📋 DAFTAR ISI

1. [Apa yang telah dibuat?](#apa-yang-telah-dibuat)
2. [Instalasi (5 Menit)](#instalasi-5-menit)
3. [Cara Menggunakan](#cara-menggunakan)
4. [Menambah Model 3D Sendiri](#menambah-model-3d-sendiri)
5. [Generate QR Code](#generate-qr-code)
6. [Deploy ke Production](#deploy-ke-production)
7. [Troubleshooting](#troubleshooting)

---

## ❓ APAKAH INI?

Aplikasi **AR (Augmented Reality)** berbasis web yang mengubah phone/tablet Anda menjadi viewer 3D interaktif hanya dengan scan QR code.

### Fitur Utama:

- 🔦 **Scan QR Code** → Langsung muncul objek 3D
- 🎯 **Rotasi & Zoom** → Drag mouse / pinch untuk manipulasi
- 🔊 **Audio** → Background musik atau narasi
- 📱 **Mobile Ready** → Berfungsi di smartphone
- 🎨 **Lighting Canggih** → Tampilan 3D yang realistis

---

## ✅ APA YANG TELAH DIBUAT?

### 📦 18 File Siap Pakai

```
✅ 3 File JavaScript (ar-viewer.js, qr-scanner.js, audio-manager.js)
✅ 1 File HTML responsif (index.html dengan 800+ baris)
✅ 5 Dokumentasi lengkap (README, QUICKSTART, PROJECT_SUMMARY, dsb)
✅ 3 Setup script (Windows, macOS, Linux)
✅ 1 QR code generator script
✅ Konfigurasi lengkap (.env, package.json, .gitignore)
✅ Folder terstruktur siap untuk model & audio
✅ Testing & advanced guides
```

### 🎯 Fitur yang Sudah Berjalan

```
✅ QR Code Scanning (real-time dari kamera)
✅ 3D Object Rendering (GLTF, GLB, OBJ)
✅ Zoom & Rotasi (smooth, responsive)
✅ Audio Playback (MP3, WAV + Text-to-Speech)
✅ Keyboard Shortcuts (arrow keys, space, R, dsb)
✅ Mobile Support (touch, responsive design)
✅ Multiple Lighting (ambient, directional, point lights)
✅ Fullscreen Mode
✅ Model Download
✅ Status Tracking
```

---

## 🚀 INSTALASI (5 MENIT)

### ✅ Requirement

- **Node.js** (LTS version) - https://nodejs.org/
- **Browser Modern** (Chrome, Firefox, Edge, Safari)
- **Internet Connection** (untuk load dependencies)

### Step 1: Install Node.js

Jika belum punya:

1. Kunjungi https://nodejs.org/
2. Download LTS version
3. Install normal (next → next → finish)

### Step 2: Buka Terminal

**Windows:**

- Tekan `Windows Key` + `R`
- Ketik `cmd` lalu Enter
- Atau gunakan PowerShell

**macOS:**

- Tekan `Cmd` + `Space`
- Ketik `Terminal` lalu Enter

**Linux:**

- Buka Terminal dari aplikasi menu

### Step 3: Navigasi ke Project

```bash
cd d:\.Project\ar-web-app
```

### Step 4: Pilih Instalasi (A atau B)

#### **OPSI A: Automated (Recommended)**

**Windows:**

```bash
setup.bat
```

**macOS/Linux:**

```bash
chmod +x setup.sh
./setup.sh
```

Tunggu sampai selesai (~2-3 menit)

#### **OPSI B: Manual**

```bash
npm install
npm run serve
```

### Step 5: Buka Browser

Kunjungi salah satu URL:

- http://localhost:8080
- http://127.0.0.1:8080

✅ **Selesai! Aplikasi sudah jalan**

---

## 🎮 CARA MENGGUNAKAN

### 🧪 Test Pertama

1. **Biarkan server tetap jalan** (jangan close terminal)

2. **Di browser Anda:**
   - Klik tombol **"Klik untuk Demo"**
   - Seharusnya muncul cube warna-warni di bagian kanan

3. **Test Interaktivitas:**
   - Drag mouse di atas cube → berputar
   - Scroll/mousewheel → zoom in/out
   - Double click → reset ke posisi awal

4. **Test Keyboard:**
   - Tekan Arrow Keys → rotasi
   - Tekan `+` atau `-` → zoom
   - Tekan `R` → reset
   - Tekan `Space` → audio play/pause

### 📱 Scan QR Code (Nanti)

1. Klik **"🔄 Mulai Scan"**
   - Komputer akan minta izin camera → pilih "Allow"
   - Camera akan hidup (garis hijau di border)

2. Arahkan ke QR code yang ingin di-scan
   - Pastikan lighting cukup
   - QR code dalam fokus

3. Sistem otomatis akan:
   - Detect QR → beep sound
   - Load 3D object
   - Tampilkan informasi

---

## 🎨 MENAMBAH MODEL 3D SENDIRI

### Langkah 1: Cari Model 3D

Kunjungi: **https://sketchfab.com**

1. Search model yang mau (e.g., "robot")
2. Pastikan ada **"Download"** button
3. Pilih format **GLTF** atau **GLB**
4. Download file

### Langkah 2: Upload ke Hosting

Pilih salah satu:

**OPSI A: GitHub (Gratis, Recommended)**

1. Buat GitHub account (github.com)
2. Buat repository baru
3. Upload file .glb ke repository
4. Copy raw file URL
   - Format: `https://raw.githubusercontent.com/USERNAME/REPO/main/model.glb`

**OPSI B: Any Cloud Storage**

- Google Drive (ambil share link)
- Dropbox (ambil share link)
- AWS S3, Firebase Storage, dll

**OPSI C: Self-hosting**

- Upload ke folder `public/models/` di project Anda
- URL akan: `http://localhost:8080/models/model.glb`

### Langkah 3: Test URL

1. Copy URL model yang Anda upload
2. Buka browser → paste URL
3. Pastikan file download/terbuka
4. Jika berhasil lanjut ke step berikutnya

### Langkah 4: Test di Aplikasi (Manual Load)

Edit `public/index.html`:

Cari baris ini (sekitar line 450):

```javascript
function loadDemoObject() {
    const model = createDefaultModel();
```

Ganti dengan:

```javascript
function loadDemoObject() {
  load3DModel("YOUR_MODEL_URL_HERE", "Model Name");
}
```

Replace `YOUR_MODEL_URL_HERE` dengan URL Anda

Contoh:

```javascript
load3DModel(
  "https://raw.githubusercontent.com/myusername/myrepo/main/robot.glb",
  "My Robot",
);
```

Save file, reload browser → klik demo button

---

## 📱 GENERATE QR CODE

### Otomatis (Recommended)

1. **Buka terminal** kedua (jangan close yang pertama)

2. **Navigasi ke project:**

```bash
cd d:\.Project\ar-web-app
```

3. **Generate QR:**

```bash
npm run generate-qr
```

4. **QR files akan generate** di folder `public/qr/`
   - demo.png
   - sample1.png
   - sample2.png
   - dll

5. **Test scan:**
   - Buka image QR code
   - Gunakan phone untuk scan
   - Seharusnya detect & load model

### Custom QR Code Builder

**Untuk sharing dengan team/client:**

1. **Siap data model:**

```json
{
  "type": "ar_model",
  "model": "https://your-url.com/model.glb",
  "name": "Model Name",
  "audio": "https://your-url.com/audio.mp3",
  "autoPlay": true
}
```

2. **Generate QR:**
   - Online: https://qr-code-generator.com/
   - Paste JSON di atas
   - Generate & download

3. **Share QR image**

---

## 🌐 DEPLOY KE PRODUCTION

### OPSI 1: Vercel (Paling Mudah)

```bash
npm install -g vercel
vercel deploy
```

Vercel akan generate URL publik dalam 1 menit

### OPSI 2: Netlify

```bash
netlify deploy --prod
```

### OPSI 3: GitHub Pages

```bash
git push to GitHub
Enable GitHub Pages di settings
```

### OPSI 4: Traditional Hosting

1. Upload folder `public/` ke hosting FTP Anda
2. Set as public_html / www folder
3. Access via domain Anda

### ✅ Setelah Deploy

- Share URL aplikasi dengan users
- Users bisa scan QR code tanpa install apapun
- Bekerja 100% dari browser

---

## 🆘 TROUBLESHOOTING

### ❌ "Server won't start" / Port already in use

```bash
# Kill process di port 8080
# Windows:
netstat -ano | findstr :8080
taskkill /PID <PID> /F

# macOS/Linux:
lsof -i :8080
kill -9 <PID>

# Maka try port lain:
npx http-server public -p 8081 -c-1
```

### ❌ "Camera not working"

- Check browser permission (allow camera)
- Use HTTPS on production
- Try browser lain (Chrome recommended)
- Restart browser & refresh

### ❌ "3D model not showing"

- Check URL model is correct
- Test URL in browser bar
- Verify file format (GLTF/GLB/OBJ)
- Check console (F12 → Console tab) for error

### ❌ "QR code not scanning"

- Check lighting (bright area)
- Use high-quality QR code
- QR code in sharp focus
- Try dari jarak berbeda
- Use portrait mode (mobile)

### ❌ "Audio not playing"

- Click audio button manually first
- Check desktop volume level
- Check browser isn't muted
- Try audio file URL di browser bar dulu

---

## 📚 DOCUMENTATION REFERENCE

Baca dokumentasi ini dalam urutan:

1. **QUICKSTART.md** (5 min) - Quick setup
2. **README.md** (20 min) - Complete guide
3. **PROJECT_SUMMARY.md** (15 min) - Overview
4. **ADVANCED.html** (30 min) - Code examples
5. **testing-guide.html** (Testing checklist)

---

## 🎯 NEXT STEPS

### Immediate:

1. ✅ Setup aplikasi (npm install)
2. ✅ Test dengan demo
3. ✅ Scan QR code asli

### Short Term:

1. 📤 Upload model 3D Anda
2. 🎵 Add background audio
3. 📱 Generate QR codes

### Medium Term:

1. 🌐 Deploy ke production
2. 📊 Monitor performance
3. 🔧 Customize UI/styling

### Long Term:

1. 🎓 Learn Three.js
2. 📈 Add advanced features
3. 🚀 Expand ke mobile app

---

## 🎓 RESOURCES & LINKS

### Learning

- **Three.js Documentation**: https://threejs.org/docs/
- **Blender 3D Modeling**: https://www.blender.org/ (free)
- **Web Audio API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

### Free 3D Models

- **Sketchfab**: https://sketchfab.com/ (recommended)
- **TurboSquid**: https://www.turbosquid.com/
- **CGTrader**: https://www.cgtrader.com/

### Hosting (Free Tier)

- **GitHub Pages**: https://pages.github.com/
- **Vercel**: https://vercel.com/
- **Netlify**: https://www.netlify.com/

### QR Tools

- **QR Code Generator**: https://qr-code-generator.com/
- **GoQR.me**: https://goqr.me/

---

## ✨ SELESAI!

**Anda sekarang punya aplikasi AR web yang fully functional!**

### Yang bisa dilakukan:

✅ Scan QR code
✅ Lihat 3D objects interaktif
✅ Zoom & rotasi
✅ Play audio
✅ Mobile-friendly
✅ Production-ready

### Lanjutkan dengan:

1. Upload model 3D Anda
2. Generate QR codes
3. Share dengan users
4. Deploy ke production
5. Enjoy! 🚀

---

**Questions? Issues? Check troubleshooting section atau baca README.md dibagian yang relevant.**

**Happy Coding! 🎉**
