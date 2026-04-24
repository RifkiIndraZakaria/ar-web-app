// QR Code Scanner - Detect and parse QR codes
let codeReader;
let isScanning = false;
let videoStream = null;

// Initialize QR Code Reader
function initializeQRScanner() {
  codeReader = new ZXing.BrowserMultiFormatReader();
}

// Start QR Code Scanning
async function startScanning() {
  try {
    if (!codeReader) {
      initializeQRScanner();
    }

    isScanning = true;
    const videoElement = document.getElementById("qr-scanner");

    updateScannerStatus("Requesting camera access...", "info");

    // Request camera access
    const videoInputDevices = await codeReader.listVideoInputDevices();

    if (videoInputDevices.length === 0) {
      updateScannerStatus("No camera found", "error");
      return;
    }

    const selectedDeviceId = videoInputDevices[0].deviceId;

    // Decode continuously
    const result = await codeReader.decodeFromVideoDevice(
      selectedDeviceId,
      videoElement,
      (result, err) => {
        if (result) {
          // QR Code detected
          onQRCodeDetected(result);
        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
          console.error("Scanning error:", err);
        }
      },
    );

    updateScannerStatus("Camera active - scanning for QR codes", "success");
  } catch (error) {
    console.error("Error starting scanner:", error);

    if (error.name === "NotAllowedError") {
      updateScannerStatus("Camera permission denied", "error");
    } else if (error.name === "NotFoundError") {
      updateScannerStatus("No camera device found", "error");
    } else {
      updateScannerStatus(`Error: ${error.message}`, "error");
    }

    isScanning = false;
  }
}

// Stop QR Code Scanning
function stopScanning() {
  try {
    if (codeReader) {
      codeReader.reset();
    }
    isScanning = false;
    updateScannerStatus("Scanning stopped", "info");
  } catch (error) {
    console.error("Error stopping scanner:", error);
  }
}

// Handle QR Code Detection
function onQRCodeDetected(result) {
  const qrData = result.text;
  console.log("QR Code detected:", qrData);

  stopScanning();
  updateScannerStatus("QR Code detected! Processing...", "success");

  // Parse QR code data
  parseQRData(qrData);
}

// Parse QR Code Data
function parseQRData(qrData) {
  try {
    // Check if it's a JSON structure
    if (qrData.startsWith("{") || qrData.startsWith("[")) {
      handleJSONQR(JSON.parse(qrData));
    }
    // Check if it's a URL
    else if (qrData.startsWith("http://") || qrData.startsWith("https://")) {
      handleURLQR(qrData);
    }
    // Check if it's a custom format
    else if (qrData.includes("|")) {
      handleCustomFormatQR(qrData);
    }
    // Default: treat as model URL
    else {
      handleModelURLQR(qrData);
    }
  } catch (error) {
    console.error("Error parsing QR data:", error);
    updateScannerStatus(`Error parsing QR code: ${error.message}`, "error");
  }
}

// Handle JSON format QR code
function handleJSONQR(data) {
  try {
    if (data.type === "ar_model") {
      const config = {
        modelUrl: data.model || data.url,
        modelName: data.name || "Loaded Model",
        audioUrl: data.audio,
        audioAutoPlay: data.autoPlay !== false,
        description: data.description,
      };

      loadARModel(config);
    } else {
      updateScannerStatus("Invalid QR format", "error");
    }
  } catch (error) {
    console.error("Error handling JSON QR:", error);
    updateScannerStatus(`Error: ${error.message}`, "error");
  }
}

// Handle URL format QR code
function handleURLQR(url) {
  // Fetch model data from URL
  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      const config = {
        modelUrl: data.model || data.url,
        modelName: data.name || "Loaded Model",
        audioUrl: data.audio,
        audioAutoPlay: data.autoPlay !== false,
        description: data.description,
      };
      loadARModel(config);
    })
    .catch((error) => {
      console.error("Error fetching QR URL:", error);
      // Try to load URL as direct model
      loadARModel({
        modelUrl: url,
        modelName: "Model from QR",
        audioUrl: null,
        audioAutoPlay: false,
      });
    });
}

// Handle custom format QR code
// Format: model_url|audio_url|model_name
function handleCustomFormatQR(data) {
  const parts = data.split("|");
  const config = {
    modelUrl: parts[0]?.trim(),
    audioUrl: parts[1]?.trim() || null,
    modelName: parts[2]?.trim() || "Loaded Model",
    audioAutoPlay: parts[3]?.trim() === "auto" ? true : false,
  };

  if (!config.modelUrl) {
    updateScannerStatus("Invalid custom format", "error");
    return;
  }

  loadARModel(config);
}

// Handle direct model URL QR code
function handleModelURLQR(url) {
  loadARModel({
    modelUrl: url,
    modelName: "Model from QR",
    audioUrl: null,
    audioAutoPlay: false,
  });
}

// Load AR Model with configuration
function loadARModel(config) {
  console.log("Loading AR Model:", config);

  // Show loading status
  document.getElementById("scanner-status").style.display = "none";

  // Load the 3D model
  load3DModel(config.modelUrl, config.modelName || "Loaded Model");

  // Load audio if provided
  if (config.audioUrl) {
    loadAudio(config.audioUrl, config.audioAutoPlay);
  } else {
    // Provide default audio feedback
    const message = `Successfully loaded ${config.modelName}. Use mouse to rotate and scroll to zoom.`;
    playAudio(message);
  }

  // Show model description if available
  if (config.description) {
    const details = document.getElementById("object-details");
    details.innerHTML = `<h4>${config.modelName}</h4><p>${config.description}</p>`;
  }
}

// Update scanner status message
function updateScannerStatus(message, type = "info") {
  const statusDiv = document.getElementById("scanner-status");
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = "block";

  if (type === "error") {
    setTimeout(() => {
      statusDiv.style.display = "none";
    }, 5000);
  }
}

// Generate QR Code for sharing
function generateShareQRCode(modelData) {
  const qrData = {
    type: "ar_model",
    model: modelData.url,
    name: modelData.name,
    audio: modelData.audioUrl || undefined,
    description: modelData.description || undefined,
  };

  return JSON.stringify(qrData);
}

// Create downloadable QR Code
function createQRCode(data) {
  return new Promise((resolve, reject) => {
    try {
      QRCode.toDataURL(
        data,
        {
          errorCorrectionLevel: "H",
          type: "image/png",
          quality: 0.95,
          margin: 1,
          width: 300,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        },
        (err, url) => {
          if (err) reject(err);
          else resolve(url);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

// Initialize QR Scanner on page load
window.addEventListener("load", () => {
  setTimeout(() => {
    try {
      initializeQRScanner();
      console.log("QR Scanner initialized");
    } catch (error) {
      console.error("Failed to initialize QR Scanner:", error);
    }
  }, 500);
});
