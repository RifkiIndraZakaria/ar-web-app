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
    console.warn(
      "[WebXR hit-test] Tidak tersedia, pakai fallback:",
      err.message,
    );
    return false;
  }
}

// ─── DETEKSI BIDANG DATAR ─────────────────────────────────────────────────────
// Tiga lapis deteksi:
//   1. WebXR hit-test      → paling akurat, dari sensor SLAM hardware
//   2. Optical flow        → analisis gerak piksel kamera, tanpa hardware khusus
//   3. IMU / DeviceMotion  → baca sudut HP, estimasi apakah kamera ke bawah

const surfaceDetector = {
  // State
  confidence: 0, // 0–100: seberapa yakin ada bidang datar di depan
  isFlat: false, // true jika confidence >= threshold
  threshold: 55, // min confidence untuk izinkan tap

  // Optical flow
  _canvas: null,
  _ctx: null,
  _prevFrame: null,
  _rafId: null,

  // IMU
  _imuAlpha: 0, // rata-rata bergerak sudut pitch (derajat dari horizontal)
  _imuReady: false,

  init: function () {
    this._initIMU();
    this._initOpticalFlow();
  },

  // ── IMU: DeviceMotion / DeviceOrientation ──────────────────────────────────
  _initIMU: function () {
    const self = this;

    function handleOrientation(e) {
      // e.beta = sudut depan-belakang (-180..180), 90 = kamera horizontal ke bawah
      const beta = e.beta || 0;
      // Normalkan ke 0–100 berdasarkan seberapa dekat ke 90°
      const dist = Math.abs(Math.abs(beta) - 90);
      // dist=0 → kamera tepat ke bawah (100%), dist=45 → 0%
      const imuScore = Math.max(0, Math.min(100, (1 - dist / 45) * 100));
      self._imuAlpha = self._imuAlpha * 0.85 + imuScore * 0.15;
      self._imuReady = true;
    }

    if (typeof DeviceOrientationEvent !== "undefined") {
      // iOS 13+ butuh izin eksplisit
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then(function (perm) {
            if (perm === "granted") {
              window.addEventListener("deviceorientation", handleOrientation, {
                passive: true,
              });
            }
          })
          .catch(function () {});
      } else {
        window.addEventListener("deviceorientation", handleOrientation, {
          passive: true,
        });
      }
    }
  },

  // ── Optical flow: bandingkan frame kamera setiap ~200ms ───────────────────
  _initOpticalFlow: function () {
    const self = this;
    const video = qs("#camera-bg");
    if (!video) return;

    // Canvas kecil (64x36) untuk efisiensi — resolusi penuh tidak diperlukan
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    self._canvas = c;
    self._ctx = c.getContext("2d", { willReadFrequently: true });

    function analyse() {
      if (!video.readyState || video.readyState < 2) {
        self._rafId = setTimeout(analyse, 300);
        return;
      }

      try {
        const ctx = self._ctx;
        ctx.drawImage(video, 0, 0, 64, 36);
        const cur = ctx.getImageData(0, 0, 64, 36).data;

        if (self._prevFrame) {
          const prev = self._prevFrame;
          let sumDiff = 0;
          let sumVar = 0;
          const N = cur.length / 4;

          for (let i = 0; i < cur.length; i += 4) {
            const dr = cur[i] - prev[i];
            const dg = cur[i + 1] - prev[i + 1];
            const db = cur[i + 2] - prev[i + 2];
            const diff = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3;
            sumDiff += diff;

            // Varians lokal: ukur seberapa "datar" tekstur (sedikit detail = meja/lantai polos)
            const bright = (cur[i] + cur[i + 1] + cur[i + 2]) / 3;
            sumVar += bright;
          }

          const avgDiff = sumDiff / N; // 0 = diam, >30 = banyak gerak
          const avgBright = sumVar / N;

          // Skor motion: kamera pelan/diam = lebih mungkin mengarah ke bidang
          // (pengguna biasanya menahan HP diam saat mengincar permukaan)
          const motionScore = Math.max(
            0,
            Math.min(100, (1 - avgDiff / 25) * 100),
          );

          // Skor tekstur: kecerahan sedang = meja/lantai (bukan langit/hitam)
          const textureScore =
            avgBright > 20 && avgBright < 230
              ? Math.min(100, 40 + (1 - Math.abs(avgBright - 128) / 128) * 60)
              : 0;

          // Gabungkan: motion 60% + tekstur 20% + IMU 20%
          const imuScore = self._imuReady ? self._imuAlpha : 50;
          const raw = motionScore * 0.6 + textureScore * 0.2 + imuScore * 0.2;

          // Rata-rata bergerak agar tidak berkedip
          self.confidence = self.confidence * 0.7 + raw * 0.3;
          self.isFlat = self.confidence >= self.threshold;
        }

        self._prevFrame = cur;
      } catch (err) {
        // Bisa terjadi kalau video belum siap
      }

      self._rafId = setTimeout(analyse, 200);
    }

    video.addEventListener(
      "play",
      function () {
        clearTimeout(self._rafId);
        setTimeout(analyse, 500);
      },
      { once: true },
    );

    // Juga mulai jika video sudah berjalan
    if (video.readyState >= 2) setTimeout(analyse, 500);
  },

  stop: function () {
    clearTimeout(this._rafId);
    window.removeEventListener("deviceorientation", function () {});
  },

  // Perbarui indikator UI
  updateUI: function () {
    const bar = qs("#surface-bar");
    const label = qs("#surface-label");
    const hint = qs("#surface-hint");
    if (!bar || !label) return;

    const pct = Math.round(this.confidence);
    bar.style.width = pct + "%";

    // Warna berubah: merah → kuning → hijau
    if (pct < 35) {
      bar.style.background = "var(--color-text-danger)";
      if (label) label.textContent = "Belum terdeteksi";
      if (hint)
        hint.textContent = "Arahkan kamera ke lantai atau meja yang datar";
    } else if (pct < this.threshold) {
      bar.style.background = "var(--color-text-warning)";
      if (label) label.textContent = "Hampir…";
      if (hint)
        hint.textContent = "Tahan kamera diam sejenak di atas permukaan";
    } else {
      bar.style.background = "var(--color-text-success)";
      if (label) label.textContent = "Bidang terdeteksi \u2713";
      if (hint) hint.textContent = "Tap layar untuk meletakkan objek";
    }
  },
};

