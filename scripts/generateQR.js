const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "../public");
const CONFIG_PATH = path.join(PUBLIC_DIR, "data/experiences.json");
const QR_DIR = path.join(PUBLIC_DIR, "qr");

function readExperienceConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

function resolveBaseUrl(siteConfig) {
  const envBaseUrl = process.env.PUBLIC_BASE_URL;
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, "");
  }

  if (siteConfig && siteConfig.baseUrl && !siteConfig.baseUrl.includes("USERNAME")) {
    return siteConfig.baseUrl.replace(/\/$/, "");
  }

  return "http://localhost:8080";
}

function buildExperienceUrl(baseUrl, experienceId) {
  return `${baseUrl}/ar.html?experience=${encodeURIComponent(experienceId)}`;
}

async function ensureQrDirectory() {
  await fs.promises.mkdir(QR_DIR, { recursive: true });
}

async function generateQRCodes() {
  const config = readExperienceConfig();
  const baseUrl = resolveBaseUrl(config.site);
  const experiences = config.experiences || [];

  await ensureQrDirectory();

  console.log(`Generating QR codes with base URL: ${baseUrl}\n`);

  for (const experience of experiences) {
    const targetUrl = buildExperienceUrl(baseUrl, experience.id);
    const outputPath = path.join(QR_DIR, `${experience.id}.png`);

    await QRCode.toFile(outputPath, targetUrl, {
      errorCorrectionLevel: "H",
      type: "image/png",
      width: 320,
      margin: 1,
      color: {
        dark: "#111111",
        light: "#FFFFFF",
      },
    });

    console.log(`OK  ${experience.id}`);
    console.log(`    URL: ${targetUrl}`);
    console.log(`    File: ${outputPath}\n`);
  }

  console.log("QR generation complete.");
}

generateQRCodes().catch((error) => {
  console.error("Failed to generate QR codes:", error);
  process.exit(1);
});

module.exports = {
  buildExperienceUrl,
  generateQRCodes,
  readExperienceConfig,
  resolveBaseUrl,
};
