// AR 3D Viewer - Main 3D Object Management

// Safety check: Ensure GLTFLoader is available
if (typeof THREE !== "undefined" && !THREE.GLTFLoader) {
  console.warn("GLTFLoader not found, attempting to load...");
  const script = document.createElement("script");
  script.src = "https://unpkg.com/three@r128/examples/js/loaders/GLTFLoader.js";
  script.async = false;
  document.head.appendChild(script);
}

// Wait for THREE.js and GLTFLoader to be ready
if (typeof THREE === "undefined") {
  console.error(
    "THREE.js library not loaded! Make sure to include it before this script.",
  );
  throw new Error("THREE.js is required");
}

let scene, camera, renderer, controls;
let currentModel = null;
let modelData = {};
let controlsWarningShown = false;
let gltfLoaderWarningShown = false;

function getDetailedInitError(error) {
  if (typeof THREE === "undefined") {
    return "Three.js gagal dimuat. Periksa koneksi internet atau script CDN.";
  }

  if (
    typeof document !== "undefined" &&
    !document.getElementById("viewer-container")
  ) {
    return "Elemen viewer-container tidak ditemukan di halaman.";
  }

  if (
    error &&
    typeof error.message === "string" &&
    /webgl/i.test(error.message)
  ) {
    return "WebGL tidak tersedia di browser/perangkat ini atau hardware acceleration sedang nonaktif.";
  }

  return error && error.message
    ? `Inisialisasi gagal: ${error.message}`
    : "Inisialisasi scene gagal karena error yang tidak diketahui.";
}

function createFallbackControls(camera, domElement) {
  const initialPosition = camera.position.clone();
  const target = new THREE.Vector3(0, 0, 0);
  let isDragging = false;
  let previousX = 0;
  let previousY = 0;

  const updateLookAt = () => {
    camera.lookAt(target);
  };

  const rotateCamera = (deltaX, deltaY) => {
    const offset = camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const rotationSpeed = 0.01;

    spherical.theta -= deltaX * rotationSpeed;
    spherical.phi -= deltaY * rotationSpeed;
    spherical.phi = Math.max(0.2, Math.min(Math.PI - 0.2, spherical.phi));

    offset.setFromSpherical(spherical);
    camera.position.copy(target.clone().add(offset));
    updateLookAt();
  };

  domElement.addEventListener("pointerdown", (event) => {
    isDragging = true;
    previousX = event.clientX;
    previousY = event.clientY;
    domElement.setPointerCapture(event.pointerId);
  });

  domElement.addEventListener("pointermove", (event) => {
    if (!isDragging) {
      return;
    }

    rotateCamera(event.clientX - previousX, event.clientY - previousY);
    previousX = event.clientX;
    previousY = event.clientY;
  });

  const stopDragging = (event) => {
    isDragging = false;
    if (event && domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
  };

  domElement.addEventListener("pointerup", stopDragging);
  domElement.addEventListener("pointercancel", stopDragging);
  domElement.addEventListener("pointerleave", () => {
    isDragging = false;
  });

  return {
    update() {},
    reset() {
      camera.position.copy(initialPosition);
      updateLookAt();
    },
  };
}

function setCurrentModel(model, modelUrl, modelName, extension) {
  currentModel = model;
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2 / maxDim;
  model.scale.multiplyScalar(scale);

  camera.position.copy(new THREE.Vector3(0, 0, maxDim * 1.5));
  camera.lookAt(0, 0, 0);

  modelData = {
    name: modelName,
    url: modelUrl,
    type: extension,
    loadedAt: new Date(),
    dimensions: size,
  };

  updateObjectDetails();
}

// Initialize Three.js Scene
function initializeScene() {
  const container = document.getElementById("viewer-container");

  if (!container) {
    throw new Error("viewer-container not found");
  }

  if (typeof THREE === "undefined") {
    throw new Error("THREE.js not available");
  }

  // Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeeeeee);
  scene.fog = new THREE.Fog(0xcccccc, 100, 500);

  // Camera setup
  camera = new THREE.PerspectiveCamera(
    75,
    container.clientWidth / container.clientHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 1, 3);
  camera.lookAt(0, 0, 0);

  // Renderer setup
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Controls setup
  if (THREE.TrackballControls) {
    controls = new THREE.TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.autoRotate = false;
  } else {
    controls = createFallbackControls(camera, renderer.domElement);
    controlsWarningShown = true;
  }

  // Lighting
  setupLighting();

  // Handle window resize
  window.addEventListener("resize", onWindowResize);

  // Keyboard and mouse controls
  setupInteractiveControls();

  // Start animation loop
  animate();

  if (controlsWarningShown) {
    updateStatus(
      "TrackballControls gagal dimuat, memakai kontrol fallback lokal.",
      "info",
    );
  }
}

// Setup lighting for better 3D appearance
function setupLighting() {
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  // Directional light (Sun)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(10, 15, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.left = -20;
  directionalLight.shadow.camera.right = 20;
  directionalLight.shadow.camera.top = 20;
  directionalLight.shadow.camera.bottom = -20;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);

  // Point lights for more dynamic lighting
  const pointLight1 = new THREE.PointLight(0xff6b9d, 0.5);
  pointLight1.position.set(-10, 5, 10);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0x4ecdc4, 0.5);
  pointLight2.position.set(10, 5, -10);
  scene.add(pointLight2);
}

