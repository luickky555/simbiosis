/*
  “IA” local do Solo (bem simples)

  A gente pega:
  - pH que a pessoa digitou
  - um “tom” do solo
  - e uma média de cor da foto

  E devolve uma dica curta pro agricultor.
*/

/**
 * Faz uma média de cor (RGB) pegando alguns pixels da foto.
 */
export function avgRgb(imageData, step = 6) {
  const { data, width, height } = imageData;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

function cnFromTone(tone) {
  const t = Math.max(1, Math.min(8, Number(tone) || 1));
  if (t <= 2) return { label: "nitrogênio bom", cn: "baixo", score: 0.25 };
  if (t <= 4) return { label: "nitrogênio médio", cn: "médio", score: 0.5 };
  if (t <= 6) return { label: "nitrogênio baixo", cn: "alto", score: 0.75 };
  return { label: "nitrogênio muito baixo", cn: "muito alto", score: 0.9 };
}

function cnAdjustByColor(rgb) {
  const { r, g, b } = rgb;
  const brightness = (r + g + b) / 3;
  const greenIndex = (g - (r + b) / 2) / 255;
  let adj = 0;
  if (greenIndex > 0.08) adj -= 0.12;
  if (greenIndex < -0.02) adj += 0.12;
  if (brightness > 190) adj += 0.06;
  if (brightness < 90) adj -= 0.06;
  return adj;
}

export function analyzeSoil({ ph, tone, rgb }) {
  const phN = Number(ph);
  const phState = Number.isFinite(phN)
    ? (phN < 5.5 ? "ácido" : (phN > 7.5 ? "alcalino" : "ok"))
    : "desconhecido";

  const base = cnFromTone(tone);
  const adj = rgb ? cnAdjustByColor(rgb) : 0;
  const score = Math.max(0, Math.min(1, base.score + adj));

  let cnLabel = "médio";
  if (score <= 0.33) cnLabel = "baixo";
  else if (score <= 0.66) cnLabel = "médio";
  else cnLabel = "alto";

  const issues = [];
  if (phState === "ácido") issues.push("solo ácido");
  if (phState === "alcalino") issues.push("solo alcalino");
  if (cnLabel === "alto") issues.push("palhada pobre em nitrogênio");

  const recs = [];
  if (phState === "ácido") recs.push("use cinzas de fogão bem peneiradas (pouquinho por vez) e matéria orgânica");
  if (phState === "alcalino") recs.push("evite excesso de cinza; use composto/esterco curtido e cobertura viva");
  if (cnLabel === "alto") recs.push("plante feijão primeiro (ou junto) e use esterco curtido para acelerar a decomposição");
  if (cnLabel !== "alto") recs.push("mantenha a palhada e faça consórcio com feijão para segurar a umidade");

  const headline = issues.length
    ? `Seu ${issues.join(" e ")}.`
    : "Seu solo parece equilibrado.";

  const tip = recs.length
    ? recs.map(s => s[0].toUpperCase() + s.slice(1)).join(". ") + "."
    : "Siga mantendo palhada e diversidade no consórcio.";

  return {
    ph: Number.isFinite(phN) ? phN : null,
    ph_state: phState,
    residue_cn: cnLabel,
    message: `${headline} ${tip}`.trim(),
    debug: { tone: Number(tone) || null, score: Number(score.toFixed(3)), rgb }
  };
}
