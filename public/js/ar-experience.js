"use strict";

// ─── UTILITY ──────────────────────────────────────────────────────────────
function getExperienceId() {
  return (
    new URLSearchParams(window.location.search).get("experience") || "demo-hiro"
  );
}

async function fetchExperience() {
  const res = await fetch("data/experiences.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Gagal memuat experiences.json (HTTP ${res.status})`);
  }
  const data = await res.json();
  const id = getExperienceId();
  const exp = (data.experiences || []).find((e) => e.id === id);

  if (!exp) {
    throw new Error(`Experience "${id}" tidak ditemukan dalam data.`);
  }
  return exp;
}

// ─── MAIN LOGIC ───────────────────────────────────────────────────────────
async function main() {
  const titleEl = document.getElementById("experience-title");
  const viewerEl = document.getElementById("ar-viewer");

  try {
    titleEl.textContent = "Mengambil data...";

    // 1. Ambil data konfigurasi dari JSON
    const exp = await fetchExperience();

    // 2. Terapkan judul halaman
    document.title = exp.title + " | AR";
    titleEl.textContent = exp.title;

    // 3. Terapkan model 3D ke elemen <model-viewer>
    if (exp.model && exp.model.src) {
      viewerEl.src = exp.model.src;

      // Atur skala jika dikonfigurasi di JSON (opsional)
      if (exp.model.scale) {
        viewerEl.setAttribute("scale", exp.model.scale);
      }

      // Jika ada audio autoplay, mainkan saat user interaksi pertama kali dengan viewer
      if (exp.audio && exp.audio.src) {
        const audio = new Audio(exp.audio.src);
        audio.loop = Boolean(exp.audio.loop);

        viewerEl.addEventListener(
          "mousedown",
          () => audio.play().catch((e) => {}),
          { once: true },
        );
        viewerEl.addEventListener(
          "touchstart",
          () => audio.play().catch((e) => {}),
          { once: true },
        );
      }
    } else {
      throw new Error("Sumber model 3D (src) tidak ditemukan.");
    }
  } catch (err) {
    console.error("[AR Error]", err);
    titleEl.textContent = "Gagal memuat model";
    alert(err.message);
  }
}

// Jalankan saat script dimuat
main();