// Setup interactive controls
function setupInteractiveControls() {
  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp":
        if (currentModel) currentModel.rotation.x -= 0.1;
        e.preventDefault();
        break;
      case "ArrowDown":
        if (currentModel) currentModel.rotation.x += 0.1;
        e.preventDefault();
        break;
      case "ArrowLeft":
        if (currentModel) currentModel.rotation.y -= 0.1;
        e.preventDefault();
        break;
      case "ArrowRight":
        if (currentModel) currentModel.rotation.y += 0.1;
        e.preventDefault();
        break;
      case "+":
      case "=":
        camera.position.multiplyScalar(0.9);
        e.preventDefault();
        break;
      case "-":
        camera.position.multiplyScalar(1.1);
        e.preventDefault();
        break;
      case " ":
        e.preventDefault();
        toggleAudio();
        break;
      case "r":
      case "R":
        resetCamera();
        break;
    }
  });

  // Mouse wheel zoom
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const zoomSpeed = 0.15;
      const direction = e.deltaY > 0 ? 1 : -1;
      camera.position.multiplyScalar(1 + direction * zoomSpeed);
    },
    { passive: false },
  );
}

// Load 3D Model from URL
async function load3DModel(modelUrl, modelName = "Unknown Model") {
  try {
    showLoading(true);
    updateStatus("Memuat model 3D...", "info");

    // Remove existing model
    if (currentModel) {
      scene.remove(currentModel);
    }

    // Determine file type
    const extension = modelUrl.split(".").pop().toLowerCase();
    let model = null;

    if (extension === "gltf" || extension === "glb") {
      model = await loadGLTFModel(modelUrl);
    } else if (extension === "obj") {
      model = await loadOBJModel(modelUrl);
    } else if (extension === "fbx") {
      model = await loadFBXModel(modelUrl);
    } else {
      // Default to primitive if unknown
      model = createDefaultModel();
    }

    if (model) {
      setCurrentModel(model, modelUrl, modelName, extension);
      updateStatus("Model berhasil dimuat!", "success");
    }

    showLoading(false);
  } catch (error) {
    console.error("Error loading model:", error);
    updateStatus(`Error: ${error.message}`, "error");
    showLoading(false);
  }
}

// Load GLTF/GLB Model
async function loadGLTFModel(url) {
  return new Promise((resolve, reject) => {
    // Check if GLTFLoader is available
    if (!THREE.GLTFLoader) {
      const error = new Error(
        "GLTFLoader tidak tersedia. Script loader GLTF dari CDN kemungkinan gagal dimuat.",
      );
      console.error(error);
      reject(error);
      updateStatus(
        "GLTFLoader tidak tersedia. Model GLB/GLTF eksternal belum bisa dimuat.",
        "error",
      );
      return;
    }

    try {
      const loader = new THREE.GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          // Setup animations if available
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach((clip) => {
              mixer.clipAction(clip).play();
            });
            // Store mixer for animation updates
            model.userData.mixer = mixer;
          }
          resolve(model);
        },
        undefined,
        (error) => {
          console.error("Error loading GLTF model:", error);
          reject(error);
          updateStatus(`Error loading model: ${error.message}`, "error");
        },
      );
    } catch (error) {
      console.error("Error initializing GLTFLoader:", error);
      reject(error);
      updateStatus(`Error: ${error.message}`, "error");
    }
  });
}

// Load OBJ Model
async function loadOBJModel(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.OBJLoader();
    loader.load(
      url,
      (object) => resolve(object),
      undefined,
      (error) => reject(error),
    );
  });
}

// Load FBX Model
async function loadFBXModel(url) {
  return new Promise((resolve, reject) => {
    // FBXLoader would need to be included separately
    reject(new Error("FBX format requires additional loader library"));
  });
}

