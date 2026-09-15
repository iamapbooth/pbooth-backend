const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const deviceSelect = document.getElementById('deviceSelect');
const filterSelect = document.getElementById('filterSelect');
const mirrorToggle = document.getElementById('mirrorToggle');
const startButton = document.getElementById('startButton');
const captureButton = document.getElementById('captureButton');
const refreshGalleryButton = document.getElementById('refreshGalleryButton');
const debugEl = document.getElementById('debug');
const lastCaptureEl = document.getElementById('lastCapture');
const galleryEl = document.getElementById('gallery');

const FILTERS = {
  none: '',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(1)',
  invert: 'invert(1)',
  blur: 'blur(4px)',
  contrast: 'contrast(1.8)',
  saturate: 'saturate(3)',
  huerotate: 'hue-rotate(180deg)',
};

let currentStream = null;
let frameTimes = [];
let lastFrameStart = performance.now();
let lastDrawDurationMs = 0;
let countdownValue = null;
let countdownTimer = null;
let lastStatus = 'none';
let lastCaptureInfo = 'none yet';
let rafHandle = null;

function setStatus(msg) {
  lastStatus = msg;
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');
  deviceSelect.innerHTML = '';
  cams.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1} (grant permission to see name)`;
    deviceSelect.appendChild(opt);
  });
  return cams;
}

async function startCamera(deviceId) {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  currentStream = stream;
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  captureButton.disabled = false;
}

function drawFrame() {
  const drawStart = performance.now();

  if (video.readyState >= 2) {
    ctx.filter = FILTERS[filterSelect.value] || '';
    if (mirrorToggle.checked) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    ctx.filter = 'none';

    if (countdownValue !== null && countdownValue > 0) {
      ctx.font = `${Math.floor(canvas.height / 3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'white';
      ctx.fillText(String(countdownValue), canvas.width / 2, canvas.height / 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'black';
      ctx.strokeText(String(countdownValue), canvas.width / 2, canvas.height / 2);
    }
  }

  lastDrawDurationMs = performance.now() - drawStart;

  const now = performance.now();
  frameTimes.push(now - lastFrameStart);
  lastFrameStart = now;
  if (frameTimes.length > 30) frameTimes.shift();

  updateDebug();
  rafHandle = requestAnimationFrame(drawFrame);
}

function avgFps() {
  if (frameTimes.length === 0) return 0;
  const avgDelta = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  return avgDelta > 0 ? 1000 / avgDelta : 0;
}

function updateDebug() {
  const track = currentStream ? currentStream.getVideoTracks()[0] : null;
  const settings = track ? track.getSettings() : {};
  const lines = [
    `time: ${new Date().toISOString()}`,
    `fps (avg last ${frameTimes.length}): ${avgFps().toFixed(1)}`,
    `last frame draw: ${lastDrawDurationMs.toFixed(2)} ms`,
    `canvas: ${canvas.width}x${canvas.height}`,
    `video intrinsic: ${video.videoWidth}x${video.videoHeight}`,
    `video readyState: ${video.readyState}`,
    `stream active: ${currentStream ? currentStream.active : false}`,
    `track label: ${track ? track.label : 'none'}`,
    `track settings: ${track ? JSON.stringify(settings) : 'none'}`,
    `selected deviceId: ${deviceSelect.value || 'none'}`,
    `filter: ${filterSelect.value} -> ${FILTERS[filterSelect.value] || '(none)'}`,
    `mirrored: ${mirrorToggle.checked}`,
    `countdown: ${countdownValue === null ? 'idle' : countdownValue}`,
    `last capture: ${lastCaptureInfo}`,
    `last status: ${lastStatus}`,
    `devices found: ${deviceSelect.options.length}`,
    `userAgent: ${navigator.userAgent}`,
  ];
  debugEl.textContent = lines.join('\n');
}

async function doCapture() {
  const dataUrl = canvas.toDataURL('image/png');
  const started = performance.now();
  try {
    const resp = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, filter: filterSelect.value }),
    });
    const json = await resp.json();
    const roundTrip = (performance.now() - started).toFixed(1);
    if (json.ok) {
      lastCaptureInfo = `${json.filename} (${json.bytes} bytes, ${roundTrip} ms round trip)`;
      lastCaptureEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = json.url;
      img.width = 320;
      lastCaptureEl.appendChild(img);
      const label = document.createElement('p');
      label.textContent = json.filename;
      lastCaptureEl.appendChild(label);
      loadGallery();
    } else {
      lastCaptureInfo = `error: ${json.error}`;
      setStatus(`capture failed: ${json.error}`);
    }
  } catch (err) {
    lastCaptureInfo = `error: ${err.message}`;
    setStatus(`capture failed: ${err.message}`);
  } finally {
    captureButton.disabled = false;
  }
}

function startCountdown() {
  if (countdownTimer) return;
  captureButton.disabled = true;
  countdownValue = 3;
  countdownTimer = setInterval(() => {
    countdownValue -= 1;
    if (countdownValue <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      countdownValue = null;
 
      requestAnimationFrame(() => requestAnimationFrame(doCapture));
    }
  }, 1000);
}

async function loadGallery() {
  try {
    const resp = await fetch('/api/photos');
    const json = await resp.json();
    galleryEl.innerHTML = '';
    if (json.ok) {
      json.photos.forEach((p) => {
        const wrapper = document.createElement('div');
        const img = document.createElement('img');
        img.src = p.url;
        img.width = 160;
        const caption = document.createElement('p');
        caption.textContent = `${p.filename} (${p.bytes} bytes, ${p.mtime})`;
        wrapper.appendChild(img);
        wrapper.appendChild(caption);
        galleryEl.appendChild(wrapper);
      });
    }
  } catch (err) {
    setStatus(`gallery load failed: ${err.message}`);
  }
}

startButton.addEventListener('click', async () => {
  try {
    setStatus('starting camera...');
    await startCamera(deviceSelect.value);
    await listDevices();
    setStatus('camera started');
    if (!rafHandle) rafHandle = requestAnimationFrame(drawFrame);
  } catch (err) {
    setStatus(`getUserMedia failed: ${err.name}: ${err.message}`);
  }
});

deviceSelect.addEventListener('change', async () => {
  try {
    await startCamera(deviceSelect.value);
    setStatus('switched camera');
  } catch (err) {
    setStatus(`camera switch failed: ${err.name}: ${err.message}`);
  }
});

captureButton.addEventListener('click', startCountdown);
refreshGalleryButton.addEventListener('click', loadGallery);

if (navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    listDevices().catch((err) => setStatus(`device enumeration failed: ${err.message}`));
  });
}

listDevices().catch((err) => setStatus(`device enumeration failed: ${err.message}`));
loadGallery();
updateDebug();