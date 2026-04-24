// Audio Manager - Handle audio playback and synthesis
let audioContext = null;
let audioElement = null;
let currentAudioSource = null;
let isAudioPlaying = false;
let audioGainNode = null;
let speechSynthesisUtterance = null;

// Initialize Audio Context
function initializeAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (!audioGainNode) {
    audioGainNode = audioContext.createGain();
    audioGainNode.connect(audioContext.destination);
    audioGainNode.gain.value = 0.7;
  }

  // Resume audio context if needed (required by browser autoplay policies)
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

// Load Audio File
function loadAudio(audioUrl, autoPlay = false) {
  try {
    initializeAudio();

    // Create audio element
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.crossOrigin = "anonymous";
    }

    audioElement.src = audioUrl;
    audioElement.addEventListener("play", () => {
      isAudioPlaying = true;
      updateAudioButton();
    });

    audioElement.addEventListener("pause", () => {
      isAudioPlaying = false;
      updateAudioButton();
    });

    audioElement.addEventListener("ended", () => {
      isAudioPlaying = false;
      updateAudioButton();
    });

    audioElement.addEventListener("error", (e) => {
      console.error("Audio loading error:", e);
      updateStatus("Error loading audio", "error");
    });

    if (autoPlay) {
      audioElement.play().catch((error) => {
        console.error("Auto-play error:", error);
      });
    }

    updateAudioButton();
  } catch (error) {
    console.error("Error loading audio:", error);
    updateStatus(`Audio error: ${error.message}`, "error");
  }
}

// Play Audio File
function playAudio(input) {
  try {
    initializeAudio();

    // If input is a URL, treat it as audio file
    if (
      typeof input === "string" &&
      (input.startsWith("http") || input.startsWith("/"))
    ) {
      loadAudio(input, true);
    }
    // If input is text, use text-to-speech
    else if (typeof input === "string") {
      playTextToSpeech(input);
    }
  } catch (error) {
    console.error("Error playing audio:", error);
  }
}

// Toggle Audio Playback
function toggleAudio() {
  try {
    initializeAudio();

    if (!audioElement) {
      console.log("No audio loaded");
      return;
    }

    if (isAudioPlaying) {
      audioElement.pause();
    } else {
      audioElement.play().catch((error) => {
        console.error("Play error:", error);
      });
    }
  } catch (error) {
    console.error("Error toggling audio:", error);
  }
}

// Text-to-Speech (TTS)
function playTextToSpeech(text, language = "id-ID") {
  try {
    // Cancel previous speech if any
    if (speechSynthesisUtterance) {
      window.speechSynthesis.cancel();
    }

    // Create utterance
    speechSynthesisUtterance = new SpeechSynthesisUtterance(text);
    speechSynthesisUtterance.lang = language;
    speechSynthesisUtterance.rate = 0.9;
    speechSynthesisUtterance.pitch = 1.0;
    speechSynthesisUtterance.volume = 0.8;

    // Handle speech events
    speechSynthesisUtterance.onstart = () => {
      isAudioPlaying = true;
      updateAudioButton();
    };

    speechSynthesisUtterance.onend = () => {
      isAudioPlaying = false;
      updateAudioButton();
    };

    speechSynthesisUtterance.onerror = (event) => {
      console.error("TTS error:", event);
      isAudioPlaying = false;
      updateAudioButton();
    };

    // Speak
    window.speechSynthesis.speak(speechSynthesisUtterance);
  } catch (error) {
    console.error("TTS error:", error);
  }
}

// Generate Beep Sound
function playBeep(frequency = 440, duration = 200, type = "sine") {
  try {
    initializeAudio();

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;

    oscillator.connect(gainNode);
    gainNode.connect(audioGainNode);

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + duration / 1000,
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration / 1000);
  } catch (error) {
    console.error("Beep error:", error);
  }
}

// Generate Complex Sound (chord)
function playChord(frequencies = [440, 550, 660], duration = 500) {
  try {
    initializeAudio();

    frequencies.forEach((freq) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = freq;

      oscillator.connect(gainNode);
      gainNode.connect(audioGainNode);

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + duration / 1000,
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration / 1000);
    });
  } catch (error) {
    console.error("Chord error:", error);
  }
}

// Generate QR Scan Sound (success beep)
function playScanSuccessSound() {
  playBeep(800, 100, "sine");
  setTimeout(() => playBeep(1000, 100, "sine"), 150);
}

// Generate Error Sound
function playErrorSound() {
  playBeep(400, 200, "sine");
}

// Update Audio Button
function updateAudioButton() {
  const audioBtn = document.querySelector(".control-btn.audio");
  if (audioBtn) {
    if (isAudioPlaying) {
      audioBtn.textContent = "🔊 Playing";
      audioBtn.style.opacity = "1";
    } else {
      audioBtn.textContent = "🔊 Audio";
      audioBtn.style.opacity = "0.8";
    }
  }
}

// Control Volume
function setVolume(level) {
  if (audioGainNode) {
    audioGainNode.gain.value = Math.max(0, Math.min(1, level));
  }

  if (audioElement) {
    audioElement.volume = Math.max(0, Math.min(1, level));
  }
}

// Get Volume Level
function getVolume() {
  if (audioGainNode) {
    return audioGainNode.gain.value;
  }
  return 0.5;
}

// Visualize Audio (create a simple visualizer)
function createAudioVisualizer(canvasId) {
  try {
    initializeAudio();

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const canvasContext = canvas.getContext("2d");
    const analyser = audioContext.createAnalyser();

    // Connect audio source to analyser
    if (audioElement) {
      const source = audioContext.createMediaElementAudioSource(audioElement);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
    }

    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      canvasContext.fillStyle = "rgb(200, 200, 200)";
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;

        canvasContext.fillStyle = `hsl(${(i / bufferLength) * 360}, 100%, 50%)`;
        canvasContext.fillRect(
          x,
          canvas.height - barHeight,
          barWidth,
          barHeight,
        );

        x += barWidth + 1;
      }
    }

    draw();
  } catch (error) {
    console.error("Visualizer error:", error);
  }
}

// Stop All Audio
function stopAllAudio() {
  try {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    isAudioPlaying = false;
    updateAudioButton();
  } catch (error) {
    console.error("Error stopping audio:", error);
  }
}

// Initialize Audio on first user interaction
document.addEventListener(
  "click",
  () => {
    initializeAudio();
  },
  { once: true },
);

document.addEventListener(
  "touchstart",
  () => {
    initializeAudio();
  },
  { once: true },
);

// Play success sound when 3D model loads
window.addEventListener("load", () => {
  setTimeout(() => {
    playBeep(523.25, 100); // C5 note
  }, 500);
});
