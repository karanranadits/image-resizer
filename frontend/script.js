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

// ── Particle Canvas ──────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, particles = [];
  const COUNT = 55;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function makeParticle() {
    return {
      x: rand(0, W),
      y: rand(0, H),
      r: rand(1.2, 3.2),
      vx: rand(-0.25, 0.25),
      vy: rand(-0.3, -0.08),
      alpha: rand(0.2, 0.6),
    };
  }

  for (let i = 0; i < COUNT; i++) particles.push(makeParticle());

  function getAccentColor() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark ? '180, 120, 255' : '124, 58, 237';
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const color = getAccentColor();
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color}, ${p.alpha})`;
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      p.alpha += rand(-0.003, 0.003);
      p.alpha = Math.max(0.1, Math.min(0.65, p.alpha));

      // wrap around
      if (p.y < -10) { p.y = H + 10; p.x = rand(0, W); }
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
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
