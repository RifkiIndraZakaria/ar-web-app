/* ══════════════════════════════════════════════════════════════════════
   ar-experience.js  –  WebXR Markerless AR (A-Frame + ar-hit-test)
   Menggantikan AR.js marker-based dengan WebXR surface tracking.
   Pengguna mengarahkan HP ke lantai/meja → reticle muncul → tap = letakkan objek.
   ES2020 – no classes, no TypeScript
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

// ─── STATE ─────────────────────────────────────────────────────────────────
const state = {
  experience: null,
  scene: null,
  modelEntity: null, // <a-entity> model yang ditempatkan
  reticleEntity: null, // reticle (indikator lantai)
  currentScale: 1,
  baseScale: 1,
  baseRotationY: 0,
  currentRotationY: 0,
  placed: false, // true setelah objek diletakkan
  userStarted: false,
  speechActive: false,
  audioElement: null,
  touch: { lastDist: null, lastX: null, lastY: null },
  xrSession: null,
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

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
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
  const exp = (data.experiences || []).find(function (e) {
    return e.id === id;
  });
  if (!exp) {
    throw new Error(`Experience "${id}" tidak ditemukan dalam data.`);
  }
  return exp;
}

// ─── UI / STATUS ────────────────────────────────────────────────────────────
function setStatus(msg, tone) {
  tone = tone || "";
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

// ─── PERIKSA DUKUNGAN WEBXR ─────────────────────────────────────────────────
async function checkWebXRSupport() {
  if (!window.isSecureContext) {
    throw new Error("Halaman harus dibuka melalui HTTPS atau localhost.");
  }
  if (!navigator.xr) {
    throw new Error(
      "Browser ini tidak mendukung WebXR. Gunakan Chrome 81+ di Android.",
    );
  }
  const supported = await navigator.xr.isSessionSupported("immersive-ar");
  if (!supported) {
    throw new Error(
      "Perangkat ini tidak mendukung WebXR AR. Pastikan ARCore (Android) atau ARKit (iOS) terinstal.",
    );
  }
}

// ─── DAFTAR KOMPONEN AFRAME CUSTOM ─────────────────────────────────────────

/**
 * Komponen ar-hit-test-handler
 * Mengelola reticle dari hit-test WebXR dan penempatan objek saat tap.
 */
