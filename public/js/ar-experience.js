/* ══════════════════════════════════════════════════════════════════════
   ar-experience.js  –  Markerless AR
   STRATEGI: getUserMedia → <video> background + A-Frame di atasnya
   Kamera SELALU terlihat karena ditampilkan via <video> DOM biasa.
   WebXR hit-test dipakai jika tersedia; fallback ke mode "letakkan di
   pusat" jika tidak.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

const state = {
  experience: null,
  scene: null,
  modelEntity: null,
  reticleEntity: null,
  cameraStream: null,
  currentScale: 1,
  baseScale: 1,
  baseRotationY: 0,
  currentRotationY: 0,
  placed: false,
  userStarted: false,
  speechActive: false,
  audioElement: null,
  touch: { lastDist: null, lastX: null },
  xrSession: null,
  hitTestSource: null,
  useWebXR: false, // true jika WebXR hit-test berhasil
};

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
  const p = (s || "0 0 0").split(/\s+/).map(Number);
  return p[1] || 0;
}
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function getExperienceId() {
  return (
    new URLSearchParams(window.location.search).get("experience") || "demo-hiro"
  );
}

async function fetchExperience() {
  const res = await fetch("data/experiences.json", { cache: "no-store" });
  if (!res.ok)
    throw new Error("Gagal memuat experiences.json (HTTP " + res.status + ")");
  const data = await res.json();
  const exp = (data.experiences || []).find(function (e) {
    return e.id === getExperienceId();
  });
  if (!exp) throw new Error("Experience tidak ditemukan.");
  return exp;
}

// ─── STATUS & UI HELPERS ─────────────────────────────────────────────────────
function setStatus(msg, tone) {
  tone = tone || "";
  const pill = qs("#status-line");
  if (!pill) return;
  pill.className = ["status-pill", tone].filter(Boolean).join(" ");
  const t = pill.querySelector(".status-text");
  if (t) t.textContent = msg;
}

function setPageCopy(exp) {
  document.title = exp.title + " | AR";
  [
    ["#boot-title", exp.title],
    ["#experience-title", exp.title],
    ["#experience-description", exp.description || ""],
    ["#boot-text", exp.bootText || "Tekan Mulai AR untuk memulai."],
  ].forEach(function (pair) {
    const el = qs(pair[0]);
    if (el) el.textContent = pair[1];
  });
}

function showLoading(msg) {
  const o = qs("#loading-overlay");
  if (o) o.classList.remove("hidden");
  const t = qs("#loading-text");
  if (t) t.textContent = msg || "Memuat…";
}
function hideLoading() {
  const o = qs("#loading-overlay");
  if (o) o.classList.add("hidden");
}
function showBoot() {
  const o = qs("#boot-overlay");
  if (o) o.classList.remove("hidden");
}
function hideBoot() {
  const o = qs("#boot-overlay");
  if (o) o.classList.add("hidden");
}

// ─── KAMERA VIDEO BACKGROUND ─────────────────────────────────────────────────
// Tampilkan feed kamera langsung ke elemen <video id="camera-bg">
// Ini SELALU bekerja karena hanya pakai getUserMedia biasa, bukan WebXR.
async function startCameraBackground() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
      "Browser tidak mendukung getUserMedia. Gunakan Chrome terbaru.",
    );
  }

  const video = qs("#camera-bg");
  if (!video) throw new Error("Elemen video kamera tidak ditemukan.");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  state.cameraStream = stream;
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");

  await new Promise(function (resolve) {
    video.onloadedmetadata = resolve;
    setTimeout(resolve, 2000); // fallback
  });

  await video.play().catch(function () {});
  video.classList.remove("hidden");
}

function stopCameraBackground() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(function (t) {
      t.stop();
    });
    state.cameraStream = null;
  }
  const video = qs("#camera-bg");
  if (video) {
    video.srcObject = null;
    video.classList.add("hidden");
  }
}

// ─── WEBXR HIT-TEST (OPSIONAL) ───────────────────────────────────────────────
// Digunakan hanya jika perangkat mendukung. Jika tidak, pakai fallback
// "letakkan di pusat layar" sehingga tetap bisa digunakan.
async function tryStartWebXRHitTest(scene) {
  try {
    if (!navigator.xr) return false;
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    if (!supported) return false;

    // Minta sesi AR — ini TIDAK mengubah tampilan kamera
    // (kita sudah punya video background), hanya dipakai untuk hit-test
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["local-floor"],
    });

    state.xrSession = session;

    // Hubungkan sesi ke renderer A-Frame
    const renderer = scene.renderer;
    if (renderer && renderer.xr) {
      renderer.xr.enabled = true;
      await renderer.xr.setSession(session);
    }

    // Setup hit-test source
    const viewerSpace = await session.requestReferenceSpace("viewer");
    state.hitTestSource = await session.requestHitTestSource({
      space: viewerSpace,
    });

    session.addEventListener("end", function () {
      state.hitTestSource = null;
      state.xrSession = null;
    });

    return true;
  } catch (err) {
    console.warn(
      "[WebXR hit-test] Tidak tersedia, pakai fallback:",
      err.message,
    );
    return false;
  }
}

// ─── REGISTER KOMPONEN AFRAME ────────────────────────────────────────────────
function registerARComponents() {
  if (!window.AFRAME || AFRAME.components["ar-placement-manager"]) return;

  AFRAME.registerComponent("ar-placement-manager", {
    schema: {
      modelSrc: { type: "string", default: "" },
      modelScale: { type: "string", default: "0.8 0.8 0.8" },
      modelRotation: { type: "string", default: "0 0 0" },
      animMixer: { type: "boolean", default: true },
    },

    init: function () {
      const self = this;

      // ── Reticle (hanya tampil di mode WebXR hit-test) ──
      const reticle = document.createElement("a-entity");
      reticle.setAttribute(
        "geometry",
        "primitive:ring; radiusInner:0.05; radiusOuter:0.08; segmentsTheta:32",
      );
      reticle.setAttribute(
        "material",
        "color:#f97316; shader:flat; side:double; opacity:0.9",
      );
      reticle.setAttribute("rotation", "-90 0 0");
      reticle.setAttribute("visible", "false");
      reticle.setAttribute(
        "animation__pulse",
        "property:scale;from:1 1 1;to:1.2 1.2 1.2;dir:alternate;dur:600;loop:true;easing:easeInOutSine",
      );
      self.el.sceneEl.appendChild(reticle);
      self.reticleEl = reticle;
      state.reticleEntity = reticle;

      // ── Model ──
      const model = document.createElement("a-entity");
      model.setAttribute("id", "experience-model");
      model.setAttribute("gltf-model", "url(" + self.data.modelSrc + ")");
      model.setAttribute("scale", self.data.modelScale);
      model.setAttribute("rotation", self.data.modelRotation);
      model.setAttribute("visible", "false");
      if (self.data.animMixer) model.setAttribute("animation-mixer", "");
      model.addEventListener("model-loaded", function () {
        if (state.useWebXR) {
          setStatus(
            "Model dimuat ✓ — Arahkan kamera ke lantai lalu tap.",
            "success",
          );
        } else {
          setStatus(
            "Model dimuat ✓ — Tap layar untuk meletakkan objek.",
            "success",
          );
        }
      });
      model.addEventListener("model-error", function () {
        setStatus("Model gagal dimuat. Periksa koneksi internet.", "error");
      });
      self.el.sceneEl.appendChild(model);
      self.modelEl = model;
      state.modelEntity = model;

      // Saat tap/klik — letakkan atau pindahkan objek
      self.el.sceneEl.addEventListener("click", function () {
        self.handleTap();
      });
    },

    handleTap: function () {
      if (!this.modelEl) return;

      let pos;
      if (
        state.useWebXR &&
        this.reticleEl &&
        this.reticleEl.getAttribute("visible")
      ) {
        // Pakai posisi reticle dari hit-test
        pos = this.reticleEl.getAttribute("position");
      } else if (!state.useWebXR) {
        // Fallback: letakkan di depan kamera (1.5 meter)
        pos = { x: 0, y: -1, z: -1.5 };
      } else {
        return; // WebXR mode tapi reticle belum muncul
      }

      if (!pos) return;
      this.modelEl.setAttribute("position", pos);
      this.modelEl.setAttribute("visible", "true");

      if (!this.placed) {
        this.placed = true;
        state.placed = true;
        setStatus("✓ Objek diletakkan! Tap lagi untuk pindahkan.", "success");
        autoplayAudio("marker");

        const ind = qs("#marker-indicator");
        if (ind) {
          ind.classList.add("found");
          setTimeout(function () {
            ind.classList.remove("found");
          }, 2000);
        }
      } else {
        setStatus("Objek dipindahkan ✓", "success");
      }
    },

    tick: function () {
      // Hanya jalankan hit-test jika WebXR aktif
      if (!state.useWebXR || !state.hitTestSource) return;

      const renderer = this.el.sceneEl.renderer;
      if (!renderer || !renderer.xr) return;

      const xrFrame = renderer.xr.getFrame ? renderer.xr.getFrame() : null;
      if (!xrFrame) return;

      const refSpace = renderer.xr.getReferenceSpace();
      if (!refSpace) return;

      const results = xrFrame.getHitTestResults(state.hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          const m = pose.transform.matrix;
          this.reticleEl.setAttribute("position", {
            x: m[12],
            y: m[13],
            z: m[14],
          });
          this.reticleEl.setAttribute("visible", "true");
        }
      } else {
        if (!this.placed) this.reticleEl.setAttribute("visible", "false");
      }
    },
  });
}

// ─── BANGUN SCENE AFRAME ─────────────────────────────────────────────────────
function buildScene(exp) {
  let host = qs("#scene-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "scene-host";
    document.body.appendChild(host);
  }

  const m = exp.model || {};
  const scene = document.createElement("a-scene");

  // embedded: scene mengikuti ukuran host div, bukan fullscreen
  scene.setAttribute("embedded", "");
  scene.setAttribute("loading-screen", "enabled: false");

  // alpha:true → canvas WebGL transparan → video background terlihat
  scene.setAttribute(
    "renderer",
    "antialias: true; alpha: true; premultipliedAlpha: false",
  );
  scene.setAttribute("vr-mode-ui", "enabled: false");
  scene.setAttribute("background", "color: transparent; transparent: true");

  // Pencahayaan
  const ambient = document.createElement("a-light");
  ambient.setAttribute("type", "ambient");
  ambient.setAttribute("intensity", "1.2");
  scene.appendChild(ambient);

  const dir = document.createElement("a-light");
  dir.setAttribute("type", "directional");
  dir.setAttribute("intensity", "0.9");
  dir.setAttribute("position", "1 3 2");
  scene.appendChild(dir);

  // Placement manager
  const manager = document.createElement("a-entity");
  manager.setAttribute("ar-placement-manager", {
    modelSrc: m.src || "",
    modelScale: m.scale || "0.8 0.8 0.8",
    modelRotation: m.rotation || "0 0 0",
    animMixer: m.animationMixer !== false,
  });
  scene.appendChild(manager);

  host.replaceChildren(scene);
  state.scene = scene;
  state.baseScale = parseScaleX(m.scale);
  state.currentScale = state.baseScale;
  state.baseRotationY = parseRotY(m.rotation);
  state.currentRotationY = state.baseRotationY;

  return scene;
}

// ─── TRANSFORM ───────────────────────────────────────────────────────────────
function applyTransform() {
  if (!state.modelEntity || !state.experience) return;
  const rot = (
    (state.experience.model && state.experience.model.rotation) ||
    "0 0 0"
  ).split(/\s+/);
  const s = state.currentScale;
  state.modelEntity.setAttribute("scale", s + " " + s + " " + s);
  state.modelEntity.setAttribute(
    "rotation",
    (rot[0] || "0") + " " + state.currentRotationY + " " + (rot[2] || "0"),
  );
}

function resetTransform() {
  state.currentScale = state.baseScale;
  state.currentRotationY = state.baseRotationY;
  applyTransform();
}

// ─── AUDIO ────────────────────────────────────────────────────────────────────
function setupAudio(exp) {
  state.audioElement = null;
  const cfg = exp.audio || {};
  if (cfg.src) {
    const a = new Audio(cfg.src);
    a.preload = "auto";
    a.loop = Boolean(cfg.loop);
    a.volume = typeof cfg.volume === "number" ? cfg.volume : 0.9;
    state.audioElement = a;
  }
}

function playAudio() {
  const cfg = (state.experience && state.experience.audio) || {};
  if (state.audioElement) {
    state.audioElement.currentTime = 0;
    state.audioElement.play().catch(function () {});
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
    utt.onend = utt.onerror = function () {
      state.speechActive = false;
    };
    window.speechSynthesis.speak(utt);
  }
}

function toggleAudio() {
  if (state.audioElement) {
    state.audioElement.paused
      ? state.audioElement.play().catch(function () {})
      : state.audioElement.pause();
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

// ─── GESTUR SENTUH ───────────────────────────────────────────────────────────
function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}
let lastTapTime = 0;

function bindTouchGestures() {
  const overlay = qs("#touch-overlay");
  if (!overlay) return;

  overlay.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 2) {
        state.touch.lastDist = touchDist(e.touches);
      } else if (e.touches.length === 1) {
        state.touch.lastX = e.touches[0].clientX;
        const now = Date.now();
        if (now - lastTapTime < 300) resetTransform();
        lastTapTime = now;
      }
    },
    { passive: true },
  );

  overlay.addEventListener(
    "touchmove",
    function (e) {
      if (!state.experience || !state.placed) return;
      const ia = state.experience.interaction || {};
      const min = Number(ia.minScale || 0.4),
        max = Number(ia.maxScale || 2.4);
      if (e.touches.length === 2 && state.touch.lastDist !== null) {
        const d = touchDist(e.touches);
        state.currentScale = clamp(
          state.currentScale + (d - state.touch.lastDist) * 0.006,
          min,
          max,
        );
        state.touch.lastDist = d;
        applyTransform();
      } else if (e.touches.length === 1 && state.touch.lastX !== null) {
        state.currentRotationY +=
          (e.touches[0].clientX - state.touch.lastX) * 0.45;
        state.touch.lastX = e.touches[0].clientX;
        applyTransform();
      }
    },
    { passive: true },
  );

  overlay.addEventListener(
    "touchend",
    function (e) {
      if (e.touches.length < 2) state.touch.lastDist = null;
      if (e.touches.length < 1) state.touch.lastX = null;
    },
    { passive: true },
  );

  // Tap untuk meletakkan — forward ke scene
  overlay.addEventListener("click", function () {
    const sceneEl = state.scene;
    if (sceneEl)
      sceneEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ─── CLEANUP ──────────────────────────────────────────────────────────────────
function cleanup() {
  stopCameraBackground();
  if (state.audioElement) state.audioElement.pause();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (state.xrSession) {
    state.xrSession.end().catch(function () {});
    state.xrSession = null;
  }
}

// ─── UI BINDING ───────────────────────────────────────────────────────────────
function bindUI() {
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  const toggleBtn = qs("#toggle-panel"),
    infoPanel = qs("#info-panel");
  if (toggleBtn && infoPanel) {
    toggleBtn.addEventListener("click", function () {
      infoPanel.classList.toggle("collapsed");
      toggleBtn.textContent = infoPanel.classList.contains("collapsed")
        ? "+"
        : "−";
    });
  }

  const playAudioBtn = qs("#play-audio");
  if (playAudioBtn)
    playAudioBtn.addEventListener("click", function () {
      if (state.userStarted) toggleAudio();
    });

  const helpBtn = qs("#marker-help");
  if (helpBtn)
    helpBtn.addEventListener("click", function () {
      window.alert(
        "Cara pakai AR Markerless:\n\n" +
          "1. Arahkan kamera ke lantai atau meja yang rata.\n" +
          "2. Tunggu lingkaran oranye muncul (hanya di mode WebXR).\n" +
          "3. Tap layar untuk meletakkan objek 3D.\n" +
          "4. Tap lagi untuk memindahkan objek.\n" +
          "5. Cubit = ubah ukuran.\n" +
          "6. Geser = putar objek.\n" +
          "7. Ketuk 2x cepat = reset ukuran & rotasi.",
      );
    });

  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const ia = (state.experience && state.experience.interaction) || {};
      const rot = Number(ia.rotateStep || 15),
        scl = Number(ia.scaleStep || 0.15);
      const min = Number(ia.minScale || 0.4),
        max = Number(ia.maxScale || 2.4);
      switch (btn.dataset.action) {
        case "rotate-left":
          state.currentRotationY -= rot;
          break;
        case "rotate-right":
          state.currentRotationY += rot;
          break;
        case "scale-down":
          state.currentScale = clamp(state.currentScale - scl, min, max);
          break;
        case "scale-up":
          state.currentScale = clamp(state.currentScale + scl, min, max);
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

  // ── Tombol Mulai AR ────────────────────────────────────────────────────────
  const startBtn = qs("#start-ar");
  if (!startBtn) return;

  startBtn.addEventListener("click", async function () {
    startBtn.disabled = true;
    const lbl = startBtn.querySelector("span:last-child");
    if (lbl) lbl.textContent = "Memulai…";

    try {
      if (!window.isSecureContext)
        throw new Error(
          "Halaman harus HTTPS. Buka melalui GitHub Pages atau server HTTPS.",
        );
      if (!navigator.mediaDevices)
        throw new Error(
          "Browser tidak mendukung kamera. Gunakan Chrome terbaru.",
        );
      if (!window.AFRAME)
        throw new Error("Library A-Frame gagal dimuat. Refresh halaman.");

      showLoading("Mengakses kamera…");
      hideBoot();

      // 1. Nyalakan video kamera sebagai background — ini SELALU berhasil
      await startCameraBackground();

      showLoading("Membangun scene 3D…");

      // 2. Daftarkan komponen & bangun scene
      registerARComponents();
      await sleep(100);

      const scene = buildScene(state.experience);
      setupAudio(state.experience);

      // 3. Tampilkan HUD & kontrol
      const hud = qs("#hud");
      if (hud) hud.classList.remove("hidden");

      const touchOverlay = qs("#touch-overlay");
      if (touchOverlay) touchOverlay.classList.remove("hidden");

      if (window.innerWidth <= 480) {
        const ip = qs("#info-panel"),
          tb = qs("#toggle-panel");
        if (ip) ip.classList.add("collapsed");
        if (tb) tb.textContent = "+";
      }

      state.userStarted = true;
      bindTouchGestures();

      hideLoading();
      setStatus("Kamera aktif — tap layar untuk meletakkan objek.", "success");
      autoplayAudio("start");

      // 4. Coba aktifkan WebXR hit-test (opsional, tidak wajib)
      //    Ini dijalankan di background, tidak memblokir UI
      setTimeout(async function () {
        const ok = await tryStartWebXRHitTest(scene);
        state.useWebXR = ok;
        if (ok) {
          setStatus("WebXR aktif — arahkan ke lantai lalu tap.", "success");
        }
        // Jika tidak tersedia, mode fallback sudah aktif → tidak perlu pesan error
      }, 500);
    } catch (err) {
      hideLoading();
      showBoot();
      stopCameraBackground();
      setStatus(err.message, "error");
      const btxt = qs("#boot-text");
      if (btxt) btxt.textContent = err.message;
    } finally {
      startBtn.disabled = false;
      if (lbl) lbl.textContent = "Mulai AR";
    }
  });
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────
async function main() {
  try {
    bindUI();
    setStatus("Memuat konfigurasi…");
    state.experience = await fetchExperience();
    setPageCopy(state.experience);

    const startBtn = qs("#start-ar");
    if (!window.isSecureContext) {
      setStatus("Halaman belum HTTPS — kamera tidak bisa diakses.", "error");
      if (startBtn) startBtn.disabled = true;
    } else {
      setStatus("Siap. Tekan Mulai AR.");
      if (startBtn) startBtn.disabled = false;
    }
  } catch (err) {
    setStatus(err.message, "error");
    const btxt = qs("#boot-text");
    if (btxt) btxt.textContent = err.message;
  }
}

main();
