async function loadExperiences() {
  const response = await fetch("data/experiences.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load experiences.json (${response.status})`);
  }

  return response.json();
}

function resolveBaseUrl(siteConfig) {
  if (siteConfig && siteConfig.baseUrl && !siteConfig.baseUrl.includes("USERNAME")) {
    return siteConfig.baseUrl.replace(/\/$/, "");
  }

  const currentPath = window.location.pathname.replace(/\/index\.html$/, "/");
  return `${window.location.origin}${currentPath}`.replace(/\/$/, "");
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createExperienceCard(experience, baseUrl) {
  const card = document.createElement("article");
  card.className = "card";

  const arUrl = `${baseUrl}/ar.html?experience=${encodeURIComponent(experience.id)}`;
  const qrUrl = `qr/${experience.id}.png`;
  const markerType = experience.marker?.preset
    ? `preset:${experience.marker.preset}`
    : experience.marker?.type || "custom";
  const audioLabel = experience.audio?.src
    ? "file audio"
    : experience.audio?.speechText
      ? "speech synthesis"
      : "tanpa audio";

  const top = document.createElement("div");
  top.className = "card-top";
  top.innerHTML = `
    <div>
      <h3>${experience.title}</h3>
      <p>${experience.description || "Tidak ada deskripsi."}</p>
    </div>
    <span class="badge">${markerType}</span>
  `;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `
    <div><strong>ID:</strong> ${experience.id}</div>
    <div><strong>Marker:</strong> ${experience.marker?.label || markerType}</div>
    <div><strong>Model:</strong> ${experience.model?.src || "-"}</div>
    <div><strong>Audio:</strong> ${audioLabel}</div>
  `;

  const qrBlock = document.createElement("div");
  qrBlock.className = "qr-block";

  const qrFrame = document.createElement("div");
  qrFrame.className = "qr-frame";
  const qrImage = document.createElement("img");
  qrImage.src = qrUrl;
  qrImage.alt = `QR code ${experience.title}`;
  qrImage.loading = "lazy";
  qrImage.addEventListener("error", () => {
    qrFrame.innerHTML =
      '<div class="qr-missing">QR belum dibuat.<br />Jalankan <code>npm run generate-qr</code>.</div>';
  });
  qrFrame.appendChild(qrImage);

  const qrText = document.createElement("div");
  qrText.innerHTML = `
    <p><strong>URL QR:</strong></p>
    <p><code>${arUrl}</code></p>
    <p>${experience.marker?.printHint || "Siapkan marker yang sesuai lalu arahkan kamera ke marker itu."}</p>
  `;

  qrBlock.append(qrFrame, qrText);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    createButton("Buka AR", "primary", () => {
      window.location.href = arUrl;
    }),
    createButton("Salin URL", "secondary", async () => {
      try {
        await navigator.clipboard.writeText(arUrl);
      } catch (error) {
        window.prompt("Salin URL experience ini:", arUrl);
      }
    }),
  );

  card.append(top, meta, qrBlock, actions);
  return card;
}

async function main() {
  const container = document.getElementById("experience-list");

  try {
    const data = await loadExperiences();
    const baseUrl = resolveBaseUrl(data.site);
    const experiences = data.experiences || [];

    if (!experiences.length) {
      container.innerHTML =
        '<div class="empty-state">Belum ada experience. Tambahkan item baru ke <code>public/data/experiences.json</code>.</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    experiences.forEach((experience) => {
      fragment.appendChild(createExperienceCard(experience, baseUrl));
    });
    container.appendChild(fragment);
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        Gagal memuat daftar experience.<br />
        <code>${error.message}</code>
      </div>
    `;
  }
}

main();
