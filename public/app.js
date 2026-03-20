/* ══════════════════════════════════════════
   YOUTIFY WEB — Frontend App Logic
══════════════════════════════════════════ */

// ── DOM ───────────────────────────────────
const $ = (id) => document.getElementById(id);

const urlInput     = $('urlInput');
const pasteBtn     = $('pasteBtn');
const fetchBtn     = $('fetchBtn');
const fetchLabel   = $('fetchLabel');
const fetchSpinner = $('fetchSpinner');
const urlError     = $('urlError');
const previewCard  = $('previewCard');
const thumbnail    = $('thumbnail');
const durBadge     = $('durBadge');
const videoTitle   = $('videoTitle');
const videoUploader= $('videoUploader');
const downloadCard = $('downloadCard');
const downloadBtn  = $('downloadBtn');
const progressWrap = $('progressWrap');
const progressFill = $('progressFill');
const progressPct  = $('progressPct');
const progressLabel= $('progressLabel');
const progressStatus=$('progressStatus');
const successBanner= $('successBanner');
const errorBanner  = $('errorBanner');
const errorText    = $('errorText');
const themeBtn     = $('themeBtn');
const stepsCard    = $('stepsCard');
const installBanner= $('installBanner');
const installClose = $('installClose');

// ── State ─────────────────────────────────
const state = { videoInfo: null, downloading: false };

// ── Init ──────────────────────────────────
function init() {
  // Theme
  const saved = localStorage.getItem('theme');
  if (saved === 'light') document.body.classList.add('light');

  // Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // iOS install banner
  const isIos = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
  const isStandalone = window.navigator.standalone;
  const dismissed = localStorage.getItem('installDismissed');
  if (isIos && !isStandalone && !dismissed) {
    installBanner.classList.remove('hidden');
  }

  bindEvents();
}

// ── Events ────────────────────────────────
function bindEvents() {
  // Paste button
  pasteBtn.addEventListener('click', async () => {
    try {
      const txt = await navigator.clipboard.readText();
      urlInput.value = txt.trim();
      if (isYtUrl(txt.trim())) autoFetch();
    } catch {
      // Clipboard API not available — focus input instead
      urlInput.focus();
      showUrlError('Tap the URL bar and paste manually');
    }
  });

  // Auto-detect on paste
  urlInput.addEventListener('paste', () => {
    setTimeout(() => { if (isYtUrl(urlInput.value.trim())) autoFetch(); }, 60);
  });

  urlInput.addEventListener('input', () => {
    hideUrlError();
    urlInput.style.color = isYtUrl(urlInput.value.trim()) ? 'var(--ok)' : '';
  });

  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchInfo(); });

  fetchBtn.addEventListener('click', fetchInfo);
  downloadBtn.addEventListener('click', startDownload);
  themeBtn.addEventListener('click', toggleTheme);

  installClose.addEventListener('click', () => {
    installBanner.classList.add('hidden');
    localStorage.setItem('installDismissed', '1');
  });
}

// ── Auto-fetch ────────────────────────────
let autoTimer;
function autoFetch() { clearTimeout(autoTimer); autoTimer = setTimeout(fetchInfo, 400); }

// ── Fetch Video Info ──────────────────────
async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) { showUrlError('Please enter a YouTube URL'); return; }
  if (!isYtUrl(url)) { showUrlError('Please enter a valid YouTube URL'); return; }

  hideUrlError();
  setFetchLoading(true);
  hideCards();
  hideFeedback();

  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch video info');

    state.videoInfo = data;
    showPreview(data);
    downloadCard.classList.remove('hidden');
    stepsCard.classList.add('hidden');
  } catch (err) {
    showUrlError(err.message || 'Failed to fetch. Check the URL and try again.');
  } finally {
    setFetchLoading(false);
  }
}

// ── Show Preview ──────────────────────────
function showPreview(info) {
  thumbnail.src = info.thumbnail || '';
  thumbnail.onerror = () => { thumbnail.style.display = 'none'; };
  durBadge.textContent = fmtDur(info.duration);
  videoTitle.textContent = info.title || 'Unknown Title';
  videoUploader.textContent = info.uploader || '';
  previewCard.classList.remove('hidden');
}

function hideCards() {
  previewCard.classList.add('hidden');
  downloadCard.classList.add('hidden');
}

// ── Download with SSE Progress ────────────
async function startDownload() {
  if (state.downloading || !state.videoInfo) return;

  state.downloading = true;
  hideFeedback();
  downloadBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressPct.textContent = '0%';
  progressLabel.textContent = 'Starting...';
  progressStatus.textContent = '';

  const url = urlInput.value.trim();
  const title = state.videoInfo.title || 'audio';

  try {
    await new Promise((resolve, reject) => {
      const evtUrl = `/api/progress?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
      const es = new EventSource(evtUrl);

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'progress') {
            const pct = Math.min(data.percent, 100);
            progressFill.style.width = pct + '%';
            progressPct.textContent = pct.toFixed(1) + '%';
            if (pct < 5)        progressLabel.textContent = 'Starting...';
            else if (pct < 85)  progressLabel.textContent = 'Downloading audio...';
            else if (pct < 99)  progressLabel.textContent = 'Converting to MP3...';
            else                progressLabel.textContent = 'Almost done...';
          }

          if (data.type === 'status') {
            progressStatus.textContent = data.message?.substring(0, 100) || '';
          }

          if (data.type === 'done') {
            es.close();
            progressFill.style.width = '98%';
            progressPct.textContent = '98%';
            progressLabel.textContent = 'Preparing download...';

            // Trigger file download
            const a = document.createElement('a');
            a.href = `/api/file/${data.token}`;
            a.download = `${data.title || 'audio'}.mp3`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => {
              progressFill.style.width = '100%';
              progressPct.textContent = '100%';
              resolve();
            }, 800);
          }

          if (data.type === 'error') {
            es.close();
            reject(new Error(data.message));
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        reject(new Error('Connection lost. Please try again.'));
      };
    });

    // Success
    setTimeout(() => {
      progressWrap.classList.add('hidden');
      successBanner.classList.remove('hidden');
    }, 600);

  } catch (err) {
    progressWrap.classList.add('hidden');
    showError(err.message || 'Download failed. Please try again.');
  } finally {
    state.downloading = false;
    downloadBtn.disabled = false;
  }
}

// ── UI Helpers ────────────────────────────
function setFetchLoading(on) {
  fetchBtn.disabled = on;
  fetchBtn.classList.toggle('loading', on);
  fetchLabel.style.opacity = on ? '0' : '1';
  fetchSpinner.classList.toggle('hidden', !on);
}

function hideFeedback() {
  progressWrap.classList.add('hidden');
  successBanner.classList.add('hidden');
  errorBanner.classList.add('hidden');
}

function showError(msg) { errorBanner.classList.remove('hidden'); errorText.textContent = msg; }
function showUrlError(msg) { urlError.classList.remove('hidden'); urlError.textContent = msg; }
function hideUrlError() { urlError.classList.add('hidden'); }

function toggleTheme() {
  const light = document.body.classList.toggle('light');
  localStorage.setItem('theme', light ? 'light' : 'dark');
}

// ── Utils ─────────────────────────────────
function isYtUrl(u) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/.test(u);
}
function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}
function p2(n) { return String(n).padStart(2,'0'); }

// ── Boot ──────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
