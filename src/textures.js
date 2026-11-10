import * as THREE from 'three';

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function gravelTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8f877c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 90 + Math.random() * 110;
      g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.88})`;
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 0, 7); g.fill();
    }
  }, true);
}

export function windowTexture() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e9e4da'; g.fillRect(0, 118, 128, 10);
    g.fillStyle = '#f7f7f7'; g.fillRect(28, 26, 72, 72);
    const grd = g.createLinearGradient(0, 30, 0, 94);
    grd.addColorStop(0, '#5f8fc4'); grd.addColorStop(1, '#2c4f7c');
    g.fillStyle = grd; g.fillRect(33, 31, 62, 62);
    g.fillStyle = '#f7f7f7'; g.fillRect(62, 31, 4, 62); g.fillRect(33, 60, 62, 4);
  }, true);
}

export function arrowTexture(dir) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.fillStyle = '#2fbf4a'; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.fill();
    g.save();
    g.translate(128, 128);
    if (dir === 'left') g.scale(-1, 1);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-70, -26); g.lineTo(10, -26); g.lineTo(10, -66); g.lineTo(78, 0);
    g.lineTo(10, 66); g.lineTo(10, 26); g.lineTo(-70, 26); g.closePath(); g.fill();
    g.restore();
  });
}

export function puffTexture() {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(245,245,245,0.6)');
    grd.addColorStop(1, 'rgba(240,240,240,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  });
}

export function coachSideTexture(hex) {
  const base = '#' + new THREE.Color(hex).getHexString();
  const dark = '#' + new THREE.Color(hex).multiplyScalar(0.6).getHexString();
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = dark; g.fillRect(0, h - 60, w, 60);
    g.fillStyle = '#fff4c8'; g.fillRect(0, h - 66, w, 8);
    // doors
    g.fillStyle = dark;
    g.fillRect(14, 30, 70, 150); g.fillRect(w - 84, 30, 70, 150);
    g.fillStyle = '#9fd3ff';
    g.fillRect(30, 46, 38, 50); g.fillRect(w - 68, 46, 38, 50);
    // windows
    const n = 7, x0 = 110, x1 = w - 110, ww = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * ww + 10;
      g.fillStyle = '#ffffff'; roundRect(g, x - 5, 35, ww - 20 + 10, 100, 18);
      const grd = g.createLinearGradient(0, 40, 0, 130);
      grd.addColorStop(0, '#bfe6ff'); grd.addColorStop(1, '#5a9fd6');
      g.fillStyle = grd; roundRect(g, x, 40, ww - 20, 90, 14);
    }
  });
}

// Same layout as coachSideTexture, but black except for the windows: used as a glow map at night.
export function coachLitTexture() {
  return canvasTex(1024, 256, (g, w) => {
    g.fillStyle = '#000000'; g.fillRect(0, 0, w, 256);
    g.fillStyle = '#ffd98a';
    g.fillRect(30, 46, 38, 50); g.fillRect(w - 68, 46, 38, 50);
    const n = 7, x0 = 110, x1 = w - 110, ww = (x1 - x0) / n;
    for (let i = 0; i < n; i++) roundRect(g, x0 + i * ww + 10, 40, ww - 20, 90, 14);
  });
}

// Lit windows for town buildings at night (matches windowTexture).
export function windowLitTexture() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#000000'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffcf7a'; g.fillRect(33, 31, 62, 62);
    g.fillStyle = '#000000'; g.fillRect(62, 31, 4, 62); g.fillRect(33, 60, 62, 4);
  }, true);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}

export function textTexture(text, ink = '#1d3e7a', paper = '#ffffff') {
  return canvasTex(1024, 205, (g, w, h) => {
    g.fillStyle = ink; roundRect(g, 0, 0, w, h, 30);
    g.fillStyle = paper; roundRect(g, 12, 12, w - 24, h - 24, 22);
    g.fillStyle = ink;
    g.font = 'bold 100px system-ui, -apple-system, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 6, w - 60);
  });
}

// Asphalt with white edge lines and a dashed yellow centre line (u = across, v = along, 8 m per repeat).
export function roadTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#5b5e63'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const v = 70 + Math.random() * 50;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#f2f2f2'; g.fillRect(5, 0, 5, h); g.fillRect(w - 10, 0, 5, h);
    g.fillStyle = '#f5c518'; g.fillRect(w / 2 - 3, 0, 6, h * 0.55);
  }, true);
}

// Red and white stripes for the crossing arms.
export function stripeTexture() {
  return canvasTex(256, 32, (g) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e02020'; g.fillRect(i * 32, 0, 32, 32); }
  });
}

export function glowTexture() {
  return canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  });
}

// A white leaf shape (tinted per leaf by vertex colours).
export function leafTexture() {
  return canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.translate(32, 32); g.rotate(-0.6);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -26); g.quadraticCurveTo(22, 0, 0, 26); g.quadraticCurveTo(-22, 0, 0, -26); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -22); g.lineTo(0, 24); g.stroke();
  });
}

// Coloured fairy-light bulbs on a dark wire, for Christmas houses (also used as the glow map).
export function bulbsTexture() {
  const cols = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ff9f0a', '#bf5af2'];
  return canvasTex(256, 16, (g) => {
    g.fillStyle = '#1a1a1a'; g.fillRect(0, 7, 256, 2);
    for (let i = 0; i < 16; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(i * 16 + 8, 8, 5, 0, 7); g.fill(); }
  }, true);
}

// Stone blocks for tunnel portals and bridge piers.
export function stoneTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f6a62'; g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -32 : 0;
      while (x < w) {
        const bw = 48 + Math.random() * 32, v = 140 + Math.random() * 40;
        g.fillStyle = `rgb(${v},${v * 0.96},${v * 0.9})`;
        g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
        x += bw;
      }
    }
  }, true);
}