// ─── REGISTER KOMPONEN AFRAME ────────────────────────────────────────────────
function registerARComponents() {
  if (!window.AFRAME || AFRAME.components["ar-placement-manager"]) return;

  /* ══════════════════════════════════════════════════════════════════════
     gyro-camera
     Membaca DeviceOrientation (alpha/beta/gamma) setiap frame dan
     mengubah quaternion kamera A-Frame sesuai orientasi HP di dunia nyata.

     Cara kerja:
       1. Ambil alpha (kompas Z), beta (tilt depan-belakang X), gamma (kiri-kanan Y)
       2. Konversi ke quaternion menggunakan urutan Euler ZXY (standar ponsel)
       3. Terapkan offset 90° agar -Z kamera (arah pandang) = arah kamera belakang HP
       4. Terapkan ke camera.object3D.quaternion setiap animationFrame
  ══════════════════════════════════════════════════════════════════════ */
  AFRAME.registerComponent("gyro-camera", {
    schema: { enabled: { type: "boolean", default: true } },

    init: function () {
      const self = this;
      self._enabled = false;
      self._q = new THREE.Quaternion();
      self._euler = new THREE.Euler();
      self._screenQ = new THREE.Quaternion();
      self._worldQ = new THREE.Quaternion();
      // Rotasi layar: portrait = 0, landscape = ±90
      self._screenQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0);

      // Offset agar kamera menghadap ke depan HP (bukan ke atas)
      // -90° di sumbu X = putar "melihat ke bawah" menjadi "melihat ke depan"
      self._deviceQ = new THREE.Quaternion(
        -Math.sqrt(0.5),
        0,
        0,
        Math.sqrt(0.5),
      );

      self._onOrientation = function (e) {
        if (!self._enabled || !self.data.enabled) return;
        self._applyOrientation(e.alpha, e.beta, e.gamma);
      };

      self._requestAndStart = function () {
        if (typeof DeviceOrientationEvent === "undefined") {
          console.warn("[gyro-camera] DeviceOrientationEvent tidak tersedia.");
          return;
        }
        if (typeof DeviceOrientationEvent.requestPermission === "function") {
          // iOS 13+
          DeviceOrientationEvent.requestPermission()
            .then(function (perm) {
              if (perm === "granted") self._startListening();
              else
                setStatus(
                  "Izin gyroscope ditolak — geser manual tetap bisa.",
                  "",
                );
            })
            .catch(function () {});
        } else {
          self._startListening();
        }
      };

      self._startListening = function () {
        window.addEventListener("deviceorientation", self._onOrientation, {
          passive: true,
        });
        window.addEventListener("orientationchange", function () {
          const angle =
            window.screen.orientation && window.screen.orientation.angle
              ? window.screen.orientation.angle
              : window.orientation || 0;
          const rad = THREE.MathUtils.degToRad(-angle);
          self._screenQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad);
        });
        self._enabled = true;
        setStatus(
          "Gyroscope aktif — gerakkan HP untuk melihat sekeliling.",
          "success",
        );
      };

      // Mulai setelah interaksi user (dipanggil dari luar setelah placed)
      self.el.sceneEl.addEventListener("gyro-start", function () {
        self._requestAndStart();
      });
    },

    _applyOrientation: function (alpha, beta, gamma) {
      if (alpha === null || beta === null || gamma === null) return;

      // Euler ZXY adalah konvensi standar DeviceOrientation
      this._euler.set(
        THREE.MathUtils.degToRad(beta),
        THREE.MathUtils.degToRad(alpha),
        THREE.MathUtils.degToRad(-gamma),
        "ZXY",
      );
      this._q.setFromEuler(this._euler);

      // world → screen → device
      this._worldQ
        .copy(this._q)
        .multiply(this._screenQ)
        .multiply(this._deviceQ);

      this.el.object3D.quaternion.copy(this._worldQ);
    },

    remove: function () {
      window.removeEventListener("deviceorientation", this._onOrientation);
    },
  });

  /* ══════════════════════════════════════════════════════════════════════
     ar-placement-manager  (tidak berubah secara signifikan)
  ══════════════════════════════════════════════════════════════════════ */

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

      // Cek confidence bidang datar sebelum mengizinkan penempatan
      // (kecuali WebXR hit-test aktif — sudah punya konfirmasi hardware)
      if (!state.useWebXR && !this.placed) {
        if (!surfaceDetector.isFlat) {
          setStatus(
            "Arahkan kamera ke bidang datar dulu — " +
              Math.round(surfaceDetector.confidence) +
              "% terdeteksi",
            "",
          );
          return;
        }
      }

      let pos;
      if (
        state.useWebXR &&
        this.reticleEl &&
        this.reticleEl.getAttribute("visible")
      ) {
        // Mode WebXR: posisi reticle sudah world-space dari hit-test matrix
        pos = this.reticleEl.getAttribute("position");
      } else if (!state.useWebXR) {
        // ─── MODE FALLBACK (tanpa WebXR) ─────────────────────────────────
        // MASALAH: pos = {0, -1, -1.5} adalah koordinat LOKAL kamera.
        // Ketika kamera bergerak, titik referensinya ikut → objek "melayang".
        //
        // SOLUSI: konversi camera-local → world-space via matrixWorld kamera.
        // Titik 1.5m di depan kamera dalam world space = posisi yang fixed.
        const camera = this.el.sceneEl.camera;
        if (camera && camera.matrixWorld && window.THREE) {
          const localPoint = new THREE.Vector3(0, -0.3, -1.5);
          localPoint.applyMatrix4(camera.matrixWorld);
          pos = { x: localPoint.x, y: localPoint.y, z: localPoint.z };
        } else {
          pos = { x: 0, y: -0.5, z: -1.5 };
        }
      } else {
        return; // WebXR aktif tapi reticle belum muncul di permukaan
      }

      if (!pos) return;

      // Catat posisi world-space agar bisa di-enforce di tick()
      state.placedWorldPos = { x: pos.x, y: pos.y, z: pos.z };
      this.modelEl.setAttribute("position", pos);
      this.modelEl.setAttribute("visible", "true");

      if (!this.placed) {
        this.placed = true;
        state.placed = true;
        setStatus("✓ Objek diletakkan! Gerakkan HP untuk orbit.", "success");
        autoplayAudio("marker");

        // Aktifkan gyroscope tracking setelah objek pertama diletakkan
        if (this.el.sceneEl) {
          this.el.sceneEl.dispatchEvent(new CustomEvent("gyro-start"));
        }

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
      // ── Enforce posisi world-space (fallback mode) ──────────────────────
      // A-Frame kadang me-recalculate posisi lokal relatif parent.
      // Re-set posisi dari state.placedWorldPos setiap frame jika objek
      // sudah diletakkan dan tidak sedang di-drag.
      if (
        state.placedWorldPos &&
        this.placed &&
        !state.useWebXR &&
        this.modelEl
      ) {
        const cur = this.modelEl.getAttribute("position");
        const wp = state.placedWorldPos;
        // Hanya update jika ada drift signifikan (>0.001 meter)
        if (
          Math.abs(cur.x - wp.x) > 0.001 ||
          Math.abs(cur.y - wp.y) > 0.001 ||
          Math.abs(cur.z - wp.z) > 0.001
        ) {
          this.modelEl.setAttribute("position", wp);
        }
      }

      // ── WebXR hit-test ──────────────────────────────────────────────────
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

  // Kamera dengan gyroscope tracking
  // look-controls dinonaktifkan — kita pakai gyro-camera sendiri
  // agar tidak ada konflik dengan drag gesture
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

// ─── GYROSCOPE CAMERA (Kamera bergerak fisik) ─────────────────────────────────
// Membaca DeviceOrientation (alpha/beta/gamma) dari gyroscope HP,
// mengkonversi ke quaternion, lalu menerapkan ke kamera A-Frame setiap frame.
// Objek tetap di world-space — kamera yang berputar mengikuti gerakan HP nyata.

function registerGyroCamera() {
  if (!window.AFRAME || AFRAME.components["gyro-camera"]) return;

  AFRAME.registerComponent("gyro-camera", {
    schema: {
      enabled: { type: "boolean", default: true },
    },

    init: function () {
      const self = this;
      self._active = false;
      self._alpha = 0; // kompas (Z dunia)
      self._beta = 0; // depan-belakang (X lokal)
      self._gamma = 0; // kiri-kanan (Y lokal)
      self._screen = 0; // sudut rotasi layar (portrait=0, landscape=90)
      self._q = new THREE.Quaternion();
      self._qScreen = new THREE.Quaternion();
      self._qWorld = new THREE.Quaternion(); // -90° X agar Y-up ke Z-forward
      self._euler = new THREE.Euler();
      self._degToRad = Math.PI / 180;

      // Quaternion koreksi koordinat: device frame → A-Frame frame
      // Device: Z ke atas. A-Frame: Y ke atas.
      self._qWorld.setFromAxisAngle(new THREE.Vector3(-1, 0, 0), Math.PI / 2);

      self._onOrientation = function (e) {
        self._alpha = e.alpha || 0;
        self._beta = e.beta || 0;
        self._gamma = e.gamma || 0;
        if (!self._active) {
          self._active = true;
          setStatus("Gyroscope aktif — gerakkan HP untuk orbit", "success");
        }
      };

      self._onScreenChange = function () {
        self._screen =
          (screen.orientation && screen.orientation.angle) ||
          window.orientation ||
          0;
      };

      // Minta izin (iOS 13+)
      self._requestAndListen = function () {
        if (
          typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function"
        ) {
          DeviceOrientationEvent.requestPermission()
            .then(function (perm) {
              if (perm === "granted") self._startListening();
              else setStatus("Izin gyroscope ditolak", "error");
            })
            .catch(function () {
              setStatus("Gyroscope tidak tersedia", "error");
            });
        } else {
          self._startListening();
        }
      };

      self._startListening = function () {
        window.addEventListener("deviceorientation", self._onOrientation, {
          passive: true,
        });
        window.addEventListener("orientationchange", self._onScreenChange, {
          passive: true,
        });
        self._onScreenChange();
      };

      self._requestAndListen();
    },

    tick: function () {
      if (!this.data.enabled || !this._active) return;

      const a = this._alpha * this._degToRad;
      const b = this._beta * this._degToRad;
      const g = this._gamma * this._degToRad;

      // Buat euler dari device orientation (ZXY order = standar WebXR)
      this._euler.set(b, a, -g, "ZXY");
      this._q.setFromEuler(this._euler);

      // Koreksi: device frame → Y-up world frame
      this._q.premultiply(this._qWorld);

      // Koreksi rotasi layar (portrait / landscape)
      const screenAngle = -this._screen * this._degToRad;
      this._qScreen.setFromAxisAngle(new THREE.Vector3(0, 0, 1), screenAngle);
      this._q.multiply(this._qScreen);

      // Terapkan ke kamera
      this.el.object3D.quaternion.copy(this._q);
    },

    remove: function () {
      window.removeEventListener("deviceorientation", this._onOrientation);
      window.removeEventListener("orientationchange", this._onScreenChange);
    },
  });
}

// Simpan referensi kamera entity
let _cameraEntity = null;

function getCameraEntity() {
  return _cameraEntity;
}

// ─── TRANSFORM (compat wrappers) ─────────────────────────────────────────────
function applyTransform() {
  orbit.apply();
}
function resetTransform() {
  orbit.reset();
}

// ─── MODE TOGGLE: Gyro ↔ Virtual Orbit ───────────────────────────────────────
let _gyroMode = true; // default: gyroscope

function toggleCameraMode() {
  _gyroMode = !_gyroMode;
  const cam = getCameraEntity();
  if (cam) {
    cam.setAttribute("gyro-camera", "enabled: " + _gyroMode);
    if (!_gyroMode) {
      // Kunci kamera tegak lurus menghadap ke depan
      cam.object3D.quaternion.identity();
      cam.setAttribute("rotation", "0 0 0");
    }
  }
  const btn = qs("#mode-toggle");
  if (btn) {
    btn.textContent = _gyroMode ? "🔄 Gyro" : "✋ Orbit";
    btn.title = _gyroMode
      ? "Gyroscope aktif. Tap untuk ganti ke Orbit virtual."
      : "Orbit virtual aktif. Tap untuk ganti ke Gyroscope.";
  }
  const hint = qs("#gesture-hint");
  if (hint) {
    hint.textContent = _gyroMode
      ? "Gyro: gerakkan HP | Cubit: zoom | 🔄 untuk ganti mode"
      : "Drag: putar | Cubit: zoom | Ketuk 2×: reset";
  }
  setStatus(
    _gyroMode
      ? "Mode Gyro — gerakkan HP untuk mengorbit"
      : "Mode Orbit — drag layar untuk putar",
    "success",
  );
}

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

// ─── ORBIT CONTROLS ──────────────────────────────────────────────────────────
// Setelah objek diletakkan, drag 1 jari = putar scene (orbit virtual).
// Drag vertikal = pitch (rotasi X), drag horizontal = yaw (rotasi Y).
// Cubit 2 jari = zoom (scale objek).
// Double-tap = reset pose.

const orbit = {
  // Sudut orbit saat ini (derajat)
  rotY: 0, // horizontal drag
  rotX: 0, // vertikal drag (tilt atas-bawah)
  scale: 1,

  // Batas
  minX: -60, // jangan sampai objek terlihat dari bawah tanah
  maxX: 60,
  minScale: 0.3,
  maxScale: 3.0,

  // Sensitivitas
  sensitivityY: 0.4,
  sensitivityX: 0.3,

  // Touch state
  _lastX: null,
  _lastY: null,
  _lastDist: null,
  _lastTap: 0,
  _mode: "idle", // "idle" | "placing" | "orbiting"

  init: function (exp) {
    const ia = (exp && exp.interaction) || {};
    this.minScale = Number(ia.minScale || 0.3);
    this.maxScale = Number(ia.maxScale || 3.0);
    this.scale = 1;
    this.rotY = parseRotY((exp && exp.model && exp.model.rotation) || "0 0 0");
    this.rotX = 0;
    this._mode = "placing";
  },

  // Terapkan pose ke model (rotasi + scale)
  apply: function () {
    if (!state.modelEntity) return;
    const s = this.scale * state.baseScale;
    state.modelEntity.object3D.scale.set(s, s, s);
    state.modelEntity.object3D.rotation.order = "YXZ";
    state.modelEntity.object3D.rotation.y = THREE.MathUtils.degToRad(this.rotY);
    state.modelEntity.object3D.rotation.x = THREE.MathUtils.degToRad(this.rotX);
  },

  reset: function () {
    this.rotY = parseRotY(
      (state.experience &&
        state.experience.model &&
        state.experience.model.rotation) ||
        "0 0 0",
    );
    this.rotX = 0;
    this.scale = 1;
    this.apply();
  },
};

function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function bindTouchGestures() {
  const overlay = qs("#touch-overlay");
  if (!overlay) return;

  // ── touchstart ────────────────────────────────────────────────────────────
  overlay.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 2) {
        orbit._lastDist = touchDist(e.touches);
        orbit._lastX = null;
        orbit._lastY = null;
      } else if (e.touches.length === 1) {
        orbit._lastX = e.touches[0].clientX;
        orbit._lastY = e.touches[0].clientY;
        orbit._lastDist = null;

        // Double-tap = reset pose
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

  // ── touchmove ─────────────────────────────────────────────────────────────
  overlay.addEventListener(
    "touchmove",
    function (e) {
      // Mode placing: belum ada objek, abaikan drag
      if (!state.placed) return;

      // ── 2 jari: pinch zoom ──
      if (e.touches.length === 2 && orbit._lastDist !== null) {
        const d = touchDist(e.touches);
        const delta = (d - orbit._lastDist) * 0.008;
        orbit.scale = clamp(
          orbit.scale + delta,
          orbit.minScale / state.baseScale,
          orbit.maxScale / state.baseScale,
        );
        orbit._lastDist = d;
        orbit.apply();
        return;
      }

      // ── 1 jari: orbit (hanya di mode non-gyro) ──
      if (e.touches.length === 1 && orbit._lastX !== null && !_gyroMode) {
        const dx = e.touches[0].clientX - orbit._lastX;
        const dy = e.touches[0].clientY - orbit._lastY;

        orbit.rotY += dx * orbit.sensitivityY;
        orbit.rotX = clamp(
          orbit.rotX - dy * orbit.sensitivityX,
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

  // ── touchend ──────────────────────────────────────────────────────────────
  overlay.addEventListener(
    "touchend",
    function (e) {
      if (e.touches.length < 2) orbit._lastDist = null;
      if (e.touches.length < 1) {
        orbit._lastX = null;
        orbit._lastY = null;
      }
    },
    { passive: true },
  );

  // ── tap: teruskan ke scene untuk penempatan ──
  overlay.addEventListener("click", function () {
    if (state.scene) {
      state.scene.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
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

  const modeToggleBtn = qs("#mode-toggle");
  if (modeToggleBtn) modeToggleBtn.addEventListener("click", toggleCameraMode);

  const playAudioBtn = qs("#play-audio");
  if (playAudioBtn)
    playAudioBtn.addEventListener("click", function () {
      if (state.userStarted) toggleAudio();
    });

  const helpBtn = qs("#marker-help");
  if (helpBtn)
    helpBtn.addEventListener("click", function () {
      window.alert(
        "Cara orbit mengelilingi objek:\n\n" +
          "MODE GYRO (default setelah objek diletakkan):\n" +
          "  — Gerakkan HP fisik ke kiri/kanan/atas → kamera ikut\n" +
          "  — Cubit 2 jari → zoom in/out\n\n" +
          "MODE ORBIT VIRTUAL (tap 🔄 Gyro untuk ganti):\n" +
          "  — Drag 1 jari horizontal → putar objek kiri/kanan\n" +
          "  — Drag 1 jari vertikal → lihat dari atas/depan\n" +
          "  — Cubit 2 jari → zoom\n" +
          "  — Ketuk 2x cepat → reset pose\n\n" +
          "Tombol ↺/↻ Putar, ↑/↓ Atas/Depan, ⊖/⊕ Kecil/Besar\n" +
          "aktif di kedua mode.",
      );
    });

  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const ia = (state.experience && state.experience.interaction) || {};
      const rotStep = Number(ia.rotateStep || 15);
      const sclStep = Number(ia.scaleStep || 0.15);

      switch (btn.dataset.action) {
        case "rotate-left":
          orbit.rotY -= rotStep;
          orbit.apply();
          break;
        case "rotate-right":
          orbit.rotY += rotStep;
          orbit.apply();
          break;
        case "tilt-up":
          orbit.rotX = clamp(orbit.rotX - rotStep, orbit.minX, orbit.maxX);
          orbit.apply();
          break;
        case "tilt-down":
          orbit.rotX = clamp(orbit.rotX + rotStep, orbit.minX, orbit.maxX);
          orbit.apply();
          break;
        case "scale-down":
          orbit.scale = clamp(
            orbit.scale - sclStep,
            orbit.minScale / state.baseScale,
            orbit.maxScale / state.baseScale,
          );
          orbit.apply();
          break;
        case "scale-up":
          orbit.scale = clamp(
            orbit.scale + sclStep,
            orbit.minScale / state.baseScale,
            orbit.maxScale / state.baseScale,
          );
          orbit.apply();
          break;
        case "reset":
          orbit.reset();
          setStatus("Pose direset ✓", "success");
          break;
        default:
          return;
      }
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
      registerGyroCamera();
      await sleep(100);

      const scene = buildScene(state.experience);
      setupAudio(state.experience);
      orbit.init(state.experience);

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

      // 4. Mulai detektor bidang datar
      surfaceDetector.init();

      // Loop update indikator UI setiap 250ms
      state.surfaceUIInterval = setInterval(function () {
        surfaceDetector.updateUI();

        // Sinkronisasi status dengan WebXR reticle jika aktif
        if (state.useWebXR && state.reticleEntity) {
          const visible = state.reticleEntity.getAttribute("visible");
          if (visible) {
            surfaceDetector.confidence = Math.min(
              100,
              surfaceDetector.confidence + 15,
            );
            surfaceDetector.isFlat = true;
          }
        }
      }, 250);

      hideLoading();
      setStatus("Kamera aktif — arahkan ke lantai atau meja.", "success");
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
