/*
  “IA” local de Pragas (armadilha)

  O que a gente tenta fazer:
  - contar os pontinhos na armadilha
  - ver se tá subindo ou caindo com o tempo
  - dar umas dicas simples
*/

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clampByte(x) {
  if (x <= 0) return 0;
  if (x >= 255) return 255;
  return x | 0;
}

function percentileFromHist(hist, total, p) {
  const target = Math.max(0, Math.min(1, p)) * Math.max(1, total);
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return hist.length - 1;
}

function integralImage(gray, w, h) {
  const ii = new Float32Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    const gy = (y - 1) * w;
    const iy = y * (w + 1);
    const iyPrev = (y - 1) * (w + 1);
    for (let x = 1; x <= w; x++) {
      rowSum += gray[gy + (x - 1)];
      ii[iy + x] = ii[iyPrev + x] + rowSum;
    }
  }
  return ii;
}

function boxMean(ii, w, x0, y0, x1, y1) {
  const W = w + 1;
  const A = ii[y0 * W + x0];
  const B = ii[y0 * W + x1];
  const C = ii[y1 * W + x0];
  const D = ii[y1 * W + x1];
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  return (D - B - C + A) / area;
}

export function countDarkSpots(imageData, { downsample = 2, minPixels = 6, maxPixels = 1200 } = {}) {
  const { data, width, height } = imageData;
  const w = Math.max(1, Math.floor(width / downsample));
  const h = Math.max(1, Math.floor(height / downsample));
  const gray = new Float32Array(w * h);
  const hist = new Uint32Array(256);

  let mean = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x * downsample;
      const sy = y * downsample;
      const i = (sy * width + sx) * 4;
      const g = luminance(data[i], data[i + 1], data[i + 2]);
      const idx = y * w + x;
      gray[idx] = g;
      mean += g;
      n++;
      hist[clampByte(g)]++;
    }
  }
  mean /= Math.max(1, n);
  let varSum = 0;
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / Math.max(1, gray.length));
  const p10 = percentileFromHist(hist, n, 0.10);
  const p50 = percentileFromHist(hist, n, 0.50);
  const p90 = percentileFromHist(hist, n, 0.90);
  const contrast = p90 - p10;
  const globalThr = Math.max(8, Math.min(205, Math.min(mean - 0.75 * std, p10 + contrast * 0.35)));
  const radius = Math.max(5, Math.min(18, Math.floor(Math.min(w, h) / 28)));
  const delta = Math.max(10, Math.min(44, contrast * 0.22));
  const ii = integralImage(gray, w, h);

  const bin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const idx = y * w + x;
      const g = gray[idx];
      const local = boxMean(ii, w, x0, y0, x1, y1);
      const dark = (g < globalThr) && (g < (local - delta));
      bin[idx] = dark ? 1 : 0;
    }
  }

  const visited = new Uint8Array(w * h);
  const dirs = [-1, 0, 1];
  let count = 0;
  const sizes = [];

  const stack = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (bin[start] === 0 || visited[start] === 1) continue;
      visited[start] = 1;
      stack.push(start);
      let area = 0;
      while (stack.length) {
        const idx = stack.pop();
        area++;
        const cy = Math.floor(idx / w);
        const cx = idx - cy * w;
        for (const dy of dirs) {
          for (const dx of dirs) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nidx = ny * w + nx;
            if (visited[nidx] === 1) continue;
            if (bin[nidx] === 0) continue;
            visited[nidx] = 1;
            stack.push(nidx);
          }
        }
      }
      if (area >= minPixels && area <= maxPixels) {
        count++;
        sizes.push(area);
      }
    }
  }

  const density = count / Math.max(1, w * h);
  return {
    ok: contrast >= 26 && p50 >= 35,
    count,
    density: Number(density.toFixed(6)),
    threshold: Number(globalThr.toFixed(2)),
    contrast,
    p10,
    p50,
    p90,
    components: sizes.slice(0, 40)
  };
}

/**
 * Pega a contagem e tenta resumir em um “perfil” simples (pra tela mostrar).
 */
export function pestProfile(counted) {
  const comps = Array.isArray(counted?.components) ? counted.components : [];
  if (comps.length === 0) {
    return {
      ok: false,
      sizes: { small: 0, medium: 0, large: 0, avg: 0 },
      guess: "sem leitura",
      tips: ["Tente tirar a foto mais perto, com boa luz e de frente."]
    };
  }
  let small = 0, medium = 0, large = 0, sum = 0;
  for (const a of comps) {
    sum += a;
    if (a < 16) small++;
    else if (a < 55) medium++;
    else large++;
  }
  const avg = sum / comps.length;
  const total = Math.max(1, comps.length);
  const fracSmall = small / total;
  const fracLarge = large / total;

  let guess = "misturado";
  if (fracSmall >= 0.70) guess = "muito pequenos (trips/mosca‑branca)";
  else if (fracLarge >= 0.30) guess = "maiores (besourinho/mosca)";

  const tips = [
    "Olhe embaixo das folhas (principalmente as mais novas).",
    "Se estiver subindo, aja cedo: rotação, caldas/biológicos e limpeza ao redor da roça.",
    "Continue usando a armadilha todo dia/semana para ver a tendência."
  ];

  return {
    ok: true,
    sizes: { small, medium, large, avg: Number(avg.toFixed(1)) },
    guess,
    tips
  };
}

/**
 * Tendência bem simples: compara a média do começo com a média do final.
 */
export function trendFromSeries(series, window = 6) {
  const xs = series.slice(-window).filter(v => Number.isFinite(v?.count));
  if (xs.length < 3) return { label: "sem tendência", slope: 0 };
  const ys = xs.map(v => Math.max(0, Number(v.count) || 0));
  const n = ys.length;
  const half = Math.max(1, Math.floor(n / 2));
  const a = ys.slice(0, half);
  const b = ys.slice(n - half);
  const meanA = a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const meanB = b.reduce((s, x) => s + x, 0) / Math.max(1, b.length);
  const delta = meanB - meanA;
  const base = meanA + 3;
  const slope = delta / Math.max(1, half);
  let label = "estável";
  if (delta >= Math.max(3, base * 0.28)) label = "subindo";
  else if (delta <= -Math.max(3, base * 0.28)) label = "caindo";
  return { label, slope: Number(slope.toFixed(3)) };
}
