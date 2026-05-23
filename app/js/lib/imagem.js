/*
  Coisas de imagem (foto)

  Aqui a gente:
  - carrega a foto (File/Blob)
  - desenha num canvas menor (pra ficar leve no celular)
  - salva em JPEG comprimido
  - pega pixels (ImageData) pra rodar as análises
*/

import { clamp } from "./utilitarios.js";

/**
 * Carrega um arquivo de imagem e transforma em algo que dá pra desenhar no canvas.
 */
export async function fileToBitmap(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Falha ao carregar imagem."));
        im.src = url;
      });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Cria um canvas menor (mantendo a proporção) pra não pesar no celular.
 */
export function canvasFromBitmap(bitmap, maxW = 1280, maxH = 1280) {
  const ratio = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { canvas, ctx, width: w, height: h };
}

/**
 * Salva o canvas como JPEG (comprimido).
 */
export async function canvasToJpegBlob(canvas, quality = 0.72) {
  quality = clamp(quality, 0.4, 0.92);
  return await new Promise(resolve => canvas.toBlob(b => resolve(b), "image/jpeg", quality));
}

/**
 * Pega os pixels do canvas (ImageData).
 */
export function imageDataFromCanvas(ctx, x = 0, y = 0, w = ctx.canvas.width, h = ctx.canvas.height) {
  return ctx.getImageData(x, y, w, h);
}

/**
 * Pega um recorte do meio da imagem (pra focar na folha).
 */
export function centerCropRect(ctx, frac = 0.78) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const f = clamp(frac, 0.35, 1);
  const cw = Math.max(1, Math.floor(w * f));
  const ch = Math.max(1, Math.floor(h * f));
  const x = Math.floor((w - cw) / 2);
  const y = Math.floor((h - ch) / 2);
  return { x, y, w: cw, h: ch };
}

/**
 * Pega os pixels do meio do canvas (recorte).
 */
export function centerImageData(ctx, frac = 0.78) {
  const r = centerCropRect(ctx, frac);
  return imageDataFromCanvas(ctx, r.x, r.y, r.w, r.h);
}

/**
 * Checagem simples da foto:
 * - se tá muito escura/clara
 * - se tem contraste suficiente
 */
export function photoQuality(imageData, step = 6) {
  const { data, width, height } = imageData;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += lum;
      sumSq += lum * lum;
      n++;
    }
  }
  const mean = sum / Math.max(1, n);
  const varr = sumSq / Math.max(1, n) - mean * mean;
  const std = Math.sqrt(Math.max(0, varr));
  const okLight = mean >= 70 && mean <= 210;
  const okContrast = std >= 18;
  return {
    mean: Number(mean.toFixed(1)),
    std: Number(std.toFixed(1)),
    ok: okLight && okContrast
  };
}