function registerARComponents() {
  if (!window.AFRAME) return;

  // Komponen reticle — lingkaran di permukaan yang terdeteksi
  AFRAME.registerComponent("webxr-reticle", {
    schema: {},
    init: function () {
      this.reticleEl = this.el;
      this.el.setAttribute("visible", false);
    },
    show: function (position) {
      this.reticleEl.setAttribute("position", position);
      this.reticleEl.setAttribute("visible", true);
    },
    hide: function () {
      this.reticleEl.setAttribute("visible", false);
    },
  });

  // Komponen utama hit-test
  AFRAME.registerComponent("ar-hit-test-manager", {
    schema: {
      modelSrc: { type: "string", default: "" },
      modelScale: { type: "string", default: "0.8 0.8 0.8" },
      modelRotation: { type: "string", default: "0 0 0" },
      modelPosition: { type: "string", default: "0 0 0" },
      animMixer: { type: "boolean", default: true },
    },

    init: function () {
      const self = this;
      self.hitTestSource = null;
      self.hitTestSourceRequested = false;
      self.reticleEl = null;
      self.modelEl = null;
      self.placed = false;

      // Bangun reticle
      const reticle = document.createElement("a-entity");
      reticle.setAttribute("id", "ar-reticle");
      reticle.setAttribute("geometry", {
        primitive: "ring",
        radiusInner: 0.04,
        radiusOuter: 0.06,
      });
      reticle.setAttribute("material", {
        color: "#f97316",
        shader: "flat",
        side: "double",
        opacity: 0.9,
      });
      reticle.setAttribute("rotation", "-90 0 0");
      reticle.setAttribute("visible", false);
      self.el.sceneEl.appendChild(reticle);
      self.reticleEl = reticle;

      // Animasi pulse pada reticle via A-Frame animation
      reticle.setAttribute("animation__scale", {
        property: "scale",
        from: "1 1 1",
        to: "1.15 1.15 1.15",
        dir: "alternate",
        dur: 700,
        loop: true,
        easing: "easeInOutSine",
      });

      // Bangun entity model (tersembunyi sampai ditempatkan)
      const modelEl = document.createElement("a-entity");
      modelEl.setAttribute("id", "experience-model");
      modelEl.setAttribute("gltf-model", "url(" + self.data.modelSrc + ")");
      modelEl.setAttribute("scale", self.data.modelScale);
      modelEl.setAttribute("rotation", self.data.modelRotation);
      modelEl.setAttribute("visible", false);
      if (self.data.animMixer) {
        modelEl.setAttribute("animation-mixer", "");
      }
      modelEl.addEventListener("model-loaded", function () {
        setStatus(
          "Model dimuat ✓ — Arahkan ke lantai/meja lalu tap untuk meletakkan.",
          "success",
        );
      });
      modelEl.addEventListener("model-error", function () {
        setStatus("Model gagal dimuat.", "error");
      });
      self.el.sceneEl.appendChild(modelEl);
      self.modelEl = modelEl;

      // Simpan referensi ke state global
      state.reticleEntity = reticle;
      state.modelEntity = modelEl;

      // Tap/click = letakkan objek di posisi reticle
      self.el.sceneEl.canvas.addEventListener("click", function () {
        self.onTap();
      });
      self.el.sceneEl.canvas.addEventListener("touchend", function (e) {
        if (e.changedTouches.length === 1) {
          self.onTap();
        }
      });
    },

    onTap: function () {
      if (!this.reticleEl || !this.reticleEl.getAttribute("visible")) return;
      if (!this.modelEl) return;

      const pos = this.reticleEl.getAttribute("position");
      this.modelEl.setAttribute("position", pos);
      this.modelEl.setAttribute("visible", true);

      if (!this.placed) {
        this.placed = true;
        state.placed = true;
        setStatus("✓ Objek berhasil diletakkan!", "success");
        autoplayAudio("marker");

        // Indikator "placed"
        const ind = qs("#marker-indicator");
        if (ind) ind.classList.add("found");
        setTimeout(function () {
          const ind2 = qs("#marker-indicator");
          if (ind2) ind2.classList.remove("found");
        }, 2000);
      } else {
        // Pindahkan objek ke posisi baru
        setStatus("Objek dipindahkan ✓", "success");
      }
    },

    tick: function () {
      const scene = this.el.sceneEl;
      const renderer = scene.renderer;
      if (!renderer) return;

      const xrFrame =
        renderer.xr && renderer.xr.getFrame ? renderer.xr.getFrame() : null;
      if (!xrFrame) return;

      const session = renderer.xr.getSession();
      if (!session) return;

      // Minta hit-test source sekali
      if (!this.hitTestSourceRequested) {
        this.hitTestSourceRequested = true;
        const self = this;
        session
          .requestReferenceSpace("viewer")
          .then(function (refSpace) {
            session
              .requestHitTestSource({ space: refSpace })
              .then(function (src) {
                self.hitTestSource = src;
              })
              .catch(function (err) {
                console.warn(
                  "[ar-hit-test] Gagal request hit test source:",
                  err,
                );
              });
          })
          .catch(function (err) {
            console.warn("[ar-hit-test] Gagal request reference space:", err);
          });

        session.addEventListener("end", function () {
          self.hitTestSourceRequested = false;
          self.hitTestSource = null;
        });
      }

      if (!this.hitTestSource) return;

      const referenceSpace = renderer.xr.getReferenceSpace();
      if (!referenceSpace) return;

      const hitTestResults = xrFrame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) {
          const m = pose.transform.matrix;
          const position = {
            x: m[12],
            y: m[13],
            z: m[14],
          };
          this.reticleEl.setAttribute("position", position);
          this.reticleEl.setAttribute("visible", true);

          if (!this.placed) {
            setStatus(
              "Permukaan terdeteksi — Tap layar untuk meletakkan objek.",
              "success",
            );
          }
        }
      } else {
        if (!this.placed) {
          this.reticleEl.setAttribute("visible", false);
          setStatus("Arahkan kamera ke lantai atau meja yang datar…", "");
        }
      }
    },
  });
}

