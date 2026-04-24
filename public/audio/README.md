# AR Web App - Audio Files Guide

This folder should contain audio files to be used with 3D models.

## Supported Formats

- MP3 (recommended for web)
- WAV (high quality, larger size)
- OGG (good compression, browser support)
- Advanced: WebM for streaming

## Audio File Naming Convention

```
model-name_description.mp3
example: robot_background-music.mp3
```

## How to Add Audio

1. **Prepare Audio File**
   - Format: MP3 (best compatibility)
   - Bitrate: 128-192 kbps (balance quality/size)
   - Length: Keep under 5 minutes for web use

2. **Upload to this folder**
   - Place audio file in `public/audio/`
   - Update QR code config with audio URL

3. **Test**
   - Load model with audio QR code
   - Verify audio plays correctly

## Example Audio QR Code Configuration

```json
{
  "type": "ar_model",
  "model": "https://example.com/model.glb",
  "name": "Model Name",
  "audio": "https://example.com/audio/background.mp3",
  "autoPlay": true
}
```

## Audio Optimization Tips

1. **Reduce File Size**
   - Use audio editor (Audacity free) to compress
   - Trim silence from start/end
   - Convert to MP3 with lower bitrate

2. **For Better Quality**
   - Use high-quality source
   - Normalize audio levels
   - Apply compression for consistency

3. **Mobile Optimization**
   - Expected autoplay: May require user gesture
   - Volume: Set default to 70%
   - Length: Recommended < 3 minutes

## Text-to-Speech Alternative

Instead of audio files, you can use browser's Text-to-Speech API:

```javascript
playTextToSpeech("Deskripsi model 3D Anda", "id-ID");
```

Supported languages:

- 'id-ID' - Bahasa Indonesia
- 'en-US' - English
- 'zh-CN' - Chinese
- etc.
