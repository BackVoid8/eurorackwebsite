const cursor = document.getElementById('cursor');
const cursorTrail = document.getElementById('cursorTrail');
let cx = window.innerWidth / 2;
let cy = window.innerHeight / 2;
let tx = cx;
let ty = cy;

window.addEventListener('mousemove', (event) => {
  tx = event.clientX;
  ty = event.clientY;
});

function animateCursor() {
  cx += (tx - cx) * 0.22;
  cy += (ty - cy) * 0.22;
  const tiltX = (ty - cy) * 0.15;
  const tiltY = (tx - cx) * -0.15;

  cursor.style.transform = `translate3d(${cx - 8}px, ${cy - 8}px, 0) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
  cursorTrail.style.transform = `translate(${cx - 15}px, ${cy - 15}px)`;
  requestAnimationFrame(animateCursor);
}
animateCursor();

const tiltables = document.querySelectorAll('.tiltable');
tiltables.forEach((card) => {
  card.addEventListener('mousemove', (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(600px) rotateX(${(-y * 8).toFixed(1)}deg) rotateY(${(x * 10).toFixed(1)}deg) scale(1.02)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale(1)';
  });
});

let audioCtx;
let uiCtx;
let masterGain;
let vco;
let vcf;
let vca;
let lfo;
let lfoDepth;

const vcoFreq = document.getElementById('vcoFreq');
const cutoff = document.getElementById('cutoff');
const q = document.getElementById('q');
const amp = document.getElementById('amp');
const lfoRate = document.getElementById('lfoRate');
const audioToggle = document.getElementById('audioToggle');
const routingText = document.getElementById('routingText');

const connections = new Set();

function ensureAudio() {
  if (vco && audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(audioCtx.destination);

  vco = audioCtx.createOscillator();
  vco.type = 'sawtooth';

  vcf = audioCtx.createBiquadFilter();
  vcf.type = 'lowpass';

  vca = audioCtx.createGain();
  lfoDepth = audioCtx.createGain();
  lfoDepth.gain.value = 250;

  lfo = audioCtx.createOscillator();
  lfo.type = 'sine';

  applyControlValues();
  rebuildRouting();

  vco.start();
  lfo.start();
}

function applyControlValues() {
  if (!audioCtx) return;
  vco.frequency.setTargetAtTime(Number(vcoFreq.value), audioCtx.currentTime, 0.01);
  vcf.frequency.setTargetAtTime(Number(cutoff.value), audioCtx.currentTime, 0.02);
  vcf.Q.setTargetAtTime(Number(q.value), audioCtx.currentTime, 0.02);
  vca.gain.setTargetAtTime(Number(amp.value), audioCtx.currentTime, 0.01);
  lfo.frequency.setTargetAtTime(Number(lfoRate.value), audioCtx.currentTime, 0.05);
}

function disconnectAll() {
  [vco, vcf, vca, lfo, lfoDepth].forEach((node) => {
    try {
      node.disconnect();
    } catch {
      // node already disconnected
    }
  });
}

function hasLink(from, to) {
  return connections.has(`${from}->${to}`);
}

function rebuildRouting() {
  if (!audioCtx) return;
  disconnectAll();

  if (hasLink('lfoOut', 'cutoffCv')) {
    lfo.connect(lfoDepth);
    lfoDepth.connect(vcf.frequency);
  }

  if (hasLink('vcoOut', 'vcfIn')) {
    vco.connect(vcf);
  }

  if (hasLink('vcfOut', 'vcaIn')) {
    vcf.connect(vca);
  }

  if (hasLink('vcoOut', 'vcaIn')) {
    vco.connect(vca);
  }

  if (hasLink('vcaOut', 'outIn')) {
    vca.connect(masterGain);
  }

  const status = connections.size ? Array.from(connections).join(' | ') : 'idle';
  routingText.textContent = `Routing: ${status}`;
}

[vcoFreq, cutoff, q, amp, lfoRate].forEach((input) => {
  input.addEventListener('input', applyControlValues);
});

audioToggle.addEventListener('click', async () => {
  ensureAudio();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
    audioToggle.textContent = 'STOP AUDIO';
  } else {
    await audioCtx.suspend();
    audioToggle.textContent = 'START AUDIO';
  }
  clickBlip();
});

const knobs = document.querySelectorAll('.knob');
knobs.forEach((knob) => {
  knob.addEventListener('pointerdown', (event) => {
    knob.setPointerCapture(event.pointerId);
    const target = document.getElementById(knob.dataset.target);
    const startY = event.clientY;
    const startVal = Number(target.value);
    const max = Number(target.max);
    const min = Number(target.min);

    const onMove = (move) => {
      const delta = (startY - move.clientY) * ((max - min) / 250);
      let value = Math.min(max, Math.max(min, startVal + delta));
      if (target.step && target.step !== 'any') {
        const step = Number(target.step);
        value = Math.round(value / step) * step;
      }
      target.value = value;
      const rotation = ((value - min) / (max - min)) * 280 - 140;
      knob.style.transform = `rotate(${rotation}deg)`;
      applyControlValues();
    };

    const onUp = () => {
      knob.removeEventListener('pointermove', onMove);
      knob.removeEventListener('pointerup', onUp);
    };

    knob.addEventListener('pointermove', onMove);
    knob.addEventListener('pointerup', onUp);
  });
});

const patchSvg = document.getElementById('patchSvg');
const jacks = document.querySelectorAll('.jack');
const cablePaths = new Map();
let dragState = null;

function jackPoint(jack) {
  const rect = jack.getBoundingClientRect();
  const svgRect = patchSvg.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - svgRect.left,
    y: rect.top + rect.height / 2 - svgRect.top
  };
}

function cableD(a, b) {
  const mid = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mid} ${a.y - 60}, ${mid} ${b.y + 60}, ${b.x} ${b.y}`;
}

