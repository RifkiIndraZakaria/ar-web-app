/* ══════════════════════════════════════════════════════════════════════
   ar-experience.js  –  Markerless AR (Improved Precision)
   STRATEGI: getUserMedia → <video> background + A-Frame di atasnya
   WebXR hit-test dengan Smoothing & Normal Alignment
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
  useWebXR: false,
  // State tambahan untuk presisi
  lastHitPose: null,
  targetReticlePos: new THREE.Vector3(),
  currentReticlePos: new THREE.Vector3(),
  targetReticleQuat: new THREE.Quaternion(),
  currentReticleQuat: new THREE.Quaternion(),
  smoothingFactor: 0.15, // Semakin kecil semakin halus, tapi sedikit delay
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

function getExperienceId() {
  return (
    new URLSearchParams(window.location.search).get("experience") || "demo-hiro"
  );
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
    setTimeout(resolve, 2000);
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

// ─── WEBXR HIT-TEST ─────────────────────────────────────────────────────────
async function tryStartWebXRHitTest(scene) {
  try {
    if (!navigator.xr) return false;
    const supported = await navigator.xr.isSessionSupported("immersive-ar");
    if (!supported) return false;

    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["local-floor"],
    });

    state.xrSession = session;

    const renderer = scene.renderer;
    if (renderer && renderer.xr) {
      renderer.xr.enabled = true;
      await renderer.xr.setSession(session);
    }

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
    console.warn("[WebXR hit-test] Fallback active:", err.message);
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

      // ── Reticle (Improved Design) ──
      const reticle = document.createElement("a-entity");
      reticle.setAttribute("id", "reticle");

      // Ring luar
      const ring = document.createElement("a-ring");
      ring.setAttribute("radius-inner", "0.06");
      ring.setAttribute("radius-outer", "0.08");
      ring.setAttribute(
        "material",
        "color: #f97316; shader: flat; opacity: 0.8",
      );
      ring.setAttribute("rotation", "-90 0 0");
      reticle.appendChild(ring);

      // Titik tengah untuk presisi
      const dot = document.createElement("a-circle");
      dot.setAttribute("radius", "0.01");
      dot.setAttribute(
        "material",
        "color: #ffffff; shader: flat; opacity: 0.9",
      );
      dot.setAttribute("rotation", "-90 0 0");
      reticle.appendChild(dot);

      reticle.setAttribute("visible", "false");
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
        setStatus(
          state.useWebXR
            ? "Model dimuat ✓ — Arahkan ke lantai lalu tap."
            : "Model dimuat ✓ — Tap layar untuk meletakkan.",
          "success",
        );
      });

      self.el.sceneEl.appendChild(model);
      self.modelEl = model;
      state.modelEntity = model;

      self.el.sceneEl.addEventListener("click", function () {
        self.handleTap();
      });
    },

    handleTap: function () {
      if (!this.modelEl) return;

      let pos, rot;
      if (
        state.useWebXR &&
        this.reticleEl &&
        this.reticleEl.getAttribute("visible")
      ) {
        // Gunakan posisi dan rotasi reticle yang sudah di-smooth
        pos = this.reticleEl.object3D.position.clone();
        rot = this.reticleEl.object3D.rotation.clone();
      } else if (!state.useWebXR) {
        pos = { x: 0, y: -1, z: -1.5 };
        rot = { x: 0, y: 0, z: 0 };
      } else {
        return;
      }

      this.modelEl.object3D.position.copy(pos);
      // Simpan rotasi permukaan tapi tetap izinkan rotasi manual user di Y
      this.modelEl.object3D.rotation.set(
        rot.x,
        state.currentRotationY * (Math.PI / 180),
        rot.z,
      );
      this.modelEl.setAttribute("visible", "true");

      if (!this.placed) {
        this.placed = true;
        state.placed = true;
        setStatus("✓ Objek diletakkan! Tap lagi untuk pindahkan.", "success");
        autoplayAudio("marker");

        const ind = qs("#marker-indicator");
        if (ind) {
          ind.classList.add("found");
          setTimeout(() => ind.classList.remove("found"), 2000);
        }
      } else {
        setStatus("Objek dipindahkan ✓", "success");
      }
    },

    tick: function () {
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
          // Update target dari hit-test mentah
          state.targetReticlePos.set(
            pose.transform.position.x,
            pose.transform.position.y,
            pose.transform.position.z,
          );
          state.targetReticleQuat.set(
            pose.transform.orientation.x,
            pose.transform.orientation.y,
            pose.transform.orientation.z,
            pose.transform.orientation.w,
          );

          // Linear Interpolation (Lerp) untuk pergerakan halus
          state.currentReticlePos.lerp(
            state.targetReticlePos,
            state.smoothingFactor,
          );
          state.currentReticleQuat.slerp(
            state.targetReticleQuat,
            state.smoothingFactor,
          );

          // Terapkan ke elemen reticle
          this.reticleEl.object3D.position.copy(state.currentReticlePos);
          this.reticleEl.object3D.quaternion.copy(state.currentReticleQuat);
          this.reticleEl.setAttribute("visible", "true");
        }
      } else {
        // Jika hit-test hilang sementara, jangan langsung sembunyikan (stability)
        // Kita biarkan reticle di posisi terakhir namun sedikit transparan
        if (!this.placed) {
          const material = this.reticleEl
            .querySelector("a-ring")
            .getAttribute("material");
          // Anda bisa menambahkan logika fade-out di sini jika diinginkan
        }
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
  scene.setAttribute("embedded", "");
  scene.setAttribute("loading-screen", "enabled: false");
  scene.setAttribute(
    "renderer",
    "antialias: true; alpha: true; premultipliedAlpha: false; colorManagement: true;",
  );
  scene.setAttribute("vr-mode-ui", "enabled: false");
  scene.setAttribute("background", "color: transparent; transparent: true");

  const ambient = document.createElement("a-light");
  ambient.setAttribute("type", "ambient");
  ambient.setAttribute("intensity", "1.2");
  scene.appendChild(ambient);

  const dir = document.createElement("a-light");
  dir.setAttribute("type", "directional");
  dir.setAttribute("intensity", "0.9");
  dir.setAttribute("position", "1 3 2");
  dir.setAttribute("castShadow", "true");
  scene.appendChild(dir);

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
  const s = state.currentScale;
  state.modelEntity.object3D.scale.set(s, s, s);
  state.modelEntity.object3D.rotation.y =
    state.currentRotationY * (Math.PI / 180);
}

function resetTransform() {
  state.currentScale = state.baseScale;
  state.currentRotationY = state.baseRotationY;
  applyTransform();
}

// ─── AUDIO & GESTURES (Keep as is but optimized) ──────────────────────────────
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
    state.audioElement.play().catch(() => {});
    return;
  }
  if (cfg.speechText && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(cfg.speechText);
    utt.lang = cfg.lang || "id-ID";
    window.speechSynthesis.speak(utt);
  }
}

function toggleAudio() {
  if (state.audioElement) {
    state.audioElement.paused
      ? state.audioElement.play().catch(() => {})
      : state.audioElement.pause();
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

function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}
let lastTapTime = 0;

function bindTouchGestures() {
  const overlay = qs("#touch-overlay");
  if (!overlay) return;

  overlay.addEventListener(
    "touchstart",
    (e) => {
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
    (e) => {
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

  overlay.addEventListener("click", () => {
    if (state.scene)
      state.scene.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function cleanup() {
  stopCameraBackground();
  if (state.audioElement) state.audioElement.pause();
  if (state.xrSession) state.xrSession.end().catch(() => {});
}

function bindUI() {
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  qs("#toggle-panel")?.addEventListener("click", () => {
    const ip = qs("#info-panel");
    ip.classList.toggle("collapsed");
    qs("#toggle-panel").textContent = ip.classList.contains("collapsed")
      ? "+"
      : "−";
  });

  qs("#play-audio")?.addEventListener("click", () => {
    if (state.userStarted) toggleAudio();
  });

  qs("#marker-help")?.addEventListener("click", () => {
    window.alert(
      "Cara pakai AR Markerless:\n\n1. Arahkan ke lantai/meja rata.\n2. Tunggu lingkaran muncul.\n3. Tap untuk letakkan.\n4. Geser/Cubit untuk rotasi/skala.",
    );
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ia = state.experience?.interaction || {};
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
      }
      applyTransform();
    });
  });

  const startBtn = qs("#start-ar");
  startBtn?.addEventListener("click", async () => {
    startBtn.disabled = true;
    try {
      showLoading("Mengakses kamera…");
      hideBoot();
      await startCameraBackground();
      registerARComponents();
      const scene = buildScene(state.experience);
      setupAudio(state.experience);
      qs("#hud")?.classList.remove("hidden");
      qs("#touch-overlay")?.classList.remove("hidden");
      state.userStarted = true;
      bindTouchGestures();
      hideLoading();
      setStatus("Kamera aktif — tap layar untuk meletakkan objek.", "success");
      setTimeout(async () => {
        state.useWebXR = await tryStartWebXRHitTest(scene);
        if (state.useWebXR)
          setStatus("WebXR aktif — arahkan ke lantai lalu tap.", "success");
      }, 500);
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      startBtn.disabled = false;
    }
  });
}

async function main() {
  try {
    bindUI();
    state.experience = await fetchExperience();
    setPageCopy(state.experience);
    setStatus(
      window.isSecureContext ? "Siap. Tekan Mulai AR." : "HTTPS diperlukan.",
      window.isSecureContext ? "" : "error",
    );
  } catch (err) {
    setStatus(err.message, "error");
  }
}

main();
