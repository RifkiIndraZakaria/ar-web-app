# AR 3D Web Viewer - Panduan Lengkap

Aplikasi Web-based AR yang memungkinkan scanning QR Code untuk menampilkan objek 3D interaktif dengan audio dan fitur zoom/rotasi.

## 🌟 Fitur Utama

- ✅ **QR Code Scanning** - Scan QR code langsung dari kamera perangkat
- ✅ **3D Object Viewer** - Menampilkan model 3D (GLTF, GLB, OBJ)
- ✅ **Interactive Controls** - Zoom dan rotasi dengan mouse/touch
- ✅ **Audio Playback** - Mainkan audio file atau text-to-speech
- ✅ **Responsive Design** - Bekerja di desktop dan mobile
- ✅ **Real-time Lighting** - Pencahayaan dinamis untuk hasil yang realistis
- ✅ **Animation Support** - Animasi otomatis untuk model GLTF

## 📋 Persyaratan

- Browser modern dengan dukungan:
  - WebGL
  - Web Audio API
  - Web Speech API
  - getUserMedia (untuk QR scanning)

## 🚀 Quick Start

### 1. Clone/Download Project

```bash
cd ar-web-app
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Jalankan Server

```bash
npm run serve
```

Server akan berjalan di `http://localhost:8080`

### 4. Akses di Browser

Buka `http://localhost:8080` di browser Anda

## 📱 Cara Penggunaan

### Opsi 1: Scan QR Code

1. Klik tombol **"Mulai Scan"**
2. Izinkan akses kamera
3. Arahkan ke QR code yang berisi data model 3D
4. Objek 3D akan ditampilkan secara otomatis

### Opsi 2: Demo Mode

1. Klik tombol **"Klik untuk Demo"** pada bagian QR Scanner
2. Cube demo akan dimuat dengan animasi otomatis

### Option 3: Direct Load (Development)

Edit `index.html` dan panggil:

```javascript
load3DModel("path/to/model.glb", "Model Name");
```

## 🎮 Kontrol Interaktif

### Mouse/Trackpad

- **Drag** - Rotasi objek 3D
- **Scroll** - Zoom In/Out
- **Double Click** - Reset view

### Touch (Mobile)

- **Drag** - Rotasi
- **Pinch** - Zoom In/Out

### Keyboard

- **← → ↑ ↓** - Rotasi dengan Arrow Keys
- **+/-** - Zoom
- **Space** - Play/Pause Audio
- **R** - Reset Camera
- **F** - Fullscreen

## 🔧 Format QR Code

### Format 1: JSON

```json
{
  "type": "ar_model",
  "model": "https://example.com/model.glb",
  "name": "My 3D Model",
  "audio": "https://example.com/audio.mp3",
  "autoPlay": true,
  "description": "Deskripsi model 3D"
}
```

### Format 2: URL

```
https://example.com/ar-config.json
```

### Format 3: Custom (pipe-separated)

```
https://example.com/model.glb|https://example.com/audio.mp3|Model Name|auto
```

### Format 4: Direct URL

```
https://example.com/model.glb
```

## 📦 Format Model 3D yang Didukung

- **GLTF/GLB** (recommended) - Format modern, size kecil
- **OBJ** - Format legacy, universal
- **FBX** - Memerlukan loader tambahan

## 🎵 Fitur Audio

### File Audio

Kirim URL file audio dalam QR code atau konfigurasi

### Text-to-Speech (TTS)

Sistem akan otomatis memberikan teks feedback ketika model dimuat

### Sound Effects

- Beep notification saat QR terdeteksi
- Error sound untuk kondisi error
- Success sound saat model dimuat

## 📤 Upload Model 3D Anda Sendiri

### Step 1: Siapkan Model

- Export model dari Blender/3D max ke format GLTF
- Optimalkan ukuran file (target < 10MB)
- Test model di Three.js

### Step 2: Upload ke Hosting

```bash
# Upload ke hosting cloud atau local server
# Pastikan CORS enabled
```

### Step 3: Generate QR Code

```bash
npm run generate-qr
```

Edit `scripts/generateQR.js` untuk mengatur URL model

### Step 4: Share QR Code

Gunakan QR code untuk scanning di aplikasi

## 🔗 Generate QR Code untuk Dibagikan

### Menggunakan Node.js Script

```bash
npm run generate-qr
```

### Manual (Online)

1. Buka https://qr-code-generator.com/
2. Masukkan data sesuai format di atas
3. Download QR code
4. Share dengan orang lain

## 🌐 Deployment

### Opsi 1: GitHub Pages

```bash
git push ke GitHub
Enable GitHub Pages di settings
```

### Opsi 2: Vercel

```bash
vercel deploy
```

### Opsi 3: Netlify

```bash
netlify deploy --prod
```

### Opsi 4: Hosting Biasa

Upload folder `public/` ke hosting Anda

## 📁 Struktur Project

```
ar-web-app/
├── public/
│   ├── index.html           # Main HTML file
│   ├── js/
│   │   ├── ar-viewer.js     # Three.js 3D viewer
│   │   ├── qr-scanner.js    # QR code detection
│   │   └── audio-manager.js # Audio management
│   ├── models/              # 3D model files (GLTF/OBJ)
│   ├── audio/               # Audio files (MP3/WAV)
│   └── qr/                  # Generated QR codes
├── scripts/
│   └── generateQR.js        # QR code generator
├── package.json
└── README.md
```

## 🛠 Troubleshooting

### Camera tidak berfungsi

- Pastikan browser punya izin akses kamera
- Gunakan HTTPS (required untuk live camera access)
- Check browser console untuk error messages

### Model tidak tampil

- Pastikan URL model accessible (test di browser)
- Check CORS headers dari server
- Verifikasi format model (GLTF/GLB/OBJ)
- Size file terlalu besar? Optimalkan model

### Audio tidak jalan

- Check browser's autoplay policy (mungkin block)
- Klik checkbox audio untuk manual play
- Test file audio di browser terlebih dahulu
- Enable speaker/audio output

### QR Scan tidak terdeteksi

- Cek pencahayaan area
- Gunakan QR code berkualitas tinggi
- Pastikan QR code dalam fokus kamera
- Coba dari jarak berbeda

## 💡 Tips & Tricks

1. **Optimasi 3D Model**
   - Gunakan Blender untuk export GLTF
   - Reduce polygon count untuk performa lebih baik
   - Gunakan texture compression

2. **Audio Quality**
   - Gunakan MP3 format didukung semua browser
   - Kompres audio untuk ukuran file lebih kecil
   - Test audio playback di berbagai browser

3. **QR Code Design**
   - Gunakan QR code ukuran minimal 200x200px
   - Pastikan kontras background-foreground cukup
   - Tambahkan logo di tengah QR (optional)

4. **Performance**
   - Limit jumlah lights dalam scene
   - Gunakan canvas LOD (Level of Detail)
   - Test di low-end devices

## 🔐 Security Notes

- Validasi input URL untuk mencegah XSS
- Gunakan HTTPS untuk production
- Implement CORS properly
- Don't expose sensitive data dalam QR codes

## 📝 Lisensi

MIT License - Bebas digunakan untuk project komersial dan non-komersial

## 👨‍💻 Support & Kontribusi

Issues, suggestions, dan pull requests welcome!

## 🎓 Resources

- **Three.js**: https://threejs.org/
- **Blender**: https://www.blender.org/ (untuk 3D modeling)
- **QR Code Generator**: https://goqr.me/
- **Web Audio API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

---

**Version**: 1.0.0  
**Last Updated**: April 2024  
**Created with ❤️ for AR Enthusiasts**
