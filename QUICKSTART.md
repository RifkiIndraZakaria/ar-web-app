# Quick Start Guide - AR 3D Web App

## ⚡ 5 Minute Setup

### 1. Install Node.js

If you don't have Node.js installed:

- Download from https://nodejs.org/ (LTS version)
- Install normally

### 2. Open Terminal

```bash
cd d:\.Project\ar-web-app
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start Server

```bash
npm run serve
```

You'll see:

```
Starting up http-server, serving public

Hit CTRL-C to stop the server
```

### 5. Open in Browser

Go to: **http://localhost:8080**

### 6. Test the App

- Click **"Klik untuk Demo"** to load demo cube
- Use mouse to rotate (drag)
- Scroll to zoom
- Click "🔊 Audio" button to hear notification

## 📱 Test with QR Code

### Quick QR Test

1. Open your phone camera
2. Scan any QR code from the page
3. See 3D model appear

### Generate Custom QR

```bash
npm run generate-qr
```

## 🎯 Next Steps

### Add Your Own Model

1. Find a 3D model in GLTF format (https://sketchfab.com)
2. Download the .glb file
3. Upload to a web server
4. Create QR code with model URL
5. Scan with the app!

### Deploy Online

1. Upload `public/` folder to your hosting
2. Share the URL
3. Users can access from anywhere

## 🆘 Troubleshooting

**Server won't start**

```bash
# Kill any process using port 8080
npx lsof -i :8080  # macOS/Linux
netstat -ano | findstr :8080  # Windows
```

**3D model not showing**

- Check model URL is correct
- Ensure file is in GLTF/GLB format
- Check browser console (F12) for errors

**Camera not working**

- Use HTTPS on production
- Check browser permissions
- Grant camera access when prompted

**Audio not playing**

- Click audio button manually
- Check speaker volume
- Some browsers restrict autoplay

## 📚 Full Documentation

See `README.md` for complete guide

## 💬 Need Help?

Check the console (F12 → Console tab) for any error messages
