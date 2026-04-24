const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

// Configuration for different AR models
const models = [
  {
    id: "demo",
    name: "Demo Cube",
    model: "built-in",
    audio: null,
    autoPlay: false,
    description: "Demo 3D Cube untuk testing",
  },
  {
    id: "sample1",
    name: "Sample Model 1",
    model: "https://example.com/models/sample1.glb",
    audio: "https://example.com/audio/sample1.mp3",
    autoPlay: true,
    description: "Contoh model 3D pertama",
  },
  {
    id: "sample2",
    name: "Sample Model 2",
    model: "https://example.com/models/sample2.glb",
    audio: null,
    autoPlay: false,
    description: "Contoh model 3D kedua",
  },
];

// Generate QR codes
async function generateQRCodes() {
  const qrDir = path.join(__dirname, "../public/qr");

  // Create directory if not exists
  if (!fs.existsSync(qrDir)) {
    fs.mkdirSync(qrDir, { recursive: true });
  }

  console.log("🔄 Generating QR Codes...\n");

  for (const model of models) {
    try {
      const qrData = {
        type: "ar_model",
        model: model.model,
        name: model.name,
        audio: model.audio || undefined,
        autoPlay: model.autoPlay,
        description: model.description,
      };

      const jsonString = JSON.stringify(qrData);
      const fileName = `${model.id}.png`;
      const filePath = path.join(qrDir, fileName);

      // Generate QR code
      await QRCode.toFile(filePath, jsonString, {
        errorCorrectionLevel: "H",
        type: "image/png",
        quality: 0.95,
        margin: 1,
        width: 300,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });

      console.log(`✅ Generated: ${fileName}`);
      console.log(`   Model: ${model.name}`);
      console.log(`   Data size: ${jsonString.length} bytes\n`);
    } catch (error) {
      console.error(`❌ Error generating QR for ${model.id}:`, error.message);
    }
  }

  console.log("✨ QR Code generation complete!");
  console.log(`📁 QR codes saved to: ${qrDir}`);
}

// Generate QR code for custom input
async function generateCustomQRCode(modelUrl, modelName, audioUrl = null) {
  try {
    const qrData = {
      type: "ar_model",
      model: modelUrl,
      name: modelName,
      audio: audioUrl || undefined,
      autoPlay: !audioUrl,
      description: `AR Model: ${modelName}`,
    };

    const qrDir = path.join(__dirname, "../public/qr");
    const customName = `custom_${Date.now()}.png`;
    const filePath = path.join(qrDir, customName);

    await QRCode.toFile(filePath, JSON.stringify(qrData), {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.95,
      margin: 1,
      width: 300,
    });

    console.log(`✅ Custom QR Code generated: ${customName}`);
    return filePath;
  } catch (error) {
    console.error("❌ Error generating custom QR code:", error);
    return null;
  }
}

// Main
generateQRCodes().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Export functions for use in other scripts
module.exports = {
  generateQRCodes,
  generateCustomQRCode,
};
