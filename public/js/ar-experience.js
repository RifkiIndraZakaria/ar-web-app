/* ══════════════════════════════════════════════════════════════════════
   ar-experience.js  –  AR Experience core logic
   Robust, mobile-friendly, GitHub Pages deployment ready
   ES2020 – no classes, no TypeScript
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

// ─── STATE ─────────────────────────────────────────────────────────────────
const state = {
  experience: null,
  scene: null,
  markerElement: null,
  modelElement: null,
  audioElement: null,
  currentScale: 1,
  baseScale: 1,
  baseRotationY: 0,
  currentRotationY: 0,
  markerVisible: false,
  placed: false, // true setelah marker pertama kali terdeteksi
  userStarted: false,
  speechActive: false,
  cameraReady: false,
  rafId: null,
  touch: { lastDist: null, lastX: null, lastY: null },
  previewStream: null,
};

// ─── TINY HELPERS ───────────────────────────────────────────────────────────
function qs(sel) {
  return document.querySelector(sel);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function parseScaleX(s) {
  const n = Number((s || "1 1 1").split(/\s+/)[0]);
  return isNaN(n) || n === 0 ? 1 : n;
}

function parseRotY(s) {
  const parts = (s || "0 0 0").split(/\s+/).map(Number);
  return parts.length >= 2 ? parts[1] || 0 : 0;
}

// ─── EXPERIENCE CONFIG ──────────────────────────────────────────────────────
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

// ─── UI / STATUS ────────────────────────────────────────────────────────────
function setStatus(msg, tone) {
  if (tone === undefined) tone = "";
  const pill = qs("#status-line");
  if (!pill) return;
  pill.className = ["status-pill", tone].filter(Boolean).join(" ");
  const textEl = pill.querySelector(".status-text");
  if (textEl) textEl.textContent = msg;
}

function setPageCopy(exp) {
  document.title = exp.title + " | AR";
  const bootTitle = qs("#boot-title");
  if (bootTitle) bootTitle.textContent = exp.title;
  const expTitle = qs("#experience-title");
  if (expTitle) expTitle.textContent = exp.title;
  const expDesc = qs("#experience-description");
  if (expDesc) expDesc.textContent = exp.description || "";
  const bootText = qs("#boot-text");
  if (bootText)
    bootText.textContent = exp.bootText || "Tekan Mulai AR untuk memulai.";
}

function showLoading(msg) {
  const overlay = qs("#loading-overlay");
  if (overlay) overlay.classList.remove("hidden");
  const text = qs("#loading-text");
  if (text) text.textContent = msg || "Memuat…";
}

function hideLoading() {
  const overlay = qs("#loading-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function showBoot() {
  const overlay = qs("#boot-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

function hideBoot() {
  const overlay = qs("#boot-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function getCameraError(err) {
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return "Halaman harus dibuka melalui HTTPS atau localhost. Buka melalui GitHub Pages atau server HTTPS.";
  }
  if (!navigator.mediaDevices) {
    return "Browser ini tidak mendukung API kamera. Gunakan Chrome atau Safari versi terbaru.";
  }
  switch (err && err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Izin kamera ditolak. Buka pengaturan browser dan izinkan akses kamera untuk situs ini.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Tidak ada kamera yang tersedia pada perangkat ini.";
    case "NotReadableError":
    case "TrackStartError":
      return "Kamera sedang dipakai aplikasi lain atau gagal diakses. Tutup aplikasi lain lalu coba lagi.";
    case "OverconstrainedError":
      return "Konfigurasi kamera tidak dapat dipenuhi oleh perangkat ini.";
    default:
      return (
        (err && err.message) ||
        "Gagal memulai AR. Pastikan kamera tersedia dan izin diberikan."
      );
  }
}

// ─── SCENE BUILDING ─────────────────────────────────────────────────────────
function buildScene() {
  let host = qs("#scene-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "scene-host";
    document.body.prepend(host);
  }

  const scene = document.createElement("a-scene");
  scene.setAttribute("embedded", "");
  scene.setAttribute(
    "renderer",
    "antialias: true; alpha: true; logarithmicDepthBuffer: true;",
  );
  scene.setAttribute("vr-mode-ui", "enabled: false");
  scene.setAttribute("device-orientation-permission-ui", "enabled: false");
  scene.setAttribute(
    "arjs",
    "sourceType: webcam; videoTexture: true; debugUIEnabled: false; detectionMode: mono_and_matrix; matrixCodeType: 3x3;",
  );

  // Wajib: A-Frame background component defaultnya opaque hitam,
  // ini yang menyebabkan layar hitam di belakang AR.js video.
  // transparent: true membuat canvas WebGL benar-benar transparan
  // sehingga video kamera di belakangnya terlihat.
  scene.setAttribute("background", "transparent: true");

  const assets = document.createElement("a-assets");
  assets.setAttribute("timeout", "10000");
  scene.appendChild(assets);

  const camera = document.createElement("a-entity");
  camera.setAttribute("camera", "");
  scene.appendChild(camera);

  scene.addEventListener("camera-error", function (evt) {
    const msg = getCameraError((evt && evt.detail) || evt);
    setStatus(msg, "error");
  });

  host.replaceChildren(scene);
  state.scene = scene;
  return scene;
}

function waitForSceneLoad(scene) {
  return new Promise(function (resolve, reject) {
    if (!window.AFRAME) {
      reject(
        new Error(
          "Library A-Frame gagal dimuat. Periksa koneksi internet atau CDN.",
        ),
      );
      return;
    }

    if (!window.AFRAME.components || !window.AFRAME.components.arjs) {
      reject(
        new Error(
          "Library AR.js gagal dimuat. Periksa koneksi internet atau CDN lalu refresh halaman.",
        ),
      );
      return;
    }

    if (!scene) {
      reject(new Error("Scene AR tidak ditemukan."));
      return;
    }

    if (scene.hasLoaded || scene.renderStarted) return resolve();

    let done = false;
    const timeout = setTimeout(function () {
      if (done) return;
      done = true;
      reject(
        new Error(
          "Scene AR terlalu lama dimuat. Coba refresh halaman dan izinkan kamera.",
        ),
      );
    }, 12000);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve();
    }

    scene.addEventListener("loaded", finish, { once: true });
    scene.addEventListener("renderstart", finish, { once: true });
  });
}

function waitForCameraVideo(timeoutMs) {
  if (timeoutMs === undefined) timeoutMs = 15000;
  return new Promise(function (resolve, reject) {
    const deadline = Date.now() + timeoutMs;
    let done = false;
    let listenerAttached = false;

    function finish(v) {
      if (done) return;
      done = true;
      state.cameraReady = true;
      resolve(v);
    }

    function poll() {
      if (done) return;

      if (Date.now() >= deadline) {
        if (!done) {
          done = true;
          reject(new Error("Timeout menunggu video kamera"));
        }
        return;
      }

      // Dengan videoTexture: true, AR.js memakai video sebagai WebGL texture
      // dan menyembunyikan elemen video-nya. Deteksi lewat dua jalur:
      // 1) video DOM yang masih playing (readyState >= 2, tidak paused)
      // 2) canvas a-scene sudah punya frame (AR.js mulai render kamera)
      const v = document.querySelector("video:not(#camera-preview)");
      if (v) {
        // Video mungkin tersembunyi (display:none) tapi stream tetap aktif
        if (v.readyState >= 2 && v.srcObject) {
          return finish(v);
        }
        if (!listenerAttached) {
          listenerAttached = true;
          v.addEventListener(
            "playing",
            function () {
              finish(v);
            },
            { once: true },
          );
          v.addEventListener(
            "loadeddata",
            function () {
              finish(v);
            },
            { once: true },
          );
        }
      }

      // Fallback: cek apakah canvas a-scene sudah aktif merender kamera
      if (!v && state.scene) {
        const canvas = state.scene.querySelector("canvas");
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          return finish(canvas);
        }
      }

      setTimeout(poll, 300);
    }

    poll();
  });
}

// ─── MARKER & MODEL ─────────────────────────────────────────────────────────
function getMarkerAttrs(cfg) {
  if (cfg.preset) {
    return { preset: cfg.preset };
  }
  if (cfg.type === "barcode") {
    return { type: "barcode", value: String(cfg.value) };
  }
  if (cfg.type === "pattern") {
    return { type: "pattern", url: cfg.patternUrl };
  }
  throw new Error(
    "Marker config tidak valid. Gunakan preset, barcode, atau pattern.",
  );
}

function buildMarkerScene(exp) {
  if (!state.scene) return;

  if (state.markerElement) {
    state.markerElement.remove();
    state.markerElement = null;
    state.modelElement = null;
  }

  const marker = document.createElement("a-marker");
  const attrs = getMarkerAttrs(exp.marker || {});
  Object.entries(attrs).forEach(function (pair) {
    marker.setAttribute(pair[0], pair[1]);
  });

  marker.setAttribute("emitevents", "true");
  marker.setAttribute("smooth", "true");
  marker.setAttribute("smoothCount", 10);
  marker.setAttribute("smoothTolerance", 0.01);
  marker.setAttribute("smoothThreshold", 2);

  const m = exp.model || {};
  const entity = document.createElement("a-entity");
  entity.setAttribute("id", "experience-model");
  entity.setAttribute("gltf-model", "url(" + m.src + ")");
  entity.setAttribute("position", m.position || "0 0.5 0");
  entity.setAttribute("rotation", m.rotation || "0 0 0");
  entity.setAttribute("scale", m.scale || "1 1 1");

  if (m.animationMixer !== false) {
    entity.setAttribute("animation-mixer", "");
  }

  entity.addEventListener("model-loaded", function () {
    setStatus("Model dimuat. Arahkan ke marker.", "success");
  });
  entity.addEventListener("model-error", function () {
    setStatus("Model gagal dimuat.", "error");
  });

  marker.appendChild(entity);
  state.scene.appendChild(marker);

  state.markerElement = marker;
  state.modelElement = entity;
  state.baseScale = parseScaleX(m.scale);
  state.currentScale = state.baseScale;
  state.baseRotationY = parseRotY(m.rotation);
  state.currentRotationY = state.baseRotationY;

  marker.addEventListener("markerFound", function () {
    state.markerVisible = true;
    const ind = qs("#marker-indicator");
    if (ind) ind.classList.add("found");

    if (!state.placed) {
      // Deteksi pertama kali — tandai object sudah "terpasang"
      state.placed = true;
      setStatus("✓ Objek terpasang! Marker bisa dijauhkan.", "success");
    } else {
      setStatus("✓ Marker terdeteksi!", "success");
    }

    autoplayAudio("marker");
  });

  marker.addEventListener("markerLost", function () {
    state.markerVisible = false;
    const ind = qs("#marker-indicator");
    if (ind) ind.classList.remove("found");

    if (state.placed) {
      // Object sudah pernah muncul — override AR.js yang menyembunyikan
      // object saat marker hilang. rAF memastikan override berjalan
      // setelah AR.js selesai set object3D.visible = false.
      requestAnimationFrame(function () {
        if (state.markerElement) {
          state.markerElement.object3D.visible = true;
        }
      });
      setStatus("Objek terpasang di permukaan. ✓", "success");
    } else {
      // Belum pernah terdeteksi sama sekali
      setStatus("Arahkan kamera ke marker.", "");
    }

    if (exp.audio && exp.audio.pauseOnMarkerLost && state.audioElement) {
      state.audioElement.pause();
    }
  });
}

// ─── TRANSFORM ──────────────────────────────────────────────────────────────
function applyTransform() {
  if (!state.modelElement || !state.experience) return;
  const rot = (
    (state.experience.model && state.experience.model.rotation) ||
    "0 0 0"
  ).split(/\s+/);
  const rx = rot[0] || "0";
  const rz = rot[2] || "0";
  const s = state.currentScale;
  state.modelElement.setAttribute("scale", s + " " + s + " " + s);
  state.modelElement.setAttribute(
    "rotation",
    rx + " " + state.currentRotationY + " " + rz,
  );
}

function resetTransform() {
  state.currentScale = state.baseScale;
  state.currentRotationY = state.baseRotationY;
  applyTransform();
}

// ─── AUDIO ──────────────────────────────────────────────────────────────────
function setupAudio(exp) {
  state.audioElement = null;
  const cfg = exp.audio || {};
  if (cfg.src) {
    const audio = new Audio(cfg.src);
    audio.preload = "auto";
    audio.loop = Boolean(cfg.loop);
    audio.volume = typeof cfg.volume === "number" ? cfg.volume : 0.9;
    state.audioElement = audio;
  }
}

function playAudio() {
  const cfg = (state.experience && state.experience.audio) || {};

  if (state.audioElement) {
    state.audioElement.currentTime = 0;
    state.audioElement.play().catch(function (err) {
      setStatus("Audio gagal diputar: " + err.message, "error");
    });
    return;
  }

  if (cfg.speechText && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(cfg.speechText);
    utt.lang = cfg.lang || "id-ID";
    utt.rate = 1;
    utt.pitch = 1;
    utt.onstart = function () {
      state.speechActive = true;
    };
    utt.onend = function () {
      state.speechActive = false;
    };
    utt.onerror = function () {
      state.speechActive = false;
    };
    window.speechSynthesis.speak(utt);
    return;
  }

  setStatus("Experience ini tidak memiliki audio.", "");
}

function toggleAudio() {
  if (state.audioElement) {
    if (state.audioElement.paused) {
      state.audioElement.play().catch(function () {});
    } else {
      state.audioElement.pause();
    }
    return;
  }
  if (state.speechActive) {
    window.speechSynthesis.cancel();
    state.speechActive = false;
    return;
  }
  playAudio();
}

function autoplayAudio(trigger) {
  if (!state.userStarted) return;
  const cfg = (state.experience && state.experience.audio) || {};
  if (trigger === "marker" && cfg.autoplayOnMarker) playAudio();
  if (trigger === "start" && cfg.autoplayOnStart) playAudio();
}

// ─── TOUCH GESTURES ─────────────────────────────────────────────────────────
function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

let lastTapTime = 0;

function bindTouchGestures() {
  const host = qs("#scene-host");
  if (!host) return;

  host.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 2) {
        state.touch.lastDist = touchDistance(e.touches);
      } else if (e.touches.length === 1) {
        state.touch.lastX = e.touches[0].clientX;
        state.touch.lastY = e.touches[0].clientY;
        const now = Date.now();
        if (now - lastTapTime < 300) resetTransform();
        lastTapTime = now;
      }
    },
    { passive: true },
  );

  host.addEventListener(
    "touchmove",
    function (e) {
      if (!state.experience) return;
      const ia = state.experience.interaction || {};
      const min = Number(ia.minScale || 0.4);
      const max = Number(ia.maxScale || 2.4);

      if (e.touches.length === 2 && state.touch.lastDist !== null) {
        const d = touchDistance(e.touches);
        const delta = d - state.touch.lastDist;
        state.currentScale = clamp(
          state.currentScale + delta * 0.006,
          min,
          max,
        );
        state.touch.lastDist = d;
        applyTransform();
      } else if (e.touches.length === 1 && state.touch.lastX !== null) {
        const dx = e.touches[0].clientX - state.touch.lastX;
        state.currentRotationY += dx * 0.45;
        state.touch.lastX = e.touches[0].clientX;
        state.touch.lastY = e.touches[0].clientY;
        applyTransform();
      }
    },
    { passive: true },
  );

  host.addEventListener(
    "touchend",
    function (e) {
      if (e.touches.length < 2) state.touch.lastDist = null;
      if (e.touches.length < 1) {
        state.touch.lastX = null;
        state.touch.lastY = null;
      }
    },
    { passive: true },
  );
}

// ─── ANIMATION LOOP ─────────────────────────────────────────────────────────
function startLoop() {
  function step() {
    const ia = (state.experience && state.experience.interaction) || {};
    if (state.markerVisible && state.modelElement && ia.autoRotate) {
      state.currentRotationY += Number(ia.autoRotateStep || 0.6);
      applyTransform();
    }
    state.rafId = requestAnimationFrame(step);
  }
  state.rafId = requestAnimationFrame(step);
}

// ─── CLEANUP ────────────────────────────────────────────────────────────────
// ─── CAMERA PREVIEW ─────────────────────────────────────────────────────────
// Mulai preview kamera langsung dari getUserMedia ke <video id="camera-preview">
// sebelum AR.js scene dibangun. Membuat layar tidak hitam saat halaman terbuka.
async function startCameraPreview() {
  const preview = qs("#camera-preview");
  if (!preview) return;

  // Butuh konteks aman dan mediaDevices
  if (!window.isSecureContext && location.hostname !== "localhost") return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  // Jangan start ulang jika sudah ada stream
  if (state.previewStream) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // kamera belakang di HP
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    state.previewStream = stream;
    preview.srcObject = stream;

    // Tunggu video siap lalu tampilkan
    await new Promise(function (resolve) {
      preview.onloadedmetadata = resolve;
      // fallback jika event tidak muncul
      setTimeout(resolve, 1500);
    });

    preview.play().catch(function () {});
    preview.classList.remove("hidden");
  } catch (err) {
    // Izin ditolak atau tidak ada kamera — biarkan layar hitam, tidak crash
    console.warn("[preview] Kamera preview gagal:", err.message);
  }
}

// Hentikan preview stream dan sembunyikan elemen video
function stopCameraPreview() {
  if (state.previewStream) {
    state.previewStream.getTracks().forEach(function (track) {
      track.stop();
    });
    state.previewStream = null;
  }

  const preview = qs("#camera-preview");
  if (preview) {
    preview.srcObject = null;
    preview.classList.add("hidden");
  }
}

function cleanup() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
  document.querySelectorAll("video").forEach(function (v) {
    if (v.srcObject) {
      v.srcObject.getTracks().forEach(function (t) {
        t.stop();
      });
      v.srcObject = null;
    }
  });
  if (state.audioElement) {
    state.audioElement.pause();
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  state.cameraReady = false;
}

// ─── UI BINDING ─────────────────────────────────────────────────────────────
function bindUI() {
  // Lifecycle cleanup
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  // ── Toggle info panel ──────────────────────────────────────────────
  const toggleBtn = qs("#toggle-panel");
  const infoPanel = qs("#info-panel");
  if (toggleBtn && infoPanel) {
    toggleBtn.addEventListener("click", function () {
      infoPanel.classList.toggle("collapsed");
      toggleBtn.textContent = infoPanel.classList.contains("collapsed")
        ? "+"
        : "\u2212";
    });
  }

  // ── Audio button ───────────────────────────────────────────────────
  const playAudioBtn = qs("#play-audio");
  if (playAudioBtn) {
    playAudioBtn.addEventListener("click", function () {
      if (state.userStarted) toggleAudio();
    });
  }

  // ── Marker help ────────────────────────────────────────────────────
  const markerHelpBtn = qs("#marker-help");
  if (markerHelpBtn) {
    markerHelpBtn.addEventListener("click", function () {
      const hint =
        (state.experience &&
          state.experience.marker &&
          state.experience.marker.printHint) ||
        "Siapkan marker yang sesuai dan arahkan kamera ke marker tersebut.";
      window.alert(hint);
    });
  }

  // ── Control strip buttons ──────────────────────────────────────────
  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const ia = (state.experience && state.experience.interaction) || {};
      const rotateStep = Number(ia.rotateStep || 15);
      const scaleStep = Number(ia.scaleStep || 0.15);
      const minScale = Number(ia.minScale || 0.4);
      const maxScale = Number(ia.maxScale || 2.4);

      switch (btn.dataset.action) {
        case "rotate-left":
          state.currentRotationY -= rotateStep;
          break;
        case "rotate-right":
          state.currentRotationY += rotateStep;
          break;
        case "scale-down":
          state.currentScale = clamp(
            state.currentScale - scaleStep,
            minScale,
            maxScale,
          );
          break;
        case "scale-up":
          state.currentScale = clamp(
            state.currentScale + scaleStep,
            minScale,
            maxScale,
          );
          break;
        case "reset":
          resetTransform();
          return;
        default:
          return;
      }
      applyTransform();
    });
  });

  // ── Start AR button ────────────────────────────────────────────────
  const startBtn = qs("#start-ar");
  if (!startBtn) return;

  startBtn.addEventListener("click", async function () {
    startBtn.disabled = true;
    const btnLabel = startBtn.querySelector("span:last-child");
    if (btnLabel) btnLabel.textContent = "Memulai\u2026";

    try {
      // Validate context + API availability
      if (!window.isSecureContext) {
        const e = new Error("Bukan konteks aman (non-HTTPS)");
        e.name = "SecurityError";
        throw e;
      }
      if (!navigator.mediaDevices) {
        const e = new Error("navigator.mediaDevices tidak tersedia");
        e.name = "NotSupportedError";
        throw e;
      }

      showLoading("Membangun scene AR\u2026");
      hideBoot();

      if (!window.AFRAME) {
        throw new Error(
          "Library A-Frame gagal dimuat. Pastikan perangkat terhubung internet lalu refresh halaman.",
        );
      }

      if (!window.AFRAME.components || !window.AFRAME.components.arjs) {
        throw new Error(
          "Library AR.js gagal dimuat. Pastikan perangkat terhubung internet lalu refresh halaman.",
        );
      }

      // Lepas preview sebelum AR.js meminta akses kamera. Beberapa browser
      // mobile hanya mengizinkan satu stream kamera aktif per halaman.
      stopCameraPreview();

      const scene = buildScene();
      await waitForSceneLoad(scene);

      buildMarkerScene(state.experience);
      setupAudio(state.experience);
      state.userStarted = true;
      startLoop();
      bindTouchGestures();

      // Reveal HUD
      const hud = qs("#hud");
      if (hud) hud.classList.remove("hidden");

      // Auto-collapse info panel di layar kecil (Android mobile)
      // agar kamera terlihat lebih luas setelah AR aktif
      if (window.innerWidth <= 480) {
        const infoPanel = qs("#info-panel");
        const toggleBtn = qs("#toggle-panel");
        if (infoPanel) infoPanel.classList.add("collapsed");
        if (toggleBtn) toggleBtn.textContent = "+";
      }

      setStatus("Menunggu video kamera\u2026");

      try {
        await waitForCameraVideo(15000);
        // AR.js stream sudah aktif — lepas preview untuk hemat sumber daya
        stopCameraPreview();
        setStatus("Kamera aktif \u2014 arahkan ke marker.", "success");
      } catch (_) {
        // Timeout — dengan videoTexture:true kamera tetap bisa jalan
        // lewat WebGL meski video DOM tidak terdeteksi. Lepas preview juga.
        stopCameraPreview();
        setStatus("Arahkan kamera ke marker.", "");
      }

      hideLoading();
      autoplayAudio("start");
    } catch (err) {
      hideLoading();
      showBoot();
      const msg = getCameraError(err);
      setStatus(msg, "error");
      const btxt = qs("#boot-text");
      if (btxt) btxt.textContent = msg;
    } finally {
      startBtn.disabled = false;
      if (btnLabel) btnLabel.textContent = "Mulai AR";
    }
  });
}

// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────
async function main() {
  try {
    bindUI();
    setStatus("Memuat konfigurasi\u2026");

    state.experience = await fetchExperience();
    setPageCopy(state.experience);
    setStatus("Siap. Tekan Mulai AR.");

    const startBtn = qs("#start-ar");
    if (startBtn) startBtn.disabled = false;

    if (!window.isSecureContext) {
      setStatus(
        "Halaman belum HTTPS/localhost \u2014 kamera tidak dapat diakses.",
        "error",
      );
      if (startBtn) startBtn.disabled = true;
    } else {
      // Mulai preview kamera langsung — layar tidak lagi hitam saat overlay terbuka
      startCameraPreview();
    }
  } catch (err) {
    setStatus(err.message, "error");
    const btxt = qs("#boot-text");
    if (btxt) btxt.textContent = err.message;
  }
}

main();
