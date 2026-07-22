const dropzone = document.getElementById('dropzone');
const dropzoneContent = document.getElementById('dropzoneContent');
const fileInput = document.getElementById('fileInput');
const submitBtn = document.getElementById('submitBtn');
const submitLabel = document.getElementById('submitLabel');
const formatSelect = document.getElementById('format');
const formatWarning = document.getElementById('formatWarning');
const errorBox = document.getElementById('errorBox');
const resultBox = document.getElementById('result');
const downloadBtn = document.getElementById('downloadBtn');

let selectedFile = null;
let resultBlob = null;
let resultFilename = 'resized-image';

// Theme Toggle
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('pixelfit-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('pixelfit-theme', next);
});

// ═══════════════════════════════════════════════
//  FULL-SCREEN GEOMETRIC MESH BACKGROUND
// ═══════════════════════════════════════════════
(function initGeoBg() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, t = 0;

  // Grid config
  const COLS = 14;      // vertical lines
  const ROWS = 9;       // horizontal lines
  const DIAG_SPEED = 0.18; // diagonal scroll speed (px/frame)

  // Streaks: glowing beams traveling along grid lines
  const streaks = [];
  const STREAK_COUNT = 6;

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Build initial streaks
  function makeStreak() {
    const horizontal = Math.random() > 0.4; // bias horizontal slightly
    return {
      horizontal,
      // which grid line index it travels on (fractional for smooth creation)
      track: Math.floor(Math.random() * (horizontal ? ROWS : COLS)),
      pos: Math.random() * (horizontal ? W : H),  // current position along the line
      speed: (1 + Math.random() * 2.5) * (Math.random() > 0.5 ? 1 : -1),
      len: 60 + Math.random() * 140,   // streak length in px
      alpha: 0.6 + Math.random() * 0.4,
      width: 1.5 + Math.random() * 1.5,
    };
  }

  for (let i = 0; i < STREAK_COUNT; i++) {
    const s = makeStreak();
    // Spread initial positions
    s.pos = Math.random() * (s.horizontal ? W : H);
    streaks.push(s);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    t += 1;

    const dark = isDark();
    const gridColor   = dark ? 'rgba(140, 100, 255, 0.08)' : 'rgba(100, 60, 220, 0.07)';
    const nodeColor   = dark ? 'rgba(160, 110, 255, 0.22)' : 'rgba(100, 55, 210, 0.16)';
    const streakColor = dark ? [160, 100, 255] : [100, 50, 220];
    const accentNode  = dark ? 'rgba(236, 72, 153, 0.35)'  : 'rgba(236, 72, 153, 0.22)';

    // ── 1. Grid — diagonal scrolling offset ──
    const offX = (t * DIAG_SPEED) % (W / COLS);
    const offY = (t * DIAG_SPEED * 0.6) % (H / ROWS);

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    // Vertical lines (scroll horizontally)
    for (let c = -1; c <= COLS + 1; c++) {
      const x = (c * (W / COLS) + offX) % (W + W / COLS) - W / COLS;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // Horizontal lines (scroll vertically)
    for (let r = -1; r <= ROWS + 1; r++) {
      const y = (r * (H / ROWS) + offY) % (H + H / ROWS) - H / ROWS;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // ── 2. Intersection dots ──
    for (let c = -1; c <= COLS + 1; c++) {
      for (let r = -1; r <= ROWS + 1; r++) {
        const x = (c * (W / COLS) + offX) % (W + W / COLS) - W / COLS;
        const y = (r * (H / ROWS) + offY) % (H + H / ROWS) - H / ROWS;

        // pulse radius via sine
        const pulse = Math.sin(t * 0.04 + c * 0.7 + r * 0.9) * 0.5 + 0.5;
        const r0 = 1.5 + pulse * 1.5;

        // Accent every ~4th node
        const isAccent = (c + r) % 4 === 0;
        ctx.beginPath();
        ctx.arc(x, y, r0, 0, Math.PI * 2);
        ctx.fillStyle = isAccent ? accentNode : nodeColor;
        ctx.fill();
      }
    }

    // ── 3. Moving streaks ──
    streaks.forEach(s => {
      s.pos += s.speed;

      // Reset when off-screen
      const bound = s.horizontal ? W : H;
      if (s.speed > 0 && s.pos > bound + s.len) {
        s.pos = -s.len;
        s.track = Math.floor(Math.random() * (s.horizontal ? ROWS : COLS));
        s.speed = (1 + Math.random() * 2.5);
        s.len = 60 + Math.random() * 140;
      }
      if (s.speed < 0 && s.pos < -s.len) {
        s.pos = bound + s.len;
        s.track = Math.floor(Math.random() * (s.horizontal ? ROWS : COLS));
        s.speed = -(1 + Math.random() * 2.5);
        s.len = 60 + Math.random() * 140;
      }

      // Compute pixel coordinate for this streak's grid line
      if (s.horizontal) {
        const lineY = (s.track * (H / ROWS) + offY) % (H + H / ROWS) - H / ROWS;
        const x0 = s.pos - s.len / 2;
        const x1 = s.pos + s.len / 2;

        const grad = ctx.createLinearGradient(x0, lineY, x1, lineY);
        grad.addColorStop(0,    `rgba(${streakColor},0)`);
        grad.addColorStop(0.5,  `rgba(${streakColor},${s.alpha})`);
        grad.addColorStop(1,    `rgba(${streakColor},0)`);

        ctx.beginPath();
        ctx.moveTo(x0, lineY);
        ctx.lineTo(x1, lineY);
        ctx.strokeStyle = grad;
        ctx.lineWidth = s.width;
        ctx.stroke();

        // Glow dot at head
        ctx.beginPath();
        ctx.arc(s.pos, lineY, s.width * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${streakColor},${s.alpha * 0.9})`;
        ctx.fill();
      } else {
        const lineX = (s.track * (W / COLS) + offX) % (W + W / COLS) - W / COLS;
        const y0 = s.pos - s.len / 2;
        const y1 = s.pos + s.len / 2;

        const grad = ctx.createLinearGradient(lineX, y0, lineX, y1);
        grad.addColorStop(0,    `rgba(${streakColor},0)`);
        grad.addColorStop(0.5,  `rgba(${streakColor},${s.alpha})`);
        grad.addColorStop(1,    `rgba(${streakColor},0)`);

        ctx.beginPath();
        ctx.moveTo(lineX, y0);
        ctx.lineTo(lineX, y1);
        ctx.strokeStyle = grad;
        ctx.lineWidth = s.width;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(lineX, s.pos, s.width * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${streakColor},${s.alpha * 0.9})`;
        ctx.fill();
      }
    });

    requestAnimationFrame(draw);
  }

  draw();
})();



dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showError('Please select a valid image file.');
    return;
  }
  selectedFile = file;
  hideError();
  updateFilePreview();
  submitBtn.disabled = false;
  submitLabel.textContent = 'Resize image';
}