// ─── SCENE BUILDING ─────────────────────────────────────────────────────────
function buildScene(exp) {
  let host = qs("#scene-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "scene-host";
    document.body.prepend(host);
  }

  const m = exp.model || {};

  const scene = document.createElement("a-scene");
  scene.setAttribute("embedded", "");
  scene.setAttribute("loading-screen", "enabled: false");
  scene.setAttribute("renderer", "antialias: true; alpha: true;");
  scene.setAttribute("vr-mode-ui", "enabled: false");
  scene.setAttribute("background", "transparent: true");

  // WebXR immersive-ar dengan hit-test feature
  scene.setAttribute(
    "webxr",
    "optionalFeatures: hit-test, local-floor; requiredFeatures: hit-test;",
  );

  // Lighting ambient + directional agar model terlihat baik
  const ambient = document.createElement("a-light");
  ambient.setAttribute("type", "ambient");
  ambient.setAttribute("color", "#ffffff");
  ambient.setAttribute("intensity", "0.8");
  scene.appendChild(ambient);

  const dirLight = document.createElement("a-light");
  dirLight.setAttribute("type", "directional");
  dirLight.setAttribute("color", "#ffffff");
  dirLight.setAttribute("intensity", "0.6");
  dirLight.setAttribute("position", "1 3 2");
  scene.appendChild(dirLight);

  // Entity manager untuk hit-test
  const manager = document.createElement("a-entity");
  manager.setAttribute("ar-hit-test-manager", {
    modelSrc: m.src || "",
    modelScale: m.scale || "0.8 0.8 0.8",
    modelRotation: m.rotation || "0 0 0",
    modelPosition: m.position || "0 0 0",
    animMixer: m.animationMixer !== false,
  });
  scene.appendChild(manager);

  host.replaceChildren(scene);
  state.scene = scene;

  // Base values untuk transform
  state.baseScale = parseScaleX(m.scale);
  state.currentScale = state.baseScale;
  state.baseRotationY = parseRotY(m.rotation);
  state.currentRotationY = state.baseRotationY;

  return scene;
}