// Create default 3D model (cube with colors)
function createDefaultModel() {
  const group = new THREE.Group();

  // Create a colorful cube with different colors on each face
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = [
    new THREE.MeshPhongMaterial({ color: 0xff0000 }), // red
    new THREE.MeshPhongMaterial({ color: 0x00ff00 }), // green
    new THREE.MeshPhongMaterial({ color: 0x0000ff }), // blue
    new THREE.MeshPhongMaterial({ color: 0xffff00 }), // yellow
    new THREE.MeshPhongMaterial({ color: 0xff00ff }), // magenta
    new THREE.MeshPhongMaterial({ color: 0x00ffff }), // cyan
  ];

  const cube = new THREE.Mesh(geometry, materials);
  cube.castShadow = true;
  cube.receiveShadow = true;
  group.add(cube);

  // Add a rotating torus around the cube
  const torusGeometry = new THREE.TorusGeometry(1.5, 0.3, 16, 100);
  const torusMaterial = new THREE.MeshPhongMaterial({ color: 0xffa500 });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  torus.castShadow = true;
  torus.receiveShadow = true;
  group.add(torus);

  // Add rotating animation data
  group.userData.autoRotate = true;

  return group;
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Update controls
  controls.update();

  // Update model animations
  if (currentModel && currentModel.userData.mixer) {
    currentModel.userData.mixer.update(0.016); // 60 FPS
  }

  // Auto-rotate if enabled
  if (currentModel && currentModel.userData.autoRotate) {
    currentModel.rotation.x += 0.002;
    currentModel.rotation.y += 0.003;
  }

  // Render scene
  renderer.render(scene, camera);
}

// Reset camera to initial position
function resetCamera() {
  const targetPos = new THREE.Vector3(0, 1, 3);
  camera.position.lerp(targetPos, 0.1);
  controls.reset();
}

// Handle window resize
function onWindowResize() {
  const container = document.getElementById("viewer-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// Toggle fullscreen
function toggleFullscreen() {
  const container = document.getElementById("viewer-container");
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch((err) => {
      alert(`Error: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

// Download current model
function downloadModel() {
  if (!modelData.url) {
    alert("No model loaded to download");
    return;
  }

  const link = document.createElement("a");
  link.href = modelData.url;
  link.download = modelData.name + "." + modelData.type;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Update object details display
function updateObjectDetails() {
  const detailsDiv = document.getElementById("object-details");
  if (!modelData.name) {
    detailsDiv.innerHTML =
      "<p>Scan QR Code atau klik Demo untuk melihat informasi objek 3D</p>";
    return;
  }

  const html = `
        <h4>${modelData.name}</h4>
        <p><strong>Format:</strong> ${modelData.type.toUpperCase()}</p>
        <p><strong>Dimuat:</strong> ${modelData.loadedAt.toLocaleString("id-ID")}</p>
        <p><strong>Dimensi:</strong> ${modelData.dimensions.x.toFixed(2)} x ${modelData.dimensions.y.toFixed(2)} x ${modelData.dimensions.z.toFixed(2)}</p>
        <p><strong>URL:</strong> <small>${modelData.url}</small></p>
    `;
  detailsDiv.innerHTML = html;
}

// Update status message
function updateStatus(message, type = "info") {
  const statusDiv = document.getElementById("viewer-status");
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = "block";

  if (type === "success") {
    setTimeout(() => {
      statusDiv.style.display = "none";
    }, 3000);
  }
}

// Show/hide loading spinner
function showLoading(show) {
  document.getElementById("loading").style.display = show ? "block" : "none";
}

// Load demo object
function loadDemoObject() {
  try {
    showLoading(true);

    // Remove existing model
    if (currentModel) {
      scene.remove(currentModel);
    }

    if (!THREE.GLTFLoader) {
      const fallbackModel = createDefaultModel();
      setCurrentModel(
        fallbackModel,
        "/models/Character.glb",
        "Demo Fallback Cube",
        "fallback",
      );
      showLoading(false);
      gltfLoaderWarningShown = true;
      updateStatus(
        "GLTFLoader gagal dimuat, menampilkan demo fallback bawaan.",
        "info",
      );
      return;
    }

    load3DModel("/models/Character.glb", "Wife");
  } catch (error) {
    console.error("Error loading demo object:", error);
    showLoading(false);
    updateStatus(`Error: ${error.message}`, "error");
  }
}

// Safe wrapper for demo button click
function handleDemoClick() {
  // Check if scene is initialized
  if (!scene || !camera || !renderer) {
    alert("Scene is still initializing. Please wait and try again.");
    console.error("Scene not fully initialized yet");

    // Try again after 1 second
    setTimeout(() => {
      loadDemoObject();
    }, 1000);
    return;
  }

  // Load demo if everything is ready
  if (typeof loadDemoObject === "function") {
    loadDemoObject();
  } else {
    alert("Demo function not ready yet. Please refresh the page.");
    console.error("loadDemoObject function not found");
  }
}

// Add Three.js OBJLoader
const THREE_OBJLoader = `
// OBJLoader added here if needed
`;

// Initialize scene when page loads
window.addEventListener("load", () => {
  try {
    initializeScene();
    updateStatus("Scene initialized successfully", "success");
  } catch (error) {
    console.error("Failed to initialize scene:", error);
    updateStatus(getDetailedInitError(error), "error");
  }
});