function updateFilePreview() {
  if (!selectedFile) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    dropzoneContent.innerHTML = `
      <img src="${e.target.result}" alt="preview">
      <div class="filename">${selectedFile.name} (${formatBytes(selectedFile.size)})</div>
    `;
  };
  reader.readAsDataURL(selectedFile);
}

document.getElementById('unit').addEventListener('change', () => {
  updateFilePreview();
  // Also hide result box since unit changed and the old result is now stale
  resultBox.classList.remove('visible');
});

formatSelect.addEventListener('change', () => {
  if (formatSelect.value !== 'jpeg') {
    formatWarning.textContent = 'Non-JPEG formats may not hit the exact target size — ' +
      'PNG/WebP have fewer compression levers than JPEG. We\'ll get as close as possible.';
    formatWarning.classList.add('visible');
  } else {
    formatWarning.classList.remove('visible');
  }
});

submitBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  const targetSize = parseFloat(document.getElementById('targetSize').value);
  const unit = document.getElementById('unit').value;
  const format = formatSelect.value;

  if (!targetSize || targetSize <= 0) {
    showError('Enter a valid target size greater than 0.');
    return;
  }

  hideError();
  resultBox.classList.remove('visible');
  setLoading(true);

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('target_size', targetSize);
  formData.append('unit', unit);
  formData.append('output_format', format);

  try {
    const { blob, metadata } = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let startTime = Date.now();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          document.getElementById('progressFill').style.width = percent + '%';
          document.getElementById('progressFill').classList.remove('processing');
          
          if (percent === 100) {
            document.getElementById('progressStatus').textContent = 'Resizing image...';
            document.getElementById('progressEta').textContent = '';
            document.getElementById('progressFill').classList.add('processing');
          } else {
            document.getElementById('progressStatus').textContent = 'Uploading...';
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = e.loaded / elapsed;
            const remaining = (e.total - e.loaded) / speed;
            document.getElementById('progressEta').textContent = 
              isFinite(remaining) && remaining > 0 ? `ETA: ${Math.ceil(remaining)}s` : '';
          }
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const metadataHeader = xhr.getResponseHeader('X-Resize-Metadata');
          const metadata = metadataHeader ? JSON.parse(metadataHeader) : null;
          resolve({ blob: xhr.response, metadata });
        } else {
          // If error, the response is a Blob containing the JSON error
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const errData = JSON.parse(reader.result);
              reject(new Error(errData.detail || 'Request failed.'));
            } catch {
              reject(new Error('Request failed.'));
            }
          };
          reader.readAsText(xhr.response);
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error.')));
      
      xhr.open('POST', `${CONFIG.API_BASE}/resize`);
      xhr.responseType = 'blob';
      xhr.send(formData);
    });

    resultBlob = blob;
    resultFilename = `resized.${format}`;

    displayResult(metadata);
  } catch (err) {
    showError(err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
  }
});