// ─── TRANSFORM ──────────────────────────────────────────────────────────────
function applyTransform() {
  if (!state.modelEntity || !state.experience) return;
  const rot = (
    (state.experience.model && state.experience.model.rotation) ||
    "0 0 0"
  ).split(/\s+/);
  const rx = rot[0] || "0";
  const rz = rot[2] || "0";
  const s = state.currentScale;
  state.modelEntity.setAttribute("scale", s + " " + s + " " + s);
  state.modelEntity.setAttribute(
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
        if (now - lastTapTime < 300) {
          // Double tap = reset transform
          resetTransform();
        }
        lastTapTime = now;
      }
    },
    { passive: true },
  );

  host.addEventListener(
    "touchmove",
    function (e) {
      if (!state.experience || !state.placed) return;
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

// ─── CLEANUP ────────────────────────────────────────────────────────────────
function cleanup() {
  if (state.audioElement) {
    state.audioElement.pause();
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  // Akhiri sesi WebXR jika masih aktif
  if (state.xrSession) {
    state.xrSession.end().catch(function () {});
    state.xrSession = null;
  }
}

// ─── UI BINDING ─────────────────────────────────────────────────────────────
function bindUI() {
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  // Toggle info panel
  const toggleBtn = qs("#toggle-panel");
  const infoPanel = qs("#info-panel");
  if (toggleBtn && infoPanel) {
    toggleBtn.addEventListener("click", function () {
      infoPanel.classList.toggle("collapsed");
      toggleBtn.textContent = infoPanel.classList.contains("collapsed")
        ? "+"
        : "−";
    });
  }

  // Audio button
  const playAudioBtn = qs("#play-audio");
  if (playAudioBtn) {
    playAudioBtn.addEventListener("click", function () {
      if (state.userStarted) toggleAudio();
    });
  }

  // Info hint button (ganti marker-help jadi placement-hint)
  const markerHelpBtn = qs("#marker-help");
  if (markerHelpBtn) {
    markerHelpBtn.addEventListener("click", function () {
      window.alert(
        "Cara meletakkan objek:\n\n" +
          "1. Arahkan kamera ke lantai atau meja yang datar dan rata.\n" +
          "2. Tunggu hingga lingkaran oranye (reticle) muncul di permukaan.\n" +
          "3. Tap layar untuk meletakkan objek 3D di sana.\n" +
          "4. Tap lagi untuk memindahkan ke tempat lain.\n" +
          "5. Cubit untuk mengubah ukuran, geser untuk memutar.\n" +
          "6. Ketuk dua kali cepat untuk reset ukuran & rotasi.",
      );
    });
  }

  // Control strip
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

  // Start AR button
  const startBtn = qs("#start-ar");
  if (!startBtn) return;

  startBtn.addEventListener("click", async function () {
    startBtn.disabled = true;
    const btnLabel = startBtn.querySelector("span:last-child");
    if (btnLabel) btnLabel.textContent = "Memulai…";

    try {
      showLoading("Memeriksa dukungan WebXR…");
      hideBoot();

      await checkWebXRSupport();

      if (!window.AFRAME) {
        throw new Error(
          "Library A-Frame gagal dimuat. Periksa koneksi internet lalu refresh.",
        );
      }

      registerARComponents();

      showLoading("Membangun scene AR…");
      setStatus("Membangun scene…");
      await sleep(300);

      buildScene(state.experience);
      setupAudio(state.experience);

      state.userStarted = true;
      bindTouchGestures();

      // Tampilkan HUD
      const hud = qs("#hud");
      if (hud) hud.classList.remove("hidden");

      // Auto-collapse panel di HP kecil
      if (window.innerWidth <= 480) {
        const ip = qs("#info-panel");
        const tb = qs("#toggle-panel");
        if (ip) ip.classList.add("collapsed");
        if (tb) tb.textContent = "+";
      }

      // Update gesture hint untuk WebXR
      const gestureHint = qs(".gesture-hint");
      if (gestureHint) {
        gestureHint.textContent =
          "Tap: letakkan  |  Cubit: skala  |  Geser: putar  |  Ketuk 2×: reset";
      }

      hideLoading();
      setStatus("Arahkan kamera ke lantai atau meja…", "");
      autoplayAudio("start");

      // Lacak sesi XR untuk cleanup
      if (state.scene) {
        state.scene.addEventListener("enter-vr", function () {
          const renderer = state.scene.renderer;
          if (renderer && renderer.xr) {
            state.xrSession = renderer.xr.getSession();
          }
        });
      }
    } catch (err) {
      hideLoading();
      showBoot();
      setStatus(err.message, "error");
      const btxt = qs("#boot-text");
      if (btxt) btxt.textContent = err.message;
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
    setStatus("Memuat konfigurasi…");

    state.experience = await fetchExperience();
    setPageCopy(state.experience);

    // Sesuaikan teks boot untuk WebXR
    const bootSteps = document.querySelectorAll(".boot-step");
    const stepDescs = [
      'Tekan "Mulai AR" lalu izinkan akses kamera saat browser meminta.',
      "Arahkan kamera ke lantai atau meja yang datar hingga lingkaran oranye muncul.",
      "Tap layar untuk meletakkan objek 3D. Cubit untuk skala, geser untuk putar.",
    ];
    bootSteps.forEach(function (step, i) {
      const titleEl = step.querySelector(".step-title");
      const descEl = step.querySelector(".step-desc");
      if (i === 0 && titleEl) titleEl.textContent = "Izinkan Kamera";
      if (i === 1 && titleEl) titleEl.textContent = "Arahkan ke Permukaan";
      if (i === 2 && titleEl) titleEl.textContent = "Tap untuk Meletakkan";
      if (descEl && stepDescs[i]) descEl.textContent = stepDescs[i];
    });

    const startBtn = qs("#start-ar");

    if (!window.isSecureContext) {
      setStatus(
        "Halaman belum HTTPS/localhost — kamera tidak dapat diakses.",
        "error",
      );
      if (startBtn) startBtn.disabled = true;
    } else if (!navigator.xr) {
      setStatus(
        "Browser tidak mendukung WebXR. Gunakan Chrome di Android.",
        "error",
      );
      if (startBtn) {
        startBtn.disabled = true;
        const lbl = startBtn.querySelector("span:last-child");
        if (lbl) lbl.textContent = "Tidak Didukung";
      }
      const btxt = qs("#boot-text");
      if (btxt)
        btxt.textContent =
          "WebXR AR hanya tersedia di Chrome 81+ pada perangkat Android yang mendukung ARCore, atau Safari 15.4+ pada iPhone/iPad dengan ARKit.";
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
