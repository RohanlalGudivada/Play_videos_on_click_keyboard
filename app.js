const DB_NAME = 'cutboard-local-videos';
const STORE_NAME = 'videos';
const MAX_VIDEOS = 8;

const state = { videos: [], activeIndex: null, blackout: false, cameraActive: false, cameraReady: false, cameraStream: null };
const playerElements = [];
const stage = document.querySelector('#stage');
const players = document.querySelector('#players');
const slots = document.querySelector('#slots');
const fileInput = document.querySelector('#fileInput');
const emptyStage = document.querySelector('#emptyStage');
const standbyStatus = document.querySelector('#standbyStatus');
const addButton = document.querySelector('#addButton');
const notice = document.querySelector('#notice');
const noticeText = document.querySelector('#noticeText');
const cameraPlayer = document.querySelector('#cameraPlayer');
const cameraButton = document.querySelector('#cameraButton');
const cameraButtonText = document.querySelector('#cameraButtonText');
const cameraSnapshot = document.querySelector('#cameraSnapshot');
const snapshotFrame = document.querySelector('#snapshotFrame');
const keypadButton = document.querySelector('#keypadButton');
const controlPad = document.querySelector('#controlPad');

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readStoredVideos() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => (a.order || 0) - (b.order || 0)));
    request.onerror = () => reject(request.error);
  });
}

async function persistVideos() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    state.videos.forEach(({ url, ...video }, order) => store.put({ ...video, order }));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function showNotice(message) {
  noticeText.textContent = message;
  notice.hidden = false;
}

function readableSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes > 99 * 1024 * 1024 ? 0 : 1)} MB`;
}

function requestFullscreen() {
  if (document.fullscreenElement) return;
  const request = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (request) Promise.resolve(request.call(stage)).catch(() => undefined);
}

function stopPlayers(reset = true) {
  playerElements.forEach((player) => {
    if (!player) return;
    player.pause();
    if (reset) player.currentTime = 0;
  });
}

function enterBlackout() {
  stopPlayers();
  state.activeIndex = null;
  state.blackout = true;
  state.cameraActive = false;
  cameraPlayer.classList.remove('camera-active');
  snapshotFrame.classList.remove('snapshot-active');
  emptyStage.hidden = true;
  playerElements.forEach((player) => player.classList.remove('player-active'));
  requestFullscreen();
  renderSlots();
}

function playSlot(index) {
  const video = state.videos[index];
  const player = playerElements[index];
  if (!video || !player) return;
  requestFullscreen();
  if (state.cameraActive && cameraPlayer.videoWidth && cameraPlayer.videoHeight) {
    cameraSnapshot.width = cameraPlayer.videoWidth;
    cameraSnapshot.height = cameraPlayer.videoHeight;
    cameraSnapshot.getContext('2d')?.drawImage(cameraPlayer, 0, 0, cameraSnapshot.width, cameraSnapshot.height);
    snapshotFrame.classList.remove('snapshot-active');
    void snapshotFrame.offsetWidth;
    snapshotFrame.classList.add('snapshot-active');
  }
  playerElements.forEach((item, itemIndex) => {
    if (itemIndex !== index && item) {
      item.pause();
      item.currentTime = 0;
      item.classList.remove('player-active');
    }
  });
  state.blackout = false;
  state.cameraActive = false;
  state.activeIndex = index;
  emptyStage.hidden = true;
  cameraPlayer.classList.remove('camera-active');
  player.classList.add('player-active');
  player.currentTime = 0;
  player.play().catch(() => showNotice('Playback was blocked. Press the number key again.'));
  renderSlots();
}

async function showCamera() {
  requestFullscreen();
  stopPlayers();
  state.activeIndex = null;
  state.blackout = false;
  emptyStage.hidden = true;
  snapshotFrame.classList.remove('snapshot-active');
  playerElements.forEach((player) => player.classList.remove('player-active'));

  try {
    if (!state.cameraStream || !state.cameraStream.active) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showNotice('Live camera is not supported by this browser.');
        return;
      }
      cameraButton.disabled = true;
      cameraButtonText.textContent = 'Starting...';
      state.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      cameraPlayer.srcObject = state.cameraStream;
      state.cameraReady = true;
      cameraButton.classList.add('ready');
      cameraButtonText.textContent = 'Live camera';
    }
    state.cameraActive = true;
    cameraPlayer.classList.add('camera-active');
    await cameraPlayer.play();
  } catch (error) {
    cameraButtonText.textContent = state.cameraReady ? 'Live camera' : 'Enable camera';
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      showNotice('Camera permission was not allowed. Enable it in the browser and press 9 again.');
    } else {
      showNotice('The camera could not be started on this device.');
    }
  } finally {
    cameraButton.disabled = false;
  }
}

function createPlayer(video, index) {
  const player = document.createElement('video');
  player.src = video.url;
  player.preload = 'auto';
  player.playsInline = true;
  player.disablePictureInPicture = true;
  player.controls = false;
  player.className = 'player';
  player.setAttribute('controlslist', 'nodownload noplaybackrate nofullscreen');
  player.addEventListener('ended', () => enterBlackout());
  player.addEventListener('error', () => showNotice('This browser cannot play that video format.'));
  playerElements[index] = player;
  return player;
}

function renderPlayers() {
  players.replaceChildren();
  playerElements.length = 0;
  state.videos.forEach((video, index) => players.append(createPlayer(video, index)));
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderSlots() {
  slots.replaceChildren();
  document.querySelector('#videoCount').textContent = `${state.videos.length} / ${MAX_VIDEOS}`;
  addButton.disabled = state.videos.length >= MAX_VIDEOS;
  controlPad.querySelectorAll('button[data-key]').forEach((button) => {
    const number = Number(button.dataset.key);
    if (number >= 1 && number <= MAX_VIDEOS) button.disabled = !state.videos[number - 1];
  });

  for (let index = 0; index < MAX_VIDEOS; index += 1) {
    const video = state.videos[index];
    if (!video) {
      const empty = makeElement('button', 'slot-card empty');
      empty.append(makeElement('span', 'slot-number', String(index + 1)), makeElement('span', 'empty-slot-plus', '+'), makeElement('span', '', 'Empty slot'));
      empty.addEventListener('click', () => fileInput.click());
      slots.append(empty);
      continue;
    }

    const card = makeElement('article', `slot-card${state.activeIndex === index ? ' active' : ''}`);
    const playButton = makeElement('button', 'slot-play');
    playButton.setAttribute('aria-label', `Play ${video.name}`);
    const preview = makeElement('span', 'slot-preview');
    preview.append(makeElement('span', 'play-glyph', '▶'));
    const copy = makeElement('span', 'slot-copy');
    copy.append(makeElement('strong', '', video.name), makeElement('small', '', readableSize(video.size)));
    playButton.append(makeElement('span', 'slot-number', String(index + 1)), preview, copy);
    playButton.addEventListener('click', () => playSlot(index));

    const removeButton = makeElement('button', 'remove-button', '×');
    removeButton.title = 'Remove video';
    removeButton.setAttribute('aria-label', `Remove ${video.name}`);
    removeButton.addEventListener('click', () => removeVideo(index));
    card.append(playButton, removeButton);
    slots.append(card);
  }
}

async function addVideos(files) {
  const videoFiles = Array.from(files).filter((file) => file.type.startsWith('video/'));
  if (!videoFiles.length) return;
  const space = MAX_VIDEOS - state.videos.length;
  const accepted = videoFiles.slice(0, space);
  const additions = accepted.map((file, index) => ({
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^/.]+$/, ''),
    type: file.type,
    size: file.size,
    blob: file,
    order: state.videos.length + index,
    url: URL.createObjectURL(file),
  }));
  state.videos.push(...additions);
  renderPlayers();
  renderSlots();
  try {
    await persistVideos();
    showNotice(`${additions.length} video${additions.length === 1 ? '' : 's'} saved on this device.`);
  } catch {
    showNotice('These videos are too large for browser storage, but they will work until this tab closes.');
  }
  if (videoFiles.length > space) showNotice(`Only ${space} more video${space === 1 ? '' : 's'} can be added.`);
}

async function removeVideo(index) {
  const [removed] = state.videos.splice(index, 1);
  URL.revokeObjectURL(removed.url);
  state.activeIndex = null;
  state.blackout = false;
  stopPlayers();
  renderPlayers();
  renderSlots();
  emptyStage.hidden = false;
  try { await persistVideos(); } catch { showNotice('Could not update local storage.'); }
}

fileInput.addEventListener('change', async () => {
  await addVideos(fileInput.files);
  fileInput.value = '';
});
addButton.addEventListener('click', () => fileInput.click());
document.querySelector('#blackoutButton').addEventListener('click', enterBlackout);
cameraButton.addEventListener('click', showCamera);
keypadButton.addEventListener('click', () => {
  controlPad.hidden = !controlPad.hidden;
  keypadButton.classList.toggle('active', !controlPad.hidden);
  keypadButton.setAttribute('aria-pressed', String(!controlPad.hidden));
});
controlPad.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (!button || button.disabled) return;
  const key = button.dataset.key;
  if (key === '0') enterBlackout();
  else if (key === '9') showCamera();
  else playSlot(Number(key) - 1);
});
notice.addEventListener('click', () => { notice.hidden = true; });

window.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea')) return;
  if (event.key === '0') {
    event.preventDefault();
    enterBlackout();
    return;
  }
  if (event.key === '9') {
    event.preventDefault();
    showCamera();
    return;
  }
  const number = Number(event.key);
  if (number >= 1 && number <= MAX_VIDEOS) {
    event.preventDefault();
    playSlot(number - 1);
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    stopPlayers(false);
    state.blackout = false;
    state.cameraActive = false;
    cameraPlayer.classList.remove('camera-active');
    snapshotFrame.classList.remove('snapshot-active');
    emptyStage.hidden = state.activeIndex !== null;
  }
});

(async function initialize() {
  try {
    const stored = await readStoredVideos();
    state.videos = stored.slice(0, MAX_VIDEOS).map((video) => ({ ...video, url: URL.createObjectURL(video.blob) }));
  } catch {
    showNotice('Local storage is unavailable. Videos will last until this tab closes.');
  }
  renderPlayers();
  renderSlots();
  standbyStatus.textContent = 'SYSTEM READY';
})();

window.addEventListener('beforeunload', () => {
  state.videos.forEach((video) => URL.revokeObjectURL(video.url));
  state.cameraStream?.getTracks().forEach((track) => track.stop());
});