downloadBtn.addEventListener('click', () => {
  if (!resultBlob) return;
  const url = URL.createObjectURL(resultBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = resultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

function displayResult(metadata) {
  if (!metadata) return;
  document.getElementById('originalSize').textContent = formatBytes(metadata.original_size_bytes);
  document.getElementById('targetSizeDisplay').textContent = formatBytes(metadata.target_size_bytes);
  document.getElementById('achievedSize').textContent = formatBytes(metadata.achieved_size_bytes);

  const badge = document.getElementById('matchBadge');
  if (metadata.exact_match) {
    badge.innerHTML = '<span class="badge exact">Exact match</span>';
  } else {
    badge.innerHTML = '<span class="badge close">Closest achievable</span>';
  }

  const warningsEl = document.getElementById('resultWarnings');
  warningsEl.innerHTML = '';
  if (metadata.warnings && metadata.warnings.length) {
    metadata.warnings.forEach(w => {
      const div = document.createElement('div');
      div.className = 'warning-box visible';
      div.style.marginTop = '10px';
      div.textContent = w;
      warningsEl.appendChild(div);
    });
  }

  resultBox.classList.add('visible');
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  const container = document.getElementById('progressContainer');
  if (isLoading) {
    container.classList.add('visible');
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('progressFill').classList.remove('processing');
    document.getElementById('progressStatus').textContent = 'Preparing...';
    document.getElementById('progressEta').textContent = '';
  } else {
    container.classList.remove('visible');
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
}
function hideError() {
  errorBox.classList.remove('visible');
}

function formatBytes(bytes) {
  const unitStr = document.getElementById('unit').value;
  const isBinary = unitStr === 'KiB' || unitStr === 'MiB';
  const base = isBinary ? 1024 : 1000;
  const kLabel = isBinary ? 'KiB' : 'KB';
  const mLabel = isBinary ? 'MiB' : 'MB';

  if (bytes < base) return `${bytes} B`;
  if (bytes < base * base) return `${(bytes / base).toFixed(2)} ${kLabel}`;
  return `${(bytes / (base * base)).toFixed(2)} ${mLabel}`;
}
