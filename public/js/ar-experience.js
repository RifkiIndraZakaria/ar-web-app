/* ══════════════════════════════════════════════════════════════════════
   ar-experience.js  –  WebXR Markerless AR (A-Frame + WebXR hit-test)
   STRATEGI KAMERA YANG BENAR:
   - TIDAK pakai "embedded" — ini mencegah immersive-ar session
   - enterAR() dipanggil dari dalam click handler (user gesture)
   - HUD tetap tampil via DOM Overlay feature
   ES2020 – no classes, no TypeScript
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

const state = {
  experience: null,
  scene: null,
  modelEntity: null,
  reticleEntity: null,
  currentScale: 1,
  baseScale: 1,
  baseRotationY: 0,
  currentRotationY: 0,
  placed: false,
  userStarted: false,
  speechActive: false,
  audioElement: null,
  touch: { lastDist: null, lastX: null },
};

function qs(sel) { return document.querySelector(sel); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function parseScaleX(s) { const n = Number((s||"1 1 1").split(/\s+/)[0]); return isNaN(n)||n===0?1:n; }
function parseRotY(s) { const p=(s||"0 0 0").split(/\s+/).map(Number); return p[1]||0; }
function sleep(ms) { return new Promise(function(r){setTimeout(r,ms);}); }

function getExperienceId() {
  return new URLSearchParams(window.location.search).get("experience") || "demo-hiro";
}

async function fetchExperience() {
  const res = await fetch("data/experiences.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Gagal memuat experiences.json (HTTP " + res.status + ")");
  const data = await res.json();
  const id = getExperienceId();
  const exp = (data.experiences||[]).find(function(e){return e.id===id;});
  if (!exp) throw new Error('Experience "'+id+'" tidak ditemukan.');
  return exp;
}

function setStatus(msg, tone) {
  tone = tone||"";
  const pill = qs("#status-line");
  if (!pill) return;
  pill.className = ["status-pill",tone].filter(Boolean).join(" ");
  const t = pill.querySelector(".status-text");
  if (t) t.textContent = msg;
}

function setPageCopy(exp) {
  document.title = exp.title + " | AR";
  [["#boot-title",exp.title],["#experience-title",exp.title],
   ["#experience-description",exp.description||""],
   ["#boot-text",exp.bootText||"Tekan Mulai AR untuk memulai."]
  ].forEach(function(pair){const el=qs(pair[0]);if(el)el.textContent=pair[1];});
}

function showLoading(msg) {
  const o=qs("#loading-overlay"); if(o)o.classList.remove("hidden");
  const t=qs("#loading-text");    if(t)t.textContent=msg||"Memuat…";
}
function hideLoading(){ const o=qs("#loading-overlay"); if(o)o.classList.add("hidden"); }
function showBoot(){ const o=qs("#boot-overlay"); if(o)o.classList.remove("hidden"); }
function hideBoot(){ const o=qs("#boot-overlay"); if(o)o.classList.add("hidden"); }

async function checkWebXRSupport() {
  if (!window.isSecureContext)
    throw new Error("Halaman harus dibuka melalui HTTPS atau localhost.");
  if (!navigator.xr)
    throw new Error("Browser tidak mendukung WebXR. Gunakan Chrome terbaru di Android.");
  const ok = await navigator.xr.isSessionSupported("immersive-ar");
  if (!ok)
    throw new Error("Perangkat tidak mendukung AR. Pastikan ARCore sudah terinstall (Android) atau gunakan iPhone/iPad dengan ARKit.");
}

// ─── REGISTER KOMPONEN ───────────────────────────────────────────────────────
function registerARComponents() {
  if (!window.AFRAME || AFRAME.components["ar-hit-test-manager"]) return;

  AFRAME.registerComponent("ar-hit-test-manager", {
    schema: {
      modelSrc:      { type:"string",  default:"" },
      modelScale:    { type:"string",  default:"0.8 0.8 0.8" },
      modelRotation: { type:"string",  default:"0 0 0" },
      animMixer:     { type:"boolean", default:true },
    },

    init: function() {
      const self = this;
      self.hitTestSource = null;
      self.hitTestSourceRequested = false;
      self.placed = false;

      // Reticle
      const reticle = document.createElement("a-entity");
      reticle.setAttribute("geometry","primitive:ring; radiusInner:0.05; radiusOuter:0.08; segmentsTheta:32;");
      reticle.setAttribute("material","color:#f97316; shader:flat; side:double; opacity:0.9;");
      reticle.setAttribute("rotation","-90 0 0");
      reticle.setAttribute("visible","false");
      reticle.setAttribute("animation__pulse","property:scale;from:1 1 1;to:1.2 1.2 1.2;dir:alternate;dur:600;loop:true;easing:easeInOutSine;");
      self.el.sceneEl.appendChild(reticle);
      self.reticleEl = reticle;
      state.reticleEntity = reticle;

      // Model
      const model = document.createElement("a-entity");
      model.setAttribute("id","experience-model");
      model.setAttribute("gltf-model","url("+self.data.modelSrc+")");
      model.setAttribute("scale",self.data.modelScale);
      model.setAttribute("rotation",self.data.modelRotation);
      model.setAttribute("visible","false");
      if (self.data.animMixer) model.setAttribute("animation-mixer","");
      model.addEventListener("model-loaded",function(){
        setStatus("Model dimuat ✓ — Arahkan kamera ke lantai lalu tap.", "success");
      });
      model.addEventListener("model-error",function(){
        setStatus("Model gagal dimuat.", "error");
      });
      self.el.sceneEl.appendChild(model);
      self.modelEl = model;
      state.modelEntity = model;

      // Tap untuk meletakkan objek
      self.el.sceneEl.addEventListener("click", function() {
        if (!self.reticleEl.getAttribute("visible")) return;
        const pos = self.reticleEl.getAttribute("position");
        if (!pos) return;
        self.modelEl.setAttribute("position", pos);
        self.modelEl.setAttribute("visible","true");
        if (!self.placed) {
          self.placed = true;
          state.placed = true;
          setStatus("✓ Objek berhasil diletakkan!", "success");
          autoplayAudio("marker");
          const ind = qs("#marker-indicator");
          if (ind) { ind.classList.add("found"); setTimeout(function(){ind.classList.remove("found");},2000); }
        } else {
          setStatus("Objek dipindahkan ✓", "success");
        }
      });
    },

    tick: function() {
      const renderer = this.el.sceneEl.renderer;
      if (!renderer || !renderer.xr) return;
      const xrFrame = renderer.xr.getFrame ? renderer.xr.getFrame() : null;
      if (!xrFrame) return;
      const session = renderer.xr.getSession();
      if (!session) return;

      if (!this.hitTestSourceRequested) {
        this.hitTestSourceRequested = true;
        const self = this;
        session.requestReferenceSpace("viewer")
          .then(function(vs){ return session.requestHitTestSource({space:vs}); })
          .then(function(src){
            self.hitTestSource = src;
            setStatus("Arahkan ke permukaan datar — tap untuk letakkan.", "success");
          })
          .catch(function(e){ console.warn("[hit-test]",e); });
        session.addEventListener("end",function(){
          self.hitTestSource = null;
          self.hitTestSourceRequested = false;
        });
        return;
      }

      if (!this.hitTestSource) return;
      const refSpace = renderer.xr.getReferenceSpace();
      if (!refSpace) return;

      const results = xrFrame.getHitTestResults(this.hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          const m = pose.transform.matrix;
          this.reticleEl.setAttribute("position",{x:m[12],y:m[13],z:m[14]});
          this.reticleEl.setAttribute("visible","true");
        }
      } else {
        if (!this.placed) this.reticleEl.setAttribute("visible","false");
      }
    },
  });
}

// ─── BANGUN SCENE (TANPA embedded!) ─────────────────────────────────────────
function buildScene(exp) {
  let host = qs("#scene-host");
  if (!host) { host=document.createElement("div"); host.id="scene-host"; document.body.prepend(host); }

  const m = exp.model || {};
  const scene = document.createElement("a-scene");

  // KRITIS: JANGAN setAttribute("embedded","")
  // embedded=true → A-Frame TIDAK buat immersive session → kamera tidak muncul

  scene.setAttribute("loading-screen","enabled:false;");
  scene.setAttribute("renderer","antialias:true; alpha:true; premultipliedAlpha:false;");
  scene.setAttribute("vr-mode-ui","enabled:false;");
  scene.setAttribute("background","color:transparent; transparent:true;");

  // Komponen WebXR yang akan meminta immersive-ar session
  // dom-overlay = HUD HTML tetap terlihat di atas AR
  scene.setAttribute("webxr",
    "requiredFeatures: hit-test;" +
    "optionalFeatures: local-floor, dom-overlay;" +
    "overlayElement: #hud;"
  );

  const ambient = document.createElement("a-light");
  ambient.setAttribute("type","ambient"); ambient.setAttribute("intensity","1.0");
  scene.appendChild(ambient);

  const dir = document.createElement("a-light");
  dir.setAttribute("type","directional"); dir.setAttribute("intensity","0.8"); dir.setAttribute("position","1 3 2");
  scene.appendChild(dir);

  const manager = document.createElement("a-entity");
  manager.setAttribute("ar-hit-test-manager",{
    modelSrc: m.src||"",
    modelScale: m.scale||"0.8 0.8 0.8",
    modelRotation: m.rotation||"0 0 0",
    animMixer: m.animationMixer!==false,
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

// ─── TRANSFORM ──────────────────────────────────────────────────────────────
function applyTransform() {
  if (!state.modelEntity||!state.experience) return;
  const rot = ((state.experience.model&&state.experience.model.rotation)||"0 0 0").split(/\s+/);
  const s = state.currentScale;
  state.modelEntity.setAttribute("scale",s+" "+s+" "+s);
  state.modelEntity.setAttribute("rotation",(rot[0]||"0")+" "+state.currentRotationY+" "+(rot[2]||"0"));
}

function resetTransform() {
  state.currentScale=state.baseScale; state.currentRotationY=state.baseRotationY; applyTransform();
}

// ─── AUDIO ──────────────────────────────────────────────────────────────────
function setupAudio(exp) {
  state.audioElement=null;
  const cfg=exp.audio||{};
  if (cfg.src) {
    const a=new Audio(cfg.src); a.preload="auto"; a.loop=Boolean(cfg.loop);
    a.volume=typeof cfg.volume==="number"?cfg.volume:0.9; state.audioElement=a;
  }
}

function playAudio() {
  const cfg=(state.experience&&state.experience.audio)||{};
  if (state.audioElement) { state.audioElement.currentTime=0; state.audioElement.play().catch(function(){}); return; }
  if (cfg.speechText&&"speechSynthesis"in window) {
    window.speechSynthesis.cancel();
    const utt=new SpeechSynthesisUtterance(cfg.speechText);
    utt.lang=cfg.lang||"id-ID"; utt.rate=1; utt.pitch=1;
    utt.onstart=function(){state.speechActive=true;};
    utt.onend=utt.onerror=function(){state.speechActive=false;};
    window.speechSynthesis.speak(utt);
  }
}

function toggleAudio() {
  if (state.audioElement) {
    state.audioElement.paused?state.audioElement.play().catch(function(){}):state.audioElement.pause();
    return;
  }
  if (state.speechActive) { window.speechSynthesis.cancel(); state.speechActive=false; return; }
  playAudio();
}

function autoplayAudio(trigger) {
  if (!state.userStarted) return;
  const cfg=(state.experience&&state.experience.audio)||{};
  if (trigger==="marker"&&cfg.autoplayOnMarker) playAudio();
  if (trigger==="start"&&cfg.autoplayOnStart) playAudio();
}

// ─── GESTUR SENTUH ──────────────────────────────────────────────────────────
function touchDist(t) { return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY); }
let lastTapTime=0;

function bindTouchGestures() {
  // Gestur di HUD (bukan canvas) agar tidak ganggu hit-test tap
  const host=qs("#hud"); if(!host) return;

  host.addEventListener("touchstart",function(e){
    if (e.touches.length===2) { state.touch.lastDist=touchDist(e.touches); }
    else if (e.touches.length===1) {
      state.touch.lastX=e.touches[0].clientX;
      const now=Date.now(); if(now-lastTapTime<300) resetTransform(); lastTapTime=now;
    }
  },{passive:true});

  host.addEventListener("touchmove",function(e){
    if (!state.experience||!state.placed) return;
    const ia=state.experience.interaction||{};
    const min=Number(ia.minScale||0.4),max=Number(ia.maxScale||2.4);
    if (e.touches.length===2&&state.touch.lastDist!==null) {
      const d=touchDist(e.touches);
      state.currentScale=clamp(state.currentScale+(d-state.touch.lastDist)*0.006,min,max);
      state.touch.lastDist=d; applyTransform();
    } else if (e.touches.length===1&&state.touch.lastX!==null) {
      state.currentRotationY+=(e.touches[0].clientX-state.touch.lastX)*0.45;
      state.touch.lastX=e.touches[0].clientX; applyTransform();
    }
  },{passive:true});

  host.addEventListener("touchend",function(e){
    if(e.touches.length<2) state.touch.lastDist=null;
    if(e.touches.length<1) state.touch.lastX=null;
  },{passive:true});
}

// ─── CLEANUP ────────────────────────────────────────────────────────────────
function cleanup() {
  if(state.audioElement) state.audioElement.pause();
  if("speechSynthesis"in window) window.speechSynthesis.cancel();
}

// ─── UI BINDING ─────────────────────────────────────────────────────────────
function bindUI() {
  window.addEventListener("pagehide",cleanup);
  window.addEventListener("beforeunload",cleanup);

  const toggleBtn=qs("#toggle-panel"),infoPanel=qs("#info-panel");
  if(toggleBtn&&infoPanel){
    toggleBtn.addEventListener("click",function(){
      infoPanel.classList.toggle("collapsed");
      toggleBtn.textContent=infoPanel.classList.contains("collapsed")?"+":"−";
    });
  }

  const playAudioBtn=qs("#play-audio");
  if(playAudioBtn) playAudioBtn.addEventListener("click",function(){if(state.userStarted)toggleAudio();});

  const helpBtn=qs("#marker-help");
  if(helpBtn) helpBtn.addEventListener("click",function(){
    window.alert("Cara pakai AR:\n\n1. Arahkan kamera ke lantai/meja rata.\n2. Tunggu lingkaran oranye muncul.\n3. Tap untuk letakkan objek.\n4. Tap lagi untuk pindahkan.\n5. Cubit = ubah ukuran.\n6. Geser = putar.\n7. Ketuk 2x cepat = reset.");
  });

  document.querySelectorAll("[data-action]").forEach(function(btn){
    btn.addEventListener("click",function(){
      const ia=(state.experience&&state.experience.interaction)||{};
      const rot=Number(ia.rotateStep||15),scl=Number(ia.scaleStep||0.15);
      const min=Number(ia.minScale||0.4),max=Number(ia.maxScale||2.4);
      switch(btn.dataset.action){
        case "rotate-left":  state.currentRotationY-=rot; break;
        case "rotate-right": state.currentRotationY+=rot; break;
        case "scale-down":   state.currentScale=clamp(state.currentScale-scl,min,max); break;
        case "scale-up":     state.currentScale=clamp(state.currentScale+scl,min,max); break;
        case "reset":        resetTransform(); return;
        default: return;
      }
      applyTransform();
    });
  });

  // ── Tombol Mulai AR ──────────────────────────────────────────────────────
  const startBtn=qs("#start-ar");
  if(!startBtn) return;

  startBtn.addEventListener("click", async function() {
    startBtn.disabled=true;
    const lbl=startBtn.querySelector("span:last-child");
    if(lbl) lbl.textContent="Memulai…";

    try {
      await checkWebXRSupport();
      if(!window.AFRAME) throw new Error("Library A-Frame gagal dimuat. Refresh halaman.");

      showLoading("Membangun scene AR…");
      hideBoot();

      registerARComponents();
      await sleep(150);

      const scene = buildScene(state.experience);
      setupAudio(state.experience);

      const hud=qs("#hud");
      if(hud) hud.classList.remove("hidden");

      if(window.innerWidth<=480){
        const ip=qs("#info-panel"),tb=qs("#toggle-panel");
        if(ip) ip.classList.add("collapsed"); if(tb) tb.textContent="+";
      }

      state.userStarted=true;
      bindTouchGestures();
      setStatus("Memulai sesi AR…");

      // enterAR() HARUS dipanggil dari dalam user gesture (click ini)
      // agar browser mengizinkan kamera WebXR.
      // Jika scene belum siap, tunggu event "loaded" dulu.
      function doEnterAR() {
        return scene.enterAR()
          .then(function(){
            setStatus("Kamera aktif — arahkan ke lantai…");
            hideLoading();
            autoplayAudio("start");
          })
          .catch(function(err){
            setStatus("Gagal masuk AR: "+err.message, "error");
            hideLoading();
          });
      }

      if(scene.hasLoaded || scene.renderStarted) {
        await doEnterAR();
      } else {
        await new Promise(function(resolve){
          scene.addEventListener("loaded", function(){
            doEnterAR().then(resolve);
          }, {once:true});
          // Timeout fallback 5 detik
          setTimeout(function(){ doEnterAR().then(resolve); }, 5000);
        });
      }

      scene.addEventListener("enter-vr", function(){
        setStatus("AR aktif — arahkan kamera ke lantai.", "success");
        document.body.classList.add("xr-active");
      });

      scene.addEventListener("exit-vr", function(){
        document.body.classList.remove("xr-active");
        setStatus("Sesi AR berakhir.", "");
      });

    } catch(err) {
      hideLoading(); showBoot();
      setStatus(err.message,"error");
      const btxt=qs("#boot-text"); if(btxt) btxt.textContent=err.message;
    } finally {
      startBtn.disabled=false;
      if(lbl) lbl.textContent="Mulai AR";
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

    const startBtn=qs("#start-ar");
    if(!window.isSecureContext) {
      setStatus("Halaman belum HTTPS — kamera tidak bisa diakses.","error");
      if(startBtn) startBtn.disabled=true;
    } else if(!navigator.xr) {
      const msg="WebXR tidak tersedia. Gunakan Chrome terbaru di Android.";
      setStatus(msg,"error");
      if(startBtn){ startBtn.disabled=true; const lbl=startBtn.querySelector("span:last-child"); if(lbl) lbl.textContent="Tidak Didukung"; }
      const btxt=qs("#boot-text"); if(btxt) btxt.textContent=msg;
    } else {
      setStatus("Siap. Tekan Mulai AR.");
      if(startBtn) startBtn.disabled=false;
    }
  } catch(err) {
    setStatus(err.message,"error");
    const btxt=qs("#boot-text"); if(btxt) btxt.textContent=err.message;
  }
}

main();