Marker dapat dikonfigurasi lewat `public/data/experiences.json`.

Tipe marker yang didukung di proyek ini:

- preset Hiro: isi `marker.preset` dengan `hiro`
- preset Kanji: isi `marker.preset` dengan `kanji`
- barcode marker: isi `marker.type` dengan `barcode` dan `marker.value`
- pattern marker custom: isi `marker.type` dengan `pattern` dan `marker.patternUrl`

Saran workflow:

1. QR dipakai untuk membuka halaman experience.
2. Marker dipakai untuk anchor AR di kamera.
3. Cetak QR dan marker pada satu kartu/poster agar user cukup scan sekali lalu arahkan kamera ke marker yang sama.

Untuk pattern marker custom, simpan file `.patt` di folder ini lalu rujuk path-nya dari `experiences.json`.
