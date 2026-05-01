/* ══════════════════════════════════════════════════════════════════════
   ar-experience.js  — Markerless WebAR  (Zapworks-level features)
   ──────────────────────────────────────────────────────────────────────
   FITUR:
   ✅ getUserMedia video background (kamera selalu terlihat)
   ✅ Drop shadow di bawah objek
   ✅ Particle burst saat objek diletakkan
   ✅ Auto-rotate (dari experiences.json)
   ✅ Multi-scene / ganti model tanpa reload
   ✅ Hotspot / annotation label melayang
   ✅ Screenshot (capture kamera + 3D)
   ✅ Web Share API
   ✅ Gyroscope orbit + virtual orbit
   ✅ Surface confidence detector
   ✅ WebXR hit-test (jika perangkat mendukung)
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
  experience: null,
  allExperiences: [],
  scene: null,
  modelEntity: null,
  shadowEntity: null,
  reticleEntity: null,
  cameraStream: null,
  baseScale: 1,
  placed: false,
  userStarted: false,
  speechActive: false,
  audioElement: null,
  xrSession: null,
  hitTestSource: null,
  xrReferenceSpace: null,
  xrReferenceSpaceType: "local",
  useWebXR: false,
  latestHitPosition: null,
  placedWorldPos: null,
  cameraEntity: null,
  surfaceUIInterval: null,
};

// ─── UTILS ───────────────────────────────────────────────────────────────────
const qs = (s) => document.querySelector(s);
const qsa = (s) => document.querySelectorAll(s);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseScaleX = (s) => {
  const n = Number((s || "1 1 1").split(/\s+/)[0]);
  return isNaN(n) || n === 0 ? 1 : n;
};
const parseRotY = (s) => {
  const p = (s || "0 0 0").split(/\s+/).map(Number);
  return p[1] || 0;
};
const degToRad = (d) => (d * Math.PI) / 180;

function getExperienceId() {
  return (
    new URLSearchParams(window.location.search).get("experience") || "demo-hiro"
  );
}

// ─── DATA ────────────────────────────────────────────────────────────────────
async function fetchExperiences() {
  const res = await fetch("data/experiences.json", { cache: "no-store" });
  if (!res.ok)
    throw new Error("Gagal memuat experiences.json (HTTP " + res.status + ")");
  const data = await res.json();
  state.allExperiences = data.experiences || [];
  const id = getExperienceId();
  const exp = state.allExperiences.find((e) => e.id === id);
  if (!exp) throw new Error('Experience "' + id + '" tidak ditemukan.');
  return exp;
}

// ─── STATUS & UI ─────────────────────────────────────────────────────────────
function setStatus(msg, tone) {
  const pill = qs("#status-line");
  if (!pill) return;
  pill.className = ["status-pill", tone || ""].filter(Boolean).join(" ");
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
  ].forEach(([sel, val]) => {
    const el = qs(sel);
    if (el) el.textContent = val;
  });
}

const showLoading = (msg) => {
  const o = qs("#loading-overlay");
  if (o) o.classList.remove("hidden");
  const t = qs("#loading-text");
  if (t) t.textContent = msg || "Memuat…";
};
const hideLoading = () => {
  const o = qs("#loading-overlay");
  if (o) o.classList.add("hidden");
};
const showBoot = () => {
  const o = qs("#boot-overlay");
  if (o) o.classList.remove("hidden");
};
const hideBoot = () => {
  const o = qs("#boot-overlay");
  if (o) o.classList.add("hidden");
};

// ─── KAMERA BACKGROUND ───────────────────────────────────────────────────────
async function startCameraBackground() {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("Browser tidak mendukung kamera.");
  const video = qs("#camera-bg");
  if (!video) throw new Error("Elemen video tidak ditemukan.");
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
  await new Promise((res) => {
    video.onloadedmetadata = res;
    setTimeout(res, 2000);
  });
  await video.play().catch(() => {});
  video.classList.remove("hidden");
}

function stopCameraBackground() {
  state.cameraStream?.getTracks().forEach((t) => t.stop());
  state.cameraStream = null;
  const v = qs("#camera-bg");
  if (v) {
    v.srcObject = null;
    v.classList.add("hidden");
  }
}

// ─── WEBXR HIT-TEST ──────────────────────────────────────────────────────────
function waitForSceneRenderer(scene) {
  if (scene?.renderer) return Promise.resolve(scene.renderer);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Renderer AR belum siap.")),
      3000,
    );
    const done = () => {
      if (!scene.renderer) return;
      clearTimeout(timeout);
      resolve(scene.renderer);
    };
    scene.addEventListener("loaded", done, { once: true });
    scene.addEventListener("renderstart", done, { once: true });
  });
}

async function tryStartWebXRHitTest(scene) {
  let session = null;
  try {
    if (!navigator.xr) return false;
    session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["local-floor", "bounded-floor"],
    });

    let referenceSpaceType = "local-floor";
    const referenceSpace = await session
      .requestReferenceSpace(referenceSpaceType)
      .catch(() => {
        referenceSpaceType = "local";
        return session.requestReferenceSpace(referenceSpaceType);
      });
    const viewerSpace = await session.requestReferenceSpace("viewer");
    const hitTestSource = await session.requestHitTestSource({
      space: viewerSpace,
    });

    const renderer = await waitForSceneRenderer(scene);
    if (renderer?.xr) {
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType?.(referenceSpaceType);
      await renderer.xr.setSession(session);
    }

    state.xrSession = session;
    state.xrReferenceSpace = referenceSpace;
    state.xrReferenceSpaceType = referenceSpaceType;
    state.hitTestSource = hitTestSource;
    session.addEventListener("end", () => {
      try {
        state.hitTestSource?.cancel?.();
      } catch (_) {}
      state.hitTestSource = null;
      state.xrReferenceSpace = null;
      state.xrReferenceSpaceType = "local";
      state.xrSession = null;
      state.useWebXR = false;
      state.latestHitPosition = null;
      state.reticleEntity?.setAttribute("visible", "false");
    });
    return true;
  } catch (err) {
    console.warn("[WebXR hit-test]", err.message);
    session?.end?.().catch(() => {});
    return false;
  }
}

// ─── SURFACE DETECTOR ────────────────────────────────────────────────────────
const surfaceDetector = {
  confidence: 0,
  isFlat: false,
  threshold: 55,
  _canvas: null,
  _ctx: null,
  _prevFrame: null,
  _rafId: null,
  _imuAlpha: 0,
  _imuReady: false,

  init() {
    this._initIMU();
    this._initOpticalFlow();
  },

  _initIMU() {
    const handle = (e) => {
      const dist = Math.abs(Math.abs(e.beta || 0) - 90);
      const score = Math.max(0, Math.min(100, (1 - dist / 45) * 100));
      this._imuAlpha = this._imuAlpha * 0.85 + score * 0.15;
      this._imuReady = true;
    };
    if (typeof DeviceOrientationEvent !== "undefined") {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then((p) => {
            if (p === "granted")
              window.addEventListener("deviceorientation", handle, {
                passive: true,
              });
          })
          .catch(() => {});
      } else {
        window.addEventListener("deviceorientation", handle, { passive: true });
      }
    }
  },

  _initOpticalFlow() {
    const video = qs("#camera-bg");
    if (!video) return;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    this._canvas = c;
    this._ctx = c.getContext("2d", { willReadFrequently: true });

    const analyse = () => {
      if (!video.readyState || video.readyState < 2) {
        this._rafId = setTimeout(analyse, 300);
        return;
      }
      try {
        this._ctx.drawImage(video, 0, 0, 64, 36);
        const cur = this._ctx.getImageData(0, 0, 64, 36).data;
        if (this._prevFrame) {
          let sumDiff = 0,
            sumBright = 0;
          const N = cur.length / 4;
          for (let i = 0; i < cur.length; i += 4) {
            sumDiff +=
              (Math.abs(cur[i] - this._prevFrame[i]) +
                Math.abs(cur[i + 1] - this._prevFrame[i + 1]) +
                Math.abs(cur[i + 2] - this._prevFrame[i + 2])) /
              3;
            sumBright += (cur[i] + cur[i + 1] + cur[i + 2]) / 3;
          }
          const motion = Math.max(
            0,
            Math.min(100, (1 - sumDiff / N / 25) * 100),
          );
          const bright = sumBright / N;
          const texture =
            bright > 20 && bright < 230
              ? Math.min(100, 40 + (1 - Math.abs(bright - 128) / 128) * 60)
              : 0;
          const imu = this._imuReady ? this._imuAlpha : 50;
          const raw = motion * 0.6 + texture * 0.2 + imu * 0.2;
          this.confidence = this.confidence * 0.7 + raw * 0.3;
          this.isFlat = this.confidence >= this.threshold;
        }
        this._prevFrame = cur;
      } catch (_) {}
      this._rafId = setTimeout(analyse, 200);
    };
    video.addEventListener(
      "play",
      () => {
        clearTimeout(this._rafId);
        setTimeout(analyse, 500);
      },
      { once: true },
    );
    if (video.readyState >= 2) setTimeout(analyse, 500);
  },

  stop() {
    clearTimeout(this._rafId);
  },

  updateUI() {
    const bar = qs("#surface-bar"),
      label = qs("#surface-label"),
      hint = qs("#surface-hint");
    if (!bar) return;
    const pct = Math.round(this.confidence);
    bar.style.width = pct + "%";
    if (pct < 35) {
      bar.style.background = "#ff6b6b";
      if (label) label.textContent = "Belum terdeteksi";
      if (hint) hint.textContent = "Arahkan kamera ke lantai atau meja";
    } else if (pct < this.threshold) {
      bar.style.background = "#f59e0b";
      if (label) label.textContent = "Hampir…";
      if (hint) hint.textContent = "Tahan kamera diam sejenak";
    } else {
      bar.style.background = "#4ade80";
      if (label) label.textContent = "Bidang terdeteksi ✓";
      if (hint) hint.textContent = "Tap layar untuk meletakkan objek";
    }
  },
};

// ─── ORBIT CONTROLS ──────────────────────────────────────────────────────────
const orbit = {
  rotY: 0,
  rotX: 0,
  scale: 1,
  minX: -60,
  maxX: 60,
  minScale: 0.3,
  maxScale: 3.0,
  sensitivityY: 0.4,
  sensitivityX: 0.3,
  _lastX: null,
  _lastY: null,
  _lastDist: null,
  _lastTap: 0,

  init(exp) {
    const ia = exp?.interaction || {};
    this.minScale = Number(ia.minScale || 0.3);
    this.maxScale = Number(ia.maxScale || 3.0);
    this.scale = 1;
    this.rotY = parseRotY(exp?.model?.rotation || "0 0 0");
    this.rotX = 0;
  },

  apply() {
    if (!state.modelEntity) return;
    const s = this.scale * state.baseScale;
    state.modelEntity.object3D.scale.set(s, s, s);
    state.modelEntity.object3D.rotation.order = "YXZ";
    state.modelEntity.object3D.rotation.y = degToRad(this.rotY);
    state.modelEntity.object3D.rotation.x = degToRad(this.rotX);
    // Bayangan ikut posisi model, scale hanya XZ
    if (state.shadowEntity) {
      state.shadowEntity.object3D.scale.set(s * 1.2, 1, s * 1.2);
    }
  },

  reset() {
    this.rotY = parseRotY(state.experience?.model?.rotation || "0 0 0");
    this.rotX = 0;
    this.scale = 1;
    this.apply();
  },
};

// ─── AUTO-ROTATE ─────────────────────────────────────────────────────────────
let _autoRotateRAF = null;
function startAutoRotate(step) {
  step = step || 0.5;
  const tick = () => {
    if (!state.placed || _gyroMode) {
      _autoRotateRAF = requestAnimationFrame(tick);
      return;
    }
    orbit.rotY += step * 0.016 * 60; // normalkan ke ~60fps
    orbit.apply();
    _autoRotateRAF = requestAnimationFrame(tick);
  };
  _autoRotateRAF = requestAnimationFrame(tick);
}
function stopAutoRotate() {
  if (_autoRotateRAF) {
    cancelAnimationFrame(_autoRotateRAF);
    _autoRotateRAF = null;
  }
}

// ─── PARTICLES ───────────────────────────────────────────────────────────────
// Burst partikel Three.js saat objek pertama diletakkan (sparkle effect)
function spawnParticleBurst(position) {
  if (!state.scene || !window.THREE) return;
  const sceneObj = state.scene.object3D;
  const count = 40;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = position.x;
    pos[i * 3 + 1] = position.y;
    pos[i * 3 + 2] = position.z;
    vel.push(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        Math.random() * 0.12 + 0.04,
        (Math.random() - 0.5) * 0.08,
      ),
    );
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xf97316,
    size: 0.025,
    transparent: true,
    opacity: 1,
  });
  const points = new THREE.Points(geo, mat);
  sceneObj.add(points);

  let frame = 0;
  const animate = () => {
    frame++;
    const posArr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      posArr[i * 3] += vel[i].x;
      posArr[i * 3 + 1] += vel[i].y;
      posArr[i * 3 + 2] += vel[i].z;
      vel[i].y -= 0.004; // gravity
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.max(0, 1 - frame / 45);
    if (frame < 45) requestAnimationFrame(animate);
    else {
      sceneObj.remove(points);
      geo.dispose();
      mat.dispose();
    }
  };
  requestAnimationFrame(animate);
}

// ─── DROP SHADOW ─────────────────────────────────────────────────────────────
// Disk putaran gelap semi-transparan di bawah objek — blobby shadow
function createShadow(scene, position) {
  const shadow = document.createElement("a-entity");
  shadow.setAttribute("id", "model-shadow");
  shadow.setAttribute("position", position);
  shadow.setAttribute(
    "geometry",
    "primitive: circle; radius: 0.4; segments: 32",
  );
  shadow.setAttribute(
    "material",
    "color: #000; opacity: 0.25; shader: flat; side: double",
  );
  shadow.setAttribute("rotation", "-90 0 0");
  scene.appendChild(shadow);
  state.shadowEntity = shadow;
  return shadow;
}

// ─── HOTSPOTS ────────────────────────────────────────────────────────────────
// Label melayang di dunia 3D yang selalu menghadap kamera (billboard)
function createHotspots(scene, hotspots, modelPos) {
  if (!hotspots || !hotspots.length) return;
  hotspots.forEach((hs, i) => {
    const group = document.createElement("a-entity");
    group.setAttribute("id", "hotspot-" + i);
    const off = hs.offset || { x: 0, y: 0.5, z: 0 };
    group.setAttribute("position", {
      x: modelPos.x + off.x,
      y: modelPos.y + off.y,
      z: modelPos.z + off.z,
    });
    // Billboard: selalu hadap kamera
    group.setAttribute("look-at", "[camera]");

    // Bulatan indikator
    const dot = document.createElement("a-sphere");
    dot.setAttribute("radius", "0.03");
    dot.setAttribute("color", "#f97316");
    dot.setAttribute("material", "shader: flat; opacity: 0.95");
    group.appendChild(dot);

    // Garis ke titik
    const line = document.createElement("a-entity");
    line.setAttribute(
      "line",
      "start: 0 0 0; end: 0 " +
        -(off.y - 0.05) +
        " 0; color: #f97316; opacity: 0.6",
    );
    group.appendChild(line);

    // Label teks
    const label = document.createElement("a-entity");
    label.setAttribute("text", {
      value: hs.label || "Hotspot " + (i + 1),
      align: "center",
      color: "#ffffff",
      width: 1.2,
      wrapCount: 20,
    });
    label.setAttribute("position", "0 0.08 0");
    // Panel background
    const bg = document.createElement("a-plane");
    bg.setAttribute("color", "#000000");
    bg.setAttribute("opacity", "0.55");
    bg.setAttribute("width", "0.5");
    bg.setAttribute("height", "0.1");
    bg.setAttribute("material", "shader: flat");
    bg.setAttribute("position", "0 0.08 -0.001");
    group.appendChild(bg);
    group.appendChild(label);

    scene.appendChild(group);
  });
}

function refreshHotspots(modelPos) {
  qsa("[id^='hotspot-']").forEach((el) => el.parentNode?.removeChild(el));
  const hotspots = state.experience?.hotspots || [];
  if (hotspots.length) createHotspots(state.scene, hotspots, modelPos);
}

// ─── SCREENSHOT & SHARE ──────────────────────────────────────────────────────
async function takeScreenshot() {
  try {
    const video = qs("#camera-bg");
    const arCanvas = qs("#scene-host canvas");
    if (!video || !arCanvas) {
      setStatus("Tidak bisa capture — scene belum siap", "error");
      return;
    }

    // Buat canvas gabungan
    const w = video.videoWidth || window.innerWidth;
    const h = video.videoHeight || window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    // Layer 1: frame kamera
    ctx.drawImage(video, 0, 0, w, h);

    // Layer 2: canvas A-Frame (transparan di atas)
    ctx.drawImage(arCanvas, 0, 0, w, h);

    // Watermark kecil
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("Made with WebAR", 12, h - 12);

    // Konversi ke blob
    const blob = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92),
    );
    if (!blob) {
      setStatus("Gagal membuat gambar", "error");
      return;
    }

    const file = new File([blob], "ar-screenshot.jpg", { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);

    // Web Share API (mobile)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: state.experience?.title || "AR Experience",
      });
    } else {
      // Fallback: download langsung
      const a = document.createElement("a");
      a.href = url;
      a.download = "ar-screenshot.jpg";
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus("Screenshot disimpan ✓", "success");
  } catch (err) {
    if (err.name !== "AbortError")
      setStatus("Screenshot gagal: " + err.message, "error");
  }
}

// ─── MULTI-SCENE / SWAP MODEL ────────────────────────────────────────────────
function buildSceneSelector(experiences) {
  const wrap = qs("#scene-selector-wrap");
  if (!wrap || experiences.length <= 1) return;

  const strip = document.createElement("div");
  strip.className = "scene-strip";

  experiences.forEach((exp, i) => {
    const btn = document.createElement("button");
    btn.className =
      "scene-btn" + (exp.id === state.experience?.id ? " active" : "");
    btn.textContent = exp.title
      .replace("Demo WebXR — ", "")
      .replace("Demo ", "");
    btn.dataset.id = exp.id;
    btn.addEventListener("click", () => swapScene(exp));
    strip.appendChild(btn);
  });

  wrap.appendChild(strip);
  wrap.classList.remove("hidden");
}

function swapScene(exp) {
  if (!state.modelEntity || exp.id === state.experience?.id) return;
  state.experience = exp;
  setPageCopy(exp);

  // Swap model
  const m = exp.model || {};
  state.modelEntity.setAttribute("gltf-model", "url(" + m.src + ")");
  orbit.init(exp);

  // Update shadow scale
  state.baseScale = parseScaleX(m.scale);
  orbit.apply();

  // Update scene selector active
  qsa(".scene-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.id === exp.id),
  );

  // Auto-rotate
  stopAutoRotate();
  if (exp.interaction?.autoRotate && state.placed)
    startAutoRotate(exp.interaction.autoRotateStep);

  // Audio
  setupAudio(exp);
  setStatus("Scene diganti: " + exp.title, "success");

  // Hapus hotspot lama, buat baru
  qsa("[id^='hotspot-']").forEach((el) => el.parentNode?.removeChild(el));
  if (state.placedWorldPos && exp.hotspots) {
    createHotspots(state.scene, exp.hotspots, state.placedWorldPos);
  }
}

// ─── AFRAME COMPONENTS ───────────────────────────────────────────────────────
function registerARComponents() {
  if (!window.AFRAME || AFRAME.components["ar-placement-manager"]) return;

  // ── gyro-camera ──────────────────────────────────────────────────────────
  AFRAME.registerComponent("gyro-camera", {
    schema: { enabled: { type: "boolean", default: true } },
    init() {
      this._q = new THREE.Quaternion();
      this._euler = new THREE.Euler();
      this._screenQ = new THREE.Quaternion();
      this._deviceQ = new THREE.Quaternion(
        -Math.sqrt(0.5),
        0,
        0,
        Math.sqrt(0.5),
      );
      this._enabled = false;

      this._onOrientation = (e) => {
        if (!this._enabled || !this.data.enabled) return;
        this._euler.set(
          degToRad(e.beta || 0),
          degToRad(e.alpha || 0),
          degToRad(-(e.gamma || 0)),
          "ZXY",
        );
        this._q.setFromEuler(this._euler);
        this.el.object3D.quaternion.copy(
          this._q.multiply(this._screenQ).multiply(this._deviceQ),
        );
      };

      this.el.sceneEl.addEventListener("gyro-start", () => {
        const start = () => {
          window.addEventListener("deviceorientation", this._onOrientation, {
            passive: true,
          });
          window.addEventListener("orientationchange", () => {
            const angle =
              window.screen.orientation?.angle || window.orientation || 0;
            this._screenQ.setFromAxisAngle(
              new THREE.Vector3(0, 0, 1),
              degToRad(-angle),
            );
          });
          this._enabled = true;
          setStatus("Gyroscope aktif — gerakkan HP untuk orbit", "success");
        };
        if (typeof DeviceOrientationEvent?.requestPermission === "function") {
          DeviceOrientationEvent.requestPermission()
            .then((p) => {
              if (p === "granted") start();
              else setStatus("Izin gyroscope ditolak", "");
            })
            .catch(() => {});
        } else {
          start();
        }
      });
    },
    remove() {
      window.removeEventListener("deviceorientation", this._onOrientation);
    },
  });

  // ── ar-placement-manager ─────────────────────────────────────────────────
  AFRAME.registerComponent("ar-placement-manager", {
    schema: {
      modelSrc: { type: "string", default: "" },
      modelScale: { type: "string", default: "0.8 0.8 0.8" },
      modelRotation: { type: "string", default: "0 0 0" },
      animMixer: { type: "boolean", default: true },
    },

    init() {
      // Reticle
      const reticle = document.createElement("a-entity");
      const ring = document.createElement("a-entity");
      ring.setAttribute(
        "geometry",
        "primitive:ring;radiusInner:0.05;radiusOuter:0.08;segmentsTheta:32",
      );
      ring.setAttribute(
        "material",
        "color:#f97316;shader:flat;side:double;opacity:0.9",
      );
      ring.setAttribute("rotation", "-90 0 0");
      reticle.appendChild(ring);
      reticle.setAttribute("visible", "false");
      reticle.setAttribute(
        "animation__pulse",
        "property:scale;from:1 1 1;to:1.2 1.2 1.2;dir:alternate;dur:600;loop:true;easing:easeInOutSine",
      );
      this.el.sceneEl.appendChild(reticle);
      this.reticleEl = reticle;
      state.reticleEntity = reticle;

      // Model
      const model = document.createElement("a-entity");
      model.setAttribute("id", "experience-model");
      model.setAttribute("gltf-model", "url(" + this.data.modelSrc + ")");
      model.setAttribute("scale", this.data.modelScale);
      model.setAttribute("rotation", this.data.modelRotation);
      model.setAttribute("visible", "false");
      if (this.data.animMixer) model.setAttribute("animation-mixer", "");
      model.addEventListener("model-loaded", () => {
        setStatus(
          state.useWebXR
            ? "Model dimuat ✓ — Arahkan ke lantai lalu tap"
            : "Model dimuat ✓ — Tap untuk meletakkan",
          "success",
        );
      });
      model.addEventListener("model-error", () =>
        setStatus("Model gagal dimuat", "error"),
      );
      this.el.sceneEl.appendChild(model);
      this.modelEl = model;
      state.modelEntity = model;

      this.el.sceneEl.addEventListener("click", () => this.handleTap());
    },

    handleTap() {
      if (!this.modelEl) return;

      // Guard: cek confidence
      if (!state.useWebXR && !this.placed) {
        if (!surfaceDetector.isFlat) {
          setStatus(
            "Arahkan ke bidang datar dulu — " +
              Math.round(surfaceDetector.confidence) +
              "%",
            "",
          );
          return;
        }
      }

      let pos;
      if (state.useWebXR) {
        if (!state.latestHitPosition) {
          setStatus("Bidang belum terdeteksi — arahkan reticle ke lantai/meja", "");
          return;
        }
        pos = { ...state.latestHitPosition };
      } else if (!state.useWebXR) {
        const camera = this.el.sceneEl.camera;
        if (camera?.matrixWorld && window.THREE) {
          const lp = new THREE.Vector3(0, -0.3, -1.5);
          lp.applyMatrix4(camera.matrixWorld);
          pos = { x: lp.x, y: lp.y, z: lp.z };
        } else {
          pos = { x: 0, y: -0.5, z: -1.5 };
        }
      } else {
        return;
      }

      if (!pos) return;
      state.placedWorldPos = { ...pos };

      this.modelEl.setAttribute("position", pos);
      this.modelEl.setAttribute("visible", "true");

      if (!this.placed) {
        this.placed = true;
        state.placed = true;

        // Drop shadow
        createShadow(this.el.sceneEl, { x: pos.x, y: pos.y - 0.01, z: pos.z });

        // Particles burst
        spawnParticleBurst(pos);

        // Hotspots
        const exp = state.experience;
        refreshHotspots(pos);

        // Gyroscope
        this.el.sceneEl.dispatchEvent(new CustomEvent("gyro-start"));

        // Auto-rotate
        if (exp?.interaction?.autoRotate)
          startAutoRotate(exp.interaction.autoRotateStep);

        setStatus("✓ Objek diletakkan! Gerakkan HP untuk orbit.", "success");
        autoplayAudio("marker");

        // Ring indicator
        const ind = qs("#marker-indicator");
        if (ind) {
          ind.classList.add("found");
          setTimeout(() => ind.classList.remove("found"), 2000);
        }

        // Reveal scene selector
        buildSceneSelector(state.allExperiences);

        // Screenshot hint: tampilkan tombol screenshot
        const ssBtn = qs("#screenshot-btn");
        if (ssBtn) ssBtn.classList.remove("hidden");
      } else {
        // Pindahkan shadow juga
        if (state.shadowEntity)
          state.shadowEntity.setAttribute("position", {
            x: pos.x,
            y: pos.y - 0.01,
            z: pos.z,
          });
        setStatus("Objek dipindahkan ✓", "success");
      }
    },

    tick() {
      // Enforce world-space
      if (
        state.placedWorldPos &&
        this.placed &&
        !state.useWebXR &&
        this.modelEl
      ) {
        const cur = this.modelEl.getAttribute("position");
        const wp = state.placedWorldPos;
        if (
          Math.abs(cur.x - wp.x) > 0.001 ||
          Math.abs(cur.y - wp.y) > 0.001 ||
          Math.abs(cur.z - wp.z) > 0.001
        ) {
          this.modelEl.setAttribute("position", wp);
        }
      }

      // WebXR hit-test
      if (!state.useWebXR || !state.hitTestSource) return;
      const xrFrame = this.el.sceneEl.frame;
      const refSpace = state.xrReferenceSpace;
      if (!xrFrame || !refSpace) return;
      const hits = xrFrame.getHitTestResults(state.hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(refSpace);
        if (pose) {
          const m = pose.transform.matrix;
          const matrix = new THREE.Matrix4().fromArray(m);
          const position = new THREE.Vector3();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          matrix.decompose(position, quaternion, scale);

          this.reticleEl.object3D.position.copy(position);
          this.reticleEl.object3D.quaternion.copy(quaternion);
          this.reticleEl.object3D.scale.set(1, 1, 1);
          this.reticleEl.object3D.updateMatrixWorld(true);
          state.latestHitPosition = {
            x: m[12],
            y: m[13],
            z: m[14],
          };
          this.reticleEl.setAttribute("visible", "true");
        }
      } else {
        state.latestHitPosition = null;
        this.reticleEl.setAttribute("visible", "false");
      }
    },
  });
}

// ─── BUILD SCENE ─────────────────────────────────────────────────────────────
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
    "antialias: true; alpha: true; premultipliedAlpha: false",
  );
  scene.setAttribute("vr-mode-ui", "enabled: false");
  scene.setAttribute("background", "color: transparent; transparent: true");

  // Lighting
  const amb = document.createElement("a-light");
  amb.setAttribute("type", "ambient");
  amb.setAttribute("intensity", "1.2");
  scene.appendChild(amb);
  const dir = document.createElement("a-light");
  dir.setAttribute("type", "directional");
  dir.setAttribute("intensity", "0.9");
  dir.setAttribute("position", "1 3 2");
  scene.appendChild(dir);
  // Fill light dari bawah (agar bayangan tidak terlalu gelap)
  const fill = document.createElement("a-light");
  fill.setAttribute("type", "directional");
  fill.setAttribute("intensity", "0.3");
  fill.setAttribute("position", "0 -1 0");
  scene.appendChild(fill);

  // Camera
  const cam = document.createElement("a-entity");
  cam.setAttribute("id", "ar-camera");
  cam.setAttribute("camera", "fov: 70; near: 0.01; far: 100; active: true");
  cam.setAttribute("position", "0 1.6 0");
  cam.setAttribute("look-controls", "enabled: false");
  cam.setAttribute("wasd-controls", "enabled: false");
  cam.setAttribute("gyro-camera", "enabled: true");
  scene.appendChild(cam);
  state.cameraEntity = cam;

  // Placement manager
  const mgr = document.createElement("a-entity");
  mgr.setAttribute("ar-placement-manager", {
    modelSrc: m.src || "",
    modelScale: m.scale || "0.8 0.8 0.8",
    modelRotation: m.rotation || "0 0 0",
    animMixer: m.animationMixer !== false,
  });
  scene.appendChild(mgr);

  host.replaceChildren(scene);
  state.scene = scene;
  state.baseScale = parseScaleX(m.scale);
  orbit.init(exp);

  return scene;
}

// ─── AUDIO ───────────────────────────────────────────────────────────────────
function setupAudio(exp) {
  if (state.audioElement) {
    state.audioElement.pause();
    state.audioElement = null;
  }
  const cfg = exp?.audio || {};
  if (cfg.src) {
    const a = new Audio(cfg.src);
    a.preload = "auto";
    a.loop = Boolean(cfg.loop);
    a.volume = cfg.volume ?? 0.9;
    state.audioElement = a;
  }
}
function playAudio() {
  const cfg = state.experience?.audio || {};
  if (state.audioElement) {
    state.audioElement.currentTime = 0;
    state.audioElement.play().catch(() => {});
    return;
  }
  if (cfg.speechText && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cfg.speechText);
    u.lang = cfg.lang || "id-ID";
    u.rate = 1;
    u.pitch = 1;
    u.onstart = () => {
      state.speechActive = true;
    };
    u.onend = u.onerror = () => {
      state.speechActive = false;
    };
    window.speechSynthesis.speak(u);
  }
}
function toggleAudio() {
  if (state.audioElement) {
    state.audioElement.paused
      ? state.audioElement.play().catch(() => {})
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
  const cfg = state.experience?.audio || {};
  if (trigger === "marker" && cfg.autoplayOnMarker) playAudio();
  if (trigger === "start" && cfg.autoplayOnStart) playAudio();
}

// ─── GYRO / ORBIT MODE TOGGLE ────────────────────────────────────────────────
let _gyroMode = true;
function toggleCameraMode() {
  _gyroMode = !_gyroMode;
  const cam = state.cameraEntity;
  if (cam) {
    cam.setAttribute("gyro-camera", "enabled: " + _gyroMode);
    if (!_gyroMode) {
      cam.object3D.quaternion.identity();
      cam.setAttribute("rotation", "0 0 0");
    }
  }
  const btn = qs("#mode-toggle");
  if (btn) {
    btn.textContent = _gyroMode ? "🔄 Gyro" : "✋ Orbit";
  }
  const hint = qs("#gesture-hint");
  if (hint)
    hint.textContent = _gyroMode
      ? "Gyro: gerakkan HP | Cubit: zoom"
      : "Drag: putar | Cubit: zoom | 2×: reset";
  setStatus(
    _gyroMode
      ? "Mode Gyro — gerakkan HP untuk orbit"
      : "Mode Orbit — drag layar untuk putar",
    "success",
  );
}

// ─── TOUCH GESTURES ──────────────────────────────────────────────────────────
function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function bindTouchGestures() {
  const overlay = qs("#touch-overlay");
  if (!overlay) return;

  overlay.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        orbit._lastDist = touchDist(e.touches);
        orbit._lastX = orbit._lastY = null;
      } else if (e.touches.length === 1) {
        orbit._lastX = e.touches[0].clientX;
        orbit._lastY = e.touches[0].clientY;
        orbit._lastDist = null;
        const now = Date.now();
        if (now - orbit._lastTap < 280) {
          orbit.reset();
          setStatus("Pose direset ✓", "success");
        }
        orbit._lastTap = now;
      }
    },
    { passive: true },
  );

  overlay.addEventListener(
    "touchmove",
    (e) => {
      if (!state.placed) return;
      if (e.touches.length === 2 && orbit._lastDist !== null) {
        const d = touchDist(e.touches);
        orbit.scale = clamp(
          orbit.scale + (d - orbit._lastDist) * 0.008,
          orbit.minScale / state.baseScale,
          orbit.maxScale / state.baseScale,
        );
        orbit._lastDist = d;
        orbit.apply();
        return;
      }
      if (_gyroMode) return;
      if (e.touches.length === 1 && orbit._lastX !== null) {
        orbit.rotY +=
          (e.touches[0].clientX - orbit._lastX) * orbit.sensitivityY;
        orbit.rotX = clamp(
          orbit.rotX -
            (e.touches[0].clientY - orbit._lastY) * orbit.sensitivityX,
          orbit.minX,
          orbit.maxX,
        );
        orbit._lastX = e.touches[0].clientX;
        orbit._lastY = e.touches[0].clientY;
        orbit.apply();
      }
    },
    { passive: true },
  );

  overlay.addEventListener(
    "touchend",
    (e) => {
      if (e.touches.length < 2) orbit._lastDist = null;
      if (e.touches.length < 1) {
        orbit._lastX = orbit._lastY = null;
      }
    },
    { passive: true },
  );

  overlay.addEventListener("click", () => {
    if (state.scene)
      state.scene.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// ─── CLEANUP ─────────────────────────────────────────────────────────────────
function cleanup() {
  stopCameraBackground();
  stopAutoRotate();
  surfaceDetector.stop();
  if (state.audioElement) state.audioElement.pause();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (state.surfaceUIInterval) clearInterval(state.surfaceUIInterval);
  state.xrSession?.end().catch(() => {});
}

// ─── UI BINDING ──────────────────────────────────────────────────────────────
function bindUI() {
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  // Panel toggle
  const toggleBtn = qs("#toggle-panel"),
    infoPanel = qs("#info-panel");
  if (toggleBtn && infoPanel) {
    toggleBtn.addEventListener("click", () => {
      infoPanel.classList.toggle("collapsed");
      toggleBtn.textContent = infoPanel.classList.contains("collapsed")
        ? "+"
        : "−";
    });
  }

  qs("#mode-toggle")?.addEventListener("click", toggleCameraMode);
  qs("#play-audio")?.addEventListener("click", () => {
    if (state.userStarted) toggleAudio();
  });
  qs("#screenshot-btn")?.addEventListener("click", takeScreenshot);

  qs("#marker-help")?.addEventListener("click", () => {
    window.alert(
      "Cara pakai AR:\n\n" +
        "MELETAKKAN OBJEK\n" +
        "  Arahkan kamera ke lantai/meja → tunggu indikator hijau → tap layar\n\n" +
        "MODE GYRO (default)\n" +
        "  Gerakkan HP ke kiri/kanan/atas → kamera berputar di sekitar objek\n\n" +
        "MODE ORBIT (tap 🔄)\n" +
        "  Drag 1 jari → putar objek\n" +
        "  Drag vertikal → lihat dari atas/depan\n\n" +
        "GESTURE\n" +
        "  Cubit 2 jari → zoom in/out\n" +
        "  Ketuk 2x cepat → reset pose\n\n" +
        "GANTI SCENE\n" +
        "  Gunakan tombol di bawah layar setelah objek diletakkan",
    );
  });

  // Control strip
  qsa("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ia = state.experience?.interaction || {};
      const rs = Number(ia.rotateStep || 15),
        ss = Number(ia.scaleStep || 0.15);
      switch (btn.dataset.action) {
        case "rotate-left":
          orbit.rotY -= rs;
          break;
        case "rotate-right":
          orbit.rotY += rs;
          break;
        case "tilt-up":
          orbit.rotX = clamp(orbit.rotX - rs, orbit.minX, orbit.maxX);
          break;
        case "tilt-down":
          orbit.rotX = clamp(orbit.rotX + rs, orbit.minX, orbit.maxX);
          break;
        case "scale-down":
          orbit.scale = clamp(
            orbit.scale - ss,
            orbit.minScale / state.baseScale,
            orbit.maxScale / state.baseScale,
          );
          break;
        case "scale-up":
          orbit.scale = clamp(
            orbit.scale + ss,
            orbit.minScale / state.baseScale,
            orbit.maxScale / state.baseScale,
          );
          break;
        case "reset":
          orbit.reset();
          setStatus("Pose direset ✓", "success");
          return;
        default:
          return;
      }
      orbit.apply();
    });
  });

  // Start AR
  const startBtn = qs("#start-ar");
  if (!startBtn) return;

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    const lbl = startBtn.querySelector("span:last-child");
    if (lbl) lbl.textContent = "Memulai…";

    try {
      if (!window.isSecureContext) throw new Error("Halaman harus HTTPS.");
      if (!window.AFRAME)
        throw new Error("Library A-Frame gagal dimuat. Refresh halaman.");

      showLoading("Membangun scene AR...");
      hideBoot();

      registerARComponents();

      const scene = buildScene(state.experience);
      setupAudio(state.experience);

      showLoading("Mengaktifkan WebXR hit-test...");
      state.useWebXR = await tryStartWebXRHitTest(scene);

      if (!state.useWebXR) {
        if (!navigator.mediaDevices)
          throw new Error("Browser tidak mendukung kamera.");
        showLoading("Mengakses kamera...");
        await startCameraBackground();
      }

      const hud = qs("#hud");
      if (hud) hud.classList.remove("hidden");
      const overlay = qs("#touch-overlay");
      if (overlay) overlay.classList.remove("hidden");

      if (window.innerWidth <= 480) {
        const ip = qs("#info-panel"),
          tb = qs("#toggle-panel");
        if (ip) ip.classList.add("collapsed");
        if (tb) tb.textContent = "+";
      }

      state.userStarted = true;
      bindTouchGestures();

      // Surface detector
      surfaceDetector.init();
      state.surfaceUIInterval = setInterval(() => {
        surfaceDetector.updateUI();
        if (state.useWebXR && state.latestHitPosition) {
          surfaceDetector.confidence = Math.min(
            100,
            surfaceDetector.confidence + 15,
          );
          surfaceDetector.isFlat = true;
        }
      }, 250);

      hideLoading();
      setStatus(
        state.useWebXR
          ? "WebXR aktif - arahkan ke lantai lalu tap"
          : "Kamera aktif - arahkan ke lantai atau meja",
        "success",
      );
      autoplayAudio("start");

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
    state.experience = await fetchExperiences();
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
