const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Resolve yt-dlp binary ─────────────────────────────────────────────────────
function getYtdlp() {
  // On Render/Railway, yt-dlp is installed globally via pip
  return process.env.YTDLP_PATH || 'yt-dlp';
}

// ── GET /api/info?url=... ─────────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const ytdlp = getYtdlp();
  let stdout = '', stderr = '';

  const proc = spawn(ytdlp, [
    '--dump-json', '--no-playlist', '--no-warnings', url
  ]);

  proc.stdout.on('data', (d) => (stdout += d));
  proc.stderr.on('data', (d) => (stderr += d));

  proc.on('close', (code) => {
    if (code !== 0) {
      return res.status(400).json({ error: stderr || 'Failed to fetch video info' });
    }
    try {
      const info = JSON.parse(stdout);
      res.json({
        title: info.title,
        duration: info.duration,
        thumbnail: info.thumbnail,
        uploader: info.uploader,
        viewCount: info.view_count,
      });
    } catch {
      res.status(500).json({ error: 'Invalid response from yt-dlp' });
    }
  });

  proc.on('error', () => {
    res.status(500).json({ error: 'yt-dlp not found on server' });
  });
});

// ── GET /api/download?url=...&title=... ───────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url, title } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const ytdlp = getYtdlp();
  const safeTitle = (title || 'audio')
    .replace(/[<>:"/\\|?*\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80) || 'audio';

  // Write to temp file, then stream to client
  const tmpFile = path.join(os.tmpdir(), `youtify_${Date.now()}.mp3`);

  const args = [
    '--no-playlist', '--no-warnings',
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-o', tmpFile,
    url,
  ];

  res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('X-Title', encodeURIComponent(safeTitle));

  const proc = spawn(ytdlp, args);
  let stderr = '';

  proc.stderr.on('data', (d) => (stderr += d.toString()));

  proc.on('close', (code) => {
    // Check for the actual mp3 file (yt-dlp may append .mp3 to our path)
    let finalFile = tmpFile;
    if (!fs.existsSync(finalFile)) {
      const withExt = tmpFile.replace(/\.mp3$/, '') + '.mp3';
      if (fs.existsSync(withExt)) finalFile = withExt;
    }

    if (fs.existsSync(finalFile)) {
      const stream = fs.createReadStream(finalFile);
      stream.pipe(res);
      stream.on('end', () => {
        try { fs.unlinkSync(finalFile); } catch {}
      });
      stream.on('error', () => {
        try { fs.unlinkSync(finalFile); } catch {}
        if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
      });
    } else {
      res.status(500).json({ error: 'Download failed on server. ' + stderr });
    }
  });

  proc.on('error', () => {
    res.status(500).json({ error: 'yt-dlp not found on server' });
  });
});

// ── SSE progress endpoint ─────────────────────────────────────────────────────
app.get('/api/progress', (req, res) => {
  const { url, title } = req.query;
  if (!url) return res.status(400).end();

  const ytdlp = getYtdlp();
  const safeTitle = (title || 'audio')
    .replace(/[<>:"/\\|?*\r\n]/g, '')
    .replace(/\s+/g, ' ').trim().substring(0, 80) || 'audio';

  const tmpFile = path.join(os.tmpdir(), `youtify_${Date.now()}`);

  // Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const args = [
    '--no-playlist', '--no-warnings', '--newline',
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '-o', tmpFile + '.%(ext)s',
    url,
  ];

  const proc = spawn(ytdlp, args);
  let lastPct = 0;

  proc.stdout.on('data', (data) => {
    data.toString().split('\n').forEach((line) => {
      if (!line.trim()) return;
      const pct = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (pct) {
        const mapped = Math.min((parseFloat(pct[1]) / 100) * 85, 85);
        if (mapped > lastPct) { lastPct = mapped; send({ type: 'progress', percent: mapped }); }
      }
      if (line.includes('[ExtractAudio]')) {
        send({ type: 'progress', percent: 88 });
        send({ type: 'status', message: 'Converting to MP3...' });
      }
    });
  });

  proc.on('close', (code) => {
    // Find the output file
    let finalFile = null;
    const mp3Path = tmpFile + '.mp3';
    const webmPath = tmpFile + '.webm';
    const m4aPath = tmpFile + '.m4a';

    if (fs.existsSync(mp3Path)) finalFile = mp3Path;
    else if (fs.existsSync(webmPath)) finalFile = webmPath;
    else if (fs.existsSync(m4aPath)) finalFile = m4aPath;

    if (finalFile) {
      // Store temp file path in a temp registry file for download
      const regFile = tmpFile + '.reg';
      fs.writeFileSync(regFile, JSON.stringify({ file: finalFile, title: safeTitle }));
      const token = path.basename(tmpFile);
      send({ type: 'done', token, title: safeTitle });
    } else {
      send({ type: 'error', message: 'Download failed on server' });
    }
    res.end();
  });

  proc.on('error', () => {
    send({ type: 'error', message: 'yt-dlp not found on server' });
    res.end();
  });

  req.on('close', () => proc.kill());
});

// ── Token-based file download ─────────────────────────────────────────────────
app.get('/api/file/:token', (req, res) => {
  const { token } = req.params;
  // Sanitize token — only allow safe filenames
  if (!/^youtify_\d+$/.test(token)) return res.status(400).end();

  const regFile = path.join(os.tmpdir(), token + '.reg');
  if (!fs.existsSync(regFile)) return res.status(404).json({ error: 'File not found or expired' });

  try {
    const { file, title } = JSON.parse(fs.readFileSync(regFile, 'utf8'));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File expired' });

    res.setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = fs.createReadStream(file);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(file); fs.unlinkSync(regFile); } catch {}
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => console.log(`Youtify server running on port ${PORT}`));