function drawCable(key, fromJack, toJack) {
  const start = jackPoint(fromJack);
  const end = jackPoint(toJack);
  let path = cablePaths.get(key);
  if (!path) {
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    patchSvg.appendChild(path);
    cablePaths.set(key, path);
  }
  path.setAttribute('d', cableD(start, end));
}

function redrawAllCables() {
  connections.forEach((conn) => {
    const [from, to] = conn.split('->');
    const outJack = document.querySelector(`.jack[data-jack='${from}']`);
    const inJack = document.querySelector(`.jack[data-jack='${to}']`);
    if (outJack && inJack) drawCable(conn, outJack, inJack);
  });
}

window.addEventListener('resize', redrawAllCables);

jacks.forEach((jack) => {
  jack.addEventListener('pointerdown', (event) => {
    if (!jack.classList.contains('output')) return;
    const start = jackPoint(jack);
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    patchSvg.appendChild(tempPath);
    dragState = { fromJack: jack, tempPath, start };
    event.preventDefault();
    clickBlip();
  });

  jack.addEventListener('pointerup', () => {
    if (!dragState) return;
    if (!jack.classList.contains('input')) return;

    const from = dragState.fromJack.dataset.jack;
    const to = jack.dataset.jack;
    const key = `${from}->${to}`;

    if (connections.has(key)) {
      connections.delete(key);
      cablePaths.get(key)?.remove();
      cablePaths.delete(key);
      dragState.fromJack.classList.remove('connected');
      jack.classList.remove('connected');
    } else {
      connections.add(key);
      drawCable(key, dragState.fromJack, jack);
      dragState.fromJack.classList.add('connected');
      jack.classList.add('connected');
    }

    dragState.tempPath.remove();
    dragState = null;
    rebuildRouting();
    clickBlip();
  });
});

window.addEventListener('pointermove', (event) => {
  if (!dragState) return;
  const svgRect = patchSvg.getBoundingClientRect();
  const point = { x: event.clientX - svgRect.left, y: event.clientY - svgRect.top };
  dragState.tempPath.setAttribute('d', cableD(dragState.start, point));
});

window.addEventListener('pointerup', () => {
  if (!dragState) return;
  dragState.tempPath.remove();
  dragState = null;
});

function ensureSoundCtx() {
  if (!uiCtx) {
    uiCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function hoverNoise() {
  ensureSoundCtx();
  const buffer = uiCtx.createBuffer(1, uiCtx.sampleRate * 0.02, uiCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.12;
  const src = uiCtx.createBufferSource();
  const g = uiCtx.createGain();
  src.buffer = buffer;
  g.gain.value = 0.02;
  src.connect(g).connect(uiCtx.destination);
  src.start();
}

function clickBlip() {
  ensureSoundCtx();
  const o = uiCtx.createOscillator();
  const g = uiCtx.createGain();
  o.type = 'triangle';
  o.frequency.value = 640;
  g.gain.value = 0.0001;
  o.connect(g).connect(uiCtx.destination);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.03, uiCtx.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, uiCtx.currentTime + 0.08);
  o.stop(uiCtx.currentTime + 0.09);
}

document.querySelectorAll('a, button').forEach((el) => {
  el.addEventListener('mouseenter', hoverNoise);
  el.addEventListener('click', clickBlip);
});
