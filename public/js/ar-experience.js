const state = {
  experience: null,
  markerElement: null,
  modelElement: null,
  audioElement: null,
  currentScale: 1,
  baseScale: 1,
  baseRotationY: 0,
  currentRotationY: 0,
  markerVisible: false,
  userStarted: false,
  speechActive: false,
};

function getExperienceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("experience") || "demo-hiro";
}

async function fetchExperiences() {
  const response = await fetch("data/experiences.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load experiences.json (${response.status})`);
  }

  return response.json();
}

function setStatus(message, tone = "") {
  const statusLine = document.getElementById("status-line");
  statusLine.textContent = message;
  statusLine.className = `status-line ${tone}`.trim();
}

function setIntroCopy(experience) {
  document.title = `${experience.title} | AR Experience`;
  document.getElementById("experience-title").textContent = experience.title;
  document.getElementById("experience-description").textContent =
    experience.description || "Tidak ada deskripsi.";
  document.getElementById("boot-text").textContent =
    experience.bootText ||
    "Pastikan marker yang sesuai sudah siap di depan kamera sebelum memulai.";
}

function createMarkerAttributes(markerConfig) {
  if (markerConfig.preset) {
    return { preset: markerConfig.preset };
  }

  if (markerConfig.type === "barcode") {
    return {
      type: "barcode",
      value: String(markerConfig.value),
    };
  }

  if (markerConfig.type === "pattern") {
    return {
      type: "pattern",
      url: markerConfig.patternUrl,
    };
  }

  throw new Error("Marker config tidak valid. Gunakan preset, barcode, atau pattern.");
}

function createModelEntity(experience) {
  const model = experience.model || {};
  const entity = document.createElement("a-entity");
  const directModelUrl = model.src || "";

  if (!directModelUrl) {
    throw new Error("Model source belum diisi di experiences.json.");
  }

  entity.setAttribute("id", "experience-model");
  entity.setAttribute("gltf-model", `url(${directModelUrl})`);
  entity.setAttribute("position", model.position || "0 0.5 0");
  entity.setAttribute("rotation", model.rotation || "0 0 0");
  entity.setAttribute("scale", model.scale || "1 1 1");

  if (model.animationMixer !== false) {
    entity.setAttribute("animation-mixer", "");
  }

  entity.addEventListener("model-loaded", () => {
    setStatus("Model 3D berhasil dimuat. Arahkan kamera ke marker.", "success");
  });

  entity.addEventListener("model-error", () => {
    setStatus("Model 3D gagal dimuat. Periksa path file .glb/.gltf.", "error");
  });

  return entity;
}

function parseScale(scaleString) {
  const parts = (scaleString || "1 1 1")
    .split(/\s+/)
    .map((part) => Number(part));
  const safe = parts.length === 3 ? parts : [1, 1, 1];
  return safe[0] || 1;
}

function parseRotationY(rotationString) {
  const parts = (rotationString || "0 0 0")
    .split(/\s+/)
    .map((part) => Number(part));
  return parts.length >= 2 ? parts[1] || 0 : 0;
}

function applyModelTransform() {
  if (!state.modelElement || !state.experience) {
    return;
  }

  const model = state.experience.model || {};
  const baseRotationX = (model.rotation || "0 0 0").split(/\s+/)[0] || "0";
  const baseRotationZ = (model.rotation || "0 0 0").split(/\s+/)[2] || "0";
  const scaleString = `${state.currentScale} ${state.currentScale} ${state.currentScale}`;
  const rotationString = `${baseRotationX} ${state.currentRotationY} ${baseRotationZ}`;

  state.modelElement.setAttribute("scale", scaleString);
  state.modelElement.setAttribute("rotation", rotationString);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resetModelTransform() {
  state.currentScale = state.baseScale;
  state.currentRotationY = state.baseRotationY;
  applyModelTransform();
}

function setupAudio(experience) {
  const audioConfig = experience.audio || {};

  if (audioConfig.src) {
    const audio = new Audio(audioConfig.src);
    audio.preload = "auto";
    audio.loop = Boolean(audioConfig.loop);
    audio.volume = typeof audioConfig.volume === "number" ? audioConfig.volume : 0.9;
    state.audioElement = audio;
  }
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  state.speechActive = false;
}

function playConfiguredAudio() {
  const audioConfig = state.experience?.audio || {};

  if (state.audioElement) {
    state.audioElement
      .play()
      .then(() => {
        setStatus("Audio diputar.", "success");
      })
      .catch((error) => {
        setStatus(`Audio gagal diputar: ${error.message}`, "error");
      });
    return;
  }

  if (audioConfig.speechText && "speechSynthesis" in window) {
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(audioConfig.speechText);
    utterance.lang = audioConfig.lang || "id-ID";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      state.speechActive = true;
      setStatus("Speech synthesis aktif.", "success");
    };
    utterance.onend = () => {
      state.speechActive = false;
    };
    utterance.onerror = () => {
      state.speechActive = false;
      setStatus("Speech synthesis gagal dijalankan.", "error");
    };
    window.speechSynthesis.speak(utterance);
    return;
  }

  setStatus("Experience ini belum punya audio.", "error");
}

