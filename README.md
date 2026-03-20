# Youtify Web — YouTube to MP3 PWA

A mobile-first Progressive Web App to download YouTube videos as MP3.
Works on iPhone, Android, and Desktop browsers.

## Deploy on Render (Free)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Youtify Web App"
git branch -M main
git remote add origin https://github.com/harshalchirde/youtify-web.git
git push -u origin main
```

### Step 2 — Deploy on Render
1. Go to https://render.com → Sign up free
2. Click **"New"** → **"Web Service"**
3. Connect your GitHub repo
4. Fill in:
   - **Name:** youtify
   - **Build Command:** `npm install && pip install yt-dlp`
   - **Start Command:** `node server.js`
   - **Plan:** Free
5. Click **"Create Web Service"**

Your app will be live at:
```
https://youtify.onrender.com
```

## iPhone "App" Install
1. Open your Render URL in Safari on iPhone
2. Tap the **Share** button (square with arrow)
3. Tap **"Add to Home Screen"**
4. Tap **"Add"**

The app now appears on your home screen like a native app! 📱

## Local Development
```bash
npm install
pip install yt-dlp
npm start
# Open http://localhost:3000
```

## Tech Stack
- **Frontend:** HTML + CSS + JS (PWA)
- **Backend:** Node.js + Express
- **Downloader:** yt-dlp
- **Deploy:** Render (free)

Developed by Harshal Chirde