function toggleAudio() {
  if (state.audioElement) {
    if (!state.audioElement.paused) {
      state.audioElement.pause();
      setStatus("Audio dihentikan.");
      return;
    }

    playConfiguredAudio();
    return;
  }

  if (state.speechActive) {
    stopSpeech();
    setStatus("Speech synthesis dihentikan.");
    return;
  }

  playConfiguredAudio();
}

function maybeAutoplayAudio(trigger) {
  const audioConfig = state.experience?.audio || {};

  if (!state.userStarted) {
    return;
  }

  if (trigger === "marker" && audioConfig.autoplayOnMarker) {
    playConfiguredAudio();
  }

  if (trigger === "start" && audioConfig.autoplayOnStart) {
    playConfiguredAudio();
  }
}

function buildMarkerScene(experience) {
  const scene = document.querySelector("a-scene");

  if (state.markerElement) {
    state.markerElement.remove();
  }

  const marker = document.createElement("a-marker");
  const markerAttributes = createMarkerAttributes(experience.marker || {});

  Object.entries(markerAttributes).forEach(([key, value]) => {
    marker.setAttribute(key, value);
  });

  marker.setAttribute("emitevents", "true");
  marker.setAttribute("smooth", "true");
  marker.setAttribute("smooth-count", "8");
  marker.setAttribute("smooth-tolerance", "0.01");
  marker.setAttribute("smooth-threshold", "2");

  const modelEntity = createModelEntity(experience);
  marker.appendChild(modelEntity);
  scene.appendChild(marker);

  state.markerElement = marker;
  state.modelElement = modelEntity;
  state.baseScale = parseScale(experience.model?.scale);
  state.currentScale = state.baseScale;
  state.baseRotationY = parseRotationY(experience.model?.rotation);
  state.currentRotationY = state.baseRotationY;

  marker.addEventListener("markerFound", () => {
    state.markerVisible = true;
    setStatus("Marker terdeteksi. Objek ditempatkan di atas marker.", "success");
    maybeAutoplayAudio("marker");
  });

  marker.addEventListener("markerLost", () => {
    state.markerVisible = false;
    setStatus("Marker hilang dari kamera. Arahkan kembali ke marker.", "");
    if (state.experience?.audio?.pauseOnMarkerLost && state.audioElement) {
      state.audioElement.pause();
    }
  });
}

function bindUi() {
  document.getElementById("play-audio").addEventListener("click", toggleAudio);

  document.getElementById("marker-help").addEventListener("click", () => {
    const hint =
      state.experience?.marker?.printHint ||
      "Siapkan marker yang sesuai dan arahkan kamera ke marker tersebut.";
    window.alert(hint);
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const interaction = state.experience?.interaction || {};
      const rotateStep = Number(interaction.rotateStep || 15);
      const scaleStep = Number(interaction.scaleStep || 0.15);
      const minScale = Number(interaction.minScale || 0.4);
      const maxScale = Number(interaction.maxScale || 2.2);

      switch (button.dataset.action) {
        case "rotate-left":
          state.currentRotationY -= rotateStep;
          break;
        case "rotate-right":
          state.currentRotationY += rotateStep;
          break;
        case "scale-down":
          state.currentScale = clamp(state.currentScale - scaleStep, minScale, maxScale);
          break;
        case "scale-up":
          state.currentScale = clamp(state.currentScale + scaleStep, minScale, maxScale);
          break;
        case "reset":
          resetModelTransform();
          return;
      }

      applyModelTransform();
    });
  });

  document.getElementById("start-ar").addEventListener("click", () => {
    state.userStarted = true;
    document.getElementById("boot-overlay").classList.add("hidden");
    setStatus("AR aktif. Izinkan kamera lalu arahkan ke marker.");
    maybeAutoplayAudio("start");
  });
}

function startAnimationLoop() {
  function step() {
    const interaction = state.experience?.interaction || {};
    if (
      state.markerVisible &&
      state.modelElement &&
      interaction.autoRotate
    ) {
      state.currentRotationY += Number(interaction.autoRotateStep || 0.6);
      applyModelTransform();
    }

    window.requestAnimationFrame(step);
  }

  window.requestAnimationFrame(step);
}

async function main() {
  try {
    bindUi();

    const data = await fetchExperiences();
    const experienceId = getExperienceId();
    const experience = (data.experiences || []).find(
      (item) => item.id === experienceId,
    );

    if (!experience) {
      throw new Error(`Experience "${experienceId}" tidak ditemukan.`);
    }

    state.experience = experience;
    setIntroCopy(experience);
    setupAudio(experience);
    buildMarkerScene(experience);
    startAnimationLoop();
    setStatus("Experience siap. Tekan Mulai AR untuk membuka kamera.");
  } catch (error) {
    setStatus(error.message, "error");
    document.getElementById("boot-text").textContent = error.message;
  }
}

main();
