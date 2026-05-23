/*
  “IA” local da Planta (bem na tentativa e erro)

  Aqui a gente analisa a foto da folha e tenta:
  - ver se parece sede
  - ver se parece falta de nutriente

  Não é laudo, é só uma ajuda rápida.
*/

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Tenta ver se a planta tá com sede pela foto da folha.
 * A gente devolve:
 * - `stress` (0..1), `label` e uma mensagem
 * - umas medidas pra ajudar a comparação (mean_lum, green_index, droop, leaf_frac)
 */
export function plantStressFromImage(imageData, { step = 2, crop = null } = {}) {
  const { data, width, height } = imageData;
  let sumGreen = 0;
  let sumLum = 0;
  let n = 0;
  let sumGreenLeaf = 0;
  let sumLumLeaf = 0;
  let nLeaf = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = luminance(r, g, b);
      const giRaw = (g - (r + b) / 2);
      sumLum += lum;
      sumGreen += giRaw;
      n++;
      const isLeaf = (g > 55) && (g > r + 10) && (g > b + 10);
      if (isLeaf) {
        sumLumLeaf += lum;
        sumGreenLeaf += giRaw;
        nLeaf++;
      }
    }
  }

  const leafFrac = nLeaf / Math.max(1, n);
  const useLeaf = nLeaf >= 120 && leafFrac >= 0.22;
  const denom = Math.max(1, useLeaf ? nLeaf : n);
  const meanLum = (useLeaf ? sumLumLeaf : sumLum) / denom;
  const greenIndex = ((useLeaf ? sumGreenLeaf : sumGreen) / denom) / 255;

  const droop = droopScore(imageData, step);

  let stress = 0;
  if (greenIndex < 0.02) stress += 0.25;
  if (greenIndex < -0.01) stress += 0.25;
  if (meanLum < 85) stress += 0.10;
  let droopW = 0.40;
  if (crop === "milho") droopW = 0.18;
  else if (crop === "feijao") droopW = 0.28;
  else if (crop === "melancia") droopW = 0.35;
  stress += droopW * droop;
  stress = Math.max(0, Math.min(1, stress));

  let label = "hidratada";
  if (stress > 0.62) label = "estressada";
  else if (stress > 0.42) label = "atenção";

  const msg = label === "hidratada"
    ? "A planta ainda está hidratada. Aguarde antes de molhar."
    : (label === "atenção"
      ? "A planta está começando a pedir água. Se o solo estiver seco, molhe de leve."
      : "A planta está com sinais de sede. Se puder, irrigue hoje e mantenha palhada para segurar a umidade.");

  return {
    ok: useLeaf,
    label,
    stress: Number(stress.toFixed(3)),
    mean_lum: Number(meanLum.toFixed(1)),
    green_index: Number(greenIndex.toFixed(3)),
    droop: Number(droop.toFixed(3)),
    leaf_frac: Number(leafFrac.toFixed(3)),
    message: msg
  };
}

/**
 * Tenta chutar falta de nutriente olhando cor/variação da folha.
 * Devolve:
 * - `suspects`: lista de suspeitas com pontuação e dica
 * - umas medidas (quando dá pra ler a foto direito)
 */
export function plantNutritionFromImage(imageData, { step = 3, crop = null } = {}) {
  const { data, width, height } = imageData;
  const edgeBand = 0.14;

  let n = 0;
  let sumGI = 0;
  let sumGI2 = 0;
  let sumLum = 0;
  let sumYellow = 0;
  let sumPurple = 0;

  let nEdge = 0;
  let edgeBurn = 0;
  let sumEdgeGI = 0;
  let sumCenterGI = 0;
  let nCenter = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = luminance(r, g, b);
      if (lum < 35 || lum > 240) continue;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if ((mx - mn) < 18) continue;

      const gi = (g - (r + b) / 2) / 255;
      const yellow = ((r + g) / 2 - b) / 255;
      const purple = ((r + b) / 2 - g) / 255;

      sumGI += gi;
      sumGI2 += gi * gi;
      sumLum += lum;
      sumYellow += yellow;
      sumPurple += purple;
      n++;

      const isEdge = (x < width * edgeBand) || (x > width * (1 - edgeBand)) || (y < height * edgeBand) || (y > height * (1 - edgeBand));
      if (isEdge) {
        nEdge++;
        sumEdgeGI += gi;
        const burn = (lum < 105 && (r - g) > 14 && gi < 0.02) ? 1 : 0;
        edgeBurn += burn;
      } else {
        nCenter++;
        sumCenterGI += gi;
      }
    }
  }

  if (n < 220) {
    return {
      ok: false,
      message: "Não consegui ler bem a folha nessa foto. Tente mais perto e com mais luz.",
      suspects: []
    };
  }

  const meanGI = sumGI / n;
  const varGI = Math.max(0, sumGI2 / n - meanGI * meanGI);
  const stdGI = Math.sqrt(varGI);
  const meanLum = sumLum / n;
  const meanYellow = sumYellow / n;
  const meanPurple = sumPurple / n;
  const burnRate = nEdge ? (edgeBurn / nEdge) : 0;
  const edgeGI = nEdge ? (sumEdgeGI / nEdge) : meanGI;
  const centerGI = nCenter ? (sumCenterGI / nCenter) : meanGI;
  const edgeDrop = Math.max(0, centerGI - edgeGI);

  const chlorosis = clamp01((0.055 - meanGI) / 0.07) * clamp01((meanYellow + 0.02) / 0.22);
  const uniform = clamp01((0.055 - stdGI) / 0.055);
  const patchy = clamp01((stdGI - 0.03) / 0.06);
  const bright = clamp01((meanLum - 120) / 60);
  const purpling = clamp01((meanPurple - 0.035) / 0.12);

  const sN = clamp01(0.85 * chlorosis + 0.35 * uniform - 0.35 * burnRate - 0.20 * purpling);
  const sP = clamp01(0.95 * purpling + 0.15 * patchy - 0.25 * burnRate);
  const sK = clamp01(0.95 * burnRate + 0.55 * edgeDrop - 0.25 * bright);
  const sMg = clamp01(0.80 * chlorosis + 0.55 * patchy - 0.20 * burnRate + 0.10 * purpling);
  const sS = clamp01(0.90 * chlorosis + 0.40 * uniform - 0.20 * burnRate - 0.25 * purpling);
  const sZn = clamp01(0.55 * chlorosis + 0.60 * patchy + 0.25 * bright - 0.40 * burnRate + 0.10 * purpling);
  const sFeMn = clamp01(0.60 * chlorosis + 0.50 * patchy + 0.25 * bright - 0.35 * burnRate);

  const suspects = crop === "milho"
    ? [
      {
        key: "nitrogenio",
        label: "Falta de nitrogênio (N)",
        score: sN,
        message: "No milho, costuma começar nas folhas mais velhas: amarelece da ponta e vai para o meio (em 'V').",
        what: "Ajuste a adubação nitrogenada (cobertura) e observe se as folhas novas melhoram. Palhada ajuda a segurar N e água."
      },
      {
        key: "fosforo",
        label: "Falta de fósforo (P)",
        score: sP,
        message: "No milho, pode aparecer vermelho‑púrpura, principalmente em plantas jovens e com crescimento reduzido.",
        what: "Reveja fósforo no plantio (linha) e correção de solo. Solo frio/seco piora a absorção."
      },
      {
        key: "potassio",
        label: "Falta de potássio (K)",
        score: sK,
        message: "No milho, parece queimadura/secamento da ponta e das margens das folhas inferiores.",
        what: "Reforce potássio conforme recomendação de análise de solo. Evite estresse hídrico, que piora o sintoma."
      },
      {
        key: "magnesio",
        label: "Falta de magnésio (Mg)",
        score: sMg,
        message: "No milho, pode dar listras esbranquiçadas (clorose internerval) paralelas à nervura principal, em folhas mais velhas.",
        what: "Ajuste a calagem (quando indicada) e o Mg no solo. Evite acidez alta e desequilíbrio com K."
      },
      {
        key: "enxofre",
        label: "Falta de enxofre (S)",
        score: sS,
        message: "No milho, pode dar clorose mais uniforme e planta mais fraca, muitas vezes aparecendo nas folhas mais novas.",
        what: "Considere fontes com enxofre e matéria orgânica. Confirme com análise de solo e histórico de adubação."
      },
      {
        key: "zinco",
        label: "Falta de zinco (Zn) (possível)",
        score: sZn,
        message: "No milho, pode dar faixas brancas/amareladas entre a nervura principal e as bordas; pode evoluir com necrose e tons roxos.",
        what: "Verifique Zn na análise de solo. Quando indicado, use correção no solo ou aplicação foliar precoce."
      },
      {
        key: "ferro_manganes",
        label: "Falta de ferro (Fe) ou manganês (Mn) (possível)",
        score: sFeMn,
        message: "No milho, pode dar clorose internerval: listras claras com nervuras ficando mais verdes (geralmente em folhas mais novas).",
        what: "Checar pH (alto reduz Fe/Mn), drenagem e compactação. Micronutrientes podem ser necessários conforme análise."
      }
    ]
    : crop === "feijao"
      ? [
          {
            key: "nitrogenio",
            label: "Falta de nitrogênio (N)",
            score: sN,
            message: "No feijão, costuma amarelar primeiro nas folhas mais velhas e a planta perde força.",
            what: "Adube com matéria orgânica (esterco curtido/composto) e, se usar adubo, faça cobertura leve. Evite solo pelado: palhada ajuda."
          },
          {
            key: "potassio",
            label: "Falta de potássio (K)",
            score: sK,
            message: "No feijão, pode parecer “queimadura” nas bordas e pontas, mais em folhas velhas.",
            what: "Reforce K conforme análise (ou fonte local com cuidado). Não exagere com cinza; melhor é seguir recomendação e manter umidade regular."
          },
          {
            key: "magnesio",
            label: "Falta de magnésio (Mg)",
            score: sMg,
            message: "No feijão, pode aparecer clorose internerval (amarelo entre nervuras) em folhas mais velhas.",
            what: "Ajuste acidez quando indicado (calcário/dolomítico) e aumente matéria orgânica. Excesso de K pode piorar Mg."
          },
          {
            key: "fosforo",
            label: "Falta de fósforo (P) (possível)",
            score: sP,
            message: "No feijão, pode dar planta menor e tons roxos em folhas/haste, principalmente com frio/seco.",
            what: "Garanta P no plantio e correção do solo. Solo muito seco ou frio reduz absorção."
          },
          {
            key: "ferro_manganes",
            label: "Falta de ferro (Fe) ou manganês (Mn) (possível)",
            score: sFeMn * 0.85,
            message: "Pode dar amarelo entre nervuras nas folhas novas. Também pode ser encharcamento.",
            what: "Verifique drenagem/umidade e pH. Se o solo encharca, corrija escoamento antes de pensar em micronutriente."
          },
          {
            key: "zinco",
            label: "Falta de zinco (Zn) (possível)",
            score: sZn * 0.75,
            message: "Micronutriente é difícil de acertar só por foto. Use como suspeita, não certeza.",
            what: "Confirme com análise de solo/foliar. Se indicado, aplique Zn em dose correta (solo ou foliar cedo)."
          }
        ]
      : crop === "mandioca"
        ? [
            {
              key: "potassio",
              label: "Falta de potássio (K)",
              score: sK,
              message: "Na mandioca, pode aparecer secamento/queima nas bordas e pontas e perda de vigor.",
              what: "Reforce K conforme análise (principalmente em solos arenosos). Umidade irregular piora: use palhada e evite estresse hídrico."
            },
            {
              key: "magnesio",
              label: "Falta de magnésio (Mg)",
              score: sMg,
              message: "Na mandioca, pode dar amarelo entre nervuras em folhas mais velhas.",
              what: "Ajuste acidez quando indicado e aumente matéria orgânica. Excesso de K pode competir com Mg."
            },
            {
              key: "nitrogenio",
              label: "Falta de nitrogênio (N) (possível)",
              score: sN * 0.9,
              message: "A planta pode ficar mais clara no geral e com crescimento lento.",
              what: "Matéria orgânica e consórcio com leguminosas ajudam. Evite excesso de N (pode aumentar pragas/doenças)."
            },
            {
              key: "fosforo",
              label: "Falta de fósforo (P) (possível)",
              score: sP * 0.85,
              message: "Pode travar crescimento e dar coloração mais escura/arroxeada em plantas jovens (principalmente com frio).",
              what: "Garanta P no plantio e correção do solo. Solo muito ácido reduz disponibilidade."
            },
            {
              key: "ferro",
              label: "Falta de ferro (Fe) (possível)",
              score: sFeMn * 0.8,
              message: "Folhas novas podem ficar claras com nervuras mais verdes. Também pode ser excesso de água.",
              what: "Cheque drenagem e umidade primeiro. Depois, confirme pH/solo e só então micronutrientes."
            }
          ]
        : crop === "melancia"
          ? [
              {
                key: "nitrogenio",
                label: "Falta de nitrogênio (N)",
                score: sN,
                message: "Na melancia, a planta pode perder vigor e ficar mais clara, começando em folhas mais velhas.",
                what: "Reforce matéria orgânica e faça cobertura leve se necessário. Evite exagero de N (pode aumentar doença)."
              },
              {
                key: "potassio",
                label: "Falta de potássio (K)",
                score: sK,
                message: "Pode dar bordas queimadas e piora na frutificação/enchimento.",
                what: "Reforce K conforme análise de solo. Mantenha irrigação regular (sem encharcar) e palhada."
              },
              {
                key: "magnesio",
                label: "Falta de magnésio (Mg)",
                score: sMg,
                message: "Pode dar amarelo entre nervuras em folhas mais velhas, com nervuras mais verdes.",
                what: "Corrija acidez quando indicado e evite desequilíbrio com potássio. Matéria orgânica ajuda."
              },
              {
                key: "enxofre",
                label: "Falta de enxofre (S) (possível)",
                score: sS * 0.85,
                message: "Pode dar amarelo mais uniforme e planta mais fraca, às vezes em folhas novas.",
                what: "Considere fontes com S e matéria orgânica. Confirme com histórico de adubação/análise."
              },
              {
                key: "ferro_manganes",
                label: "Falta de ferro (Fe) ou manganês (Mn) (possível)",
                score: sFeMn * 0.8,
                message: "Clorose em folhas novas pode ser micro ou excesso de água no solo.",
                what: "Cheque drenagem/umidade e pH. Micronutriente só com confirmação (análise)."
              }
            ]
          : [
              {
                key: "nitrogenio",
                label: "Falta de nitrogênio (N)",
                score: sN,
                message: "A folha está mais clara no geral. Pode ser falta de força (nitrogênio).",
                what: "Use esterco/composto e consórcio com feijão. Evite capina 'no limpo': deixe palhada."
              },
              {
                key: "potassio",
                label: "Falta de potássio (K)",
                score: sK,
                message: "A borda parece queimando/escurecendo. Pode ser falta de potássio.",
                what: "Cinza de fogão bem peneirada, pouco por vez, e matéria orgânica. Não exagere."
              },
              {
                key: "magnesio",
                label: "Falta de magnésio (Mg)",
                score: sMg,
                message: "A folha parece amarelada 'manchada'. Pode ser falta de magnésio.",
                what: "Reforce matéria orgânica e evite solo muito ácido. Se tiver, use calcário/dolomítico com orientação técnica."
              },
              {
                key: "ferro",
                label: "Falta de ferro (Fe) (possível)",
                score: sFeMn * 0.85,
                message: "A folha ficou clara com partes verdes e amarelas. Pode ser ferro (ou solo muito encharcado).",
                what: "Veja drenagem/umidade e matéria orgânica. Se o solo encharca, faça escoamento."
              }
            ];
  suspects.sort((a, b) => b.score - a.score);

  const best = suspects[0];
  const isMicro = best.key === "zinco" || best.key === "ferro_manganes" || best.key === "ferro";
  const ok = isMicro ? best.score >= 0.78 : best.score >= 0.60;
  const nutrient = ok ? best.label : null;
  const solution = ok ? best.what : null;
  const message = ok
    ? `Possível ${best.label}. ${best.what}`
    : "Não vi sinal forte de falta de nutriente. Se a planta estiver ruim, tire outra foto mais perto e com boa luz.";

  return {
    ok: true,
    message,
    nutrient,
    solution,
    best: { key: best.key, label: best.label, score: round3(best.score), solution: best.what },
    suspects: suspects.slice(0, 3).map(s => ({ key: s.key, label: s.label, score: round3(s.score) })),
    debug: {
      mean_gi: round3(meanGI),
      std_gi: round3(stdGI),
      mean_lum: Number(meanLum.toFixed(1)),
      mean_purple: round3(meanPurple),
      burn_rate: round3(burnRate),
      edge_drop: round3(edgeDrop)
    }
  };
}

export function plantAiFromImage(imageData, { step = 3, crop = null } = {}) {
  const { data, width, height } = imageData;

  let n = 0;
  let sumLum = 0;
  let sumGI = 0;
  let sumGI2 = 0;
  let sumYellow = 0;
  let sumRedDom = 0;
  let necrosisLeaf = 0;
  let leafPix = 0;
  let lesionPix = 0;
  let dark = 0;
  let bright = 0;
  let sunburn = 0;
  let darkLeaf = 0;
  let brightLeaf = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = luminance(r, g, b);
      if (lum < 25 || lum > 245) continue;

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if ((mx - mn) < 16) continue;

      const gi = (g - (r + b) / 2) / 255;
      const yellow = ((r + g) / 2 - b) / 255;
      const redDom = (r - (g + b) / 2) / 255;

      sumLum += lum;
      sumGI += gi;
      sumGI2 += gi * gi;
      sumYellow += yellow;
      sumRedDom += redDom;
      n++;

      if (lum < 70) dark++;
      if (lum > 200) bright++;
      const isLeaf = (g > 50) && (g > r + 8) && (g > b + 8) && (gi > -0.02);
      if (isLeaf) {
        leafPix++;
        if (lum < 70) darkLeaf++;
        if (lum > 200) brightLeaf++;
        const brownish = (redDom > 0.07 && lum < 155 && gi < 0.06) ? 1 : 0;
        const veryDark = (lum < 95 && gi < 0.05) ? 1 : 0;
        const nec = (yellow > 0.10 && redDom > 0.08 && lum > 50 && lum < 185) ? 1 : 0;
        if (nec) necrosisLeaf++;
        if (brownish || veryDark) lesionPix++;
      }
      if (lum > 205 && redDom > 0.14 && gi < 0.02) sunburn++;
    }
  }

  if (n < 220) {
    return {
      ok: false,
      message: "Não consegui ler bem a folha nessa foto. Tente mais perto e com mais luz.",
      best: { key: "foto_ruim", label: "Foto sem leitura", score: 1 },
      issues: [
        {
          key: "foto_ruim",
          label: "Foto sem leitura",
          score: 1,
          message: "Não consegui ler bem a folha nessa foto. Chegue mais perto, preencha a tela com a folha e use boa luz."
        }
      ]
    };
  }

  const meanLum = sumLum / n;
  const meanGI = sumGI / n;
  const stdGI = Math.sqrt(Math.max(0, sumGI2 / n - meanGI * meanGI));
  const meanYellow = sumYellow / n;
  const meanRedDom = sumRedDom / n;
  const fracNecrosis = leafPix ? (necrosisLeaf / leafPix) : 0;
  const fracDark = dark / n;
  const fracBright = bright / n;
  const fracDarkLeaf = leafPix ? (darkLeaf / leafPix) : fracDark;
  const fracBrightLeaf = leafPix ? (brightLeaf / leafPix) : fracBright;
  const fracSunburn = sunburn / n;
  const leafFrac = leafPix / n;
  const lesionFrac = leafPix ? (lesionPix / leafPix) : 0;
  const edge = edgeOrientationStats(imageData, Math.max(2, Math.floor(step / 1.5)));

  const water = plantStressFromImage(imageData, { step: Math.max(2, Math.floor(step / 1.5)), crop });
  const nutri = plantNutritionFromImage(imageData, { step, crop });

  const sDiseaseBase = clamp01((fracNecrosis - 0.015) / 0.06) * clamp01((stdGI - 0.020) / 0.08);
  const sLesion = clamp01((lesionFrac - 0.014) / 0.075) * clamp01((stdGI - 0.016) / 0.07);
  let sDisease = clamp01(Math.max(sDiseaseBase, sLesion) + 0.25 * clamp01((meanRedDom - 0.05) / 0.14));
  if (lesionFrac > 0.085 && stdGI > 0.03) sDisease = Math.max(sDisease, 0.78);
  const sPests = clamp01((fracDarkLeaf - 0.18) / 0.25) * clamp01((stdGI - 0.022) / 0.09);
  const sSun = clamp01((fracSunburn - 0.010) / 0.06) * clamp01((fracBrightLeaf - 0.18) / 0.35);
  const sChlorosis = clamp01((0.05 - meanGI) / 0.08) * clamp01((meanYellow + 0.02) / 0.25);
  const sLowLight = clamp01((85 - meanLum) / 40) + clamp01((fracDarkLeaf - 0.28) / 0.25);
  const sNoLeaf = clamp01((0.28 - leafFrac) / 0.18);

  const issues = [
    {
      key: "agua",
      label: "Sede (água)",
      score: clamp01(water.stress),
      message: water.message
    },
    {
      key: "nutricao",
      label: "Nutrição",
      score: clamp01(nutri?.best?.score || 0) * (nutri?.ok ? 1 : 0),
      message: nutri?.message || "Sem leitura de nutrição."
    },
    {
      key: "doenca",
      label: "Mancha / doença (possível)",
      score: sDisease,
      message: "Aparecem manchas escuras/marrons. Pode ser doença ou queimadura. Olhe folhas novas e velhas e veja se está espalhando."
    },
    {
      key: "pragas",
      label: "Praga na folha (possível)",
      score: sPests,
      message: "Vejo muitos pontos/variação na folha. Pode ser praga sugadora ou dano. Olhe embaixo das folhas e brotações."
    },
    {
      key: "sol_forte",
      label: "Queimadura de sol (possível)",
      score: sSun,
      message: "Tem área muito clara e avermelhada. Pode ser sol forte/calor. Se puder, aumente cobertura/palhada e evite stress."
    },
    {
      key: "foto_ruim",
      label: "Foto escura",
      score: clamp01(Math.max(sLowLight, sNoLeaf)),
      message: sNoLeaf > 0.55
        ? "Não consegui enxergar bem a folha (muito longe ou muito fundo). Chegue mais perto e preencha a tela com a folha."
        : "A foto está escura. Isso atrapalha a leitura. Tente com mais luz e mais perto da folha."
    },
    {
      key: "clorose",
      label: "Amarelamento geral",
      score: clamp01(sChlorosis),
      message: "A folha está mais amarela/clara. Pode ser nutrição ou stress. Compare com folhas novas e antigas."
    }
  ].sort((a, b) => b.score - a.score);

  const best = issues[0];
  const ok = best.score >= 0.55 && best.key !== "foto_ruim";
  const disease = best.key === "doenca" && ok ? pickDisease(crop, {
    meanLum,
    meanGI,
    stdGI,
    meanYellow,
    meanRedDom,
    lesionFrac,
    necFrac: fracNecrosis,
    edgeAniso: edge.aniso
  }) : null;
  const diseaseSolution = best.key === "doenca" && ok ? diseaseHowTo(crop, disease) : null;

  const message = ok
    ? (best.key === "doenca" && disease
        ? `Possível doença: ${disease}. ${diseaseSolution}`
        : `IA: ${best.label}. ${best.message}`)
    : "IA: não vi um problema forte nessa foto. Se a planta estiver ruim, tire outra foto mais perto e com boa luz.";

  return {
    ok: true,
    message,
    best: { key: best.key, label: best.label, score: round3(best.score) },
    issues: issues.slice(0, 4).map(i => ({ key: i.key, label: i.label, score: round3(i.score) })),
    disease: disease ? { name: disease, solution: diseaseSolution } : null,
    debug: {
      mean_lum: Number(meanLum.toFixed(1)),
      mean_gi: round3(meanGI),
      std_gi: round3(stdGI),
      mean_yellow: round3(meanYellow),
      mean_red_dom: round3(meanRedDom),
      frac_necrosis: round3(fracNecrosis),
      leaf_frac: round3(leafFrac),
      lesion_frac: round3(lesionFrac),
      frac_dark: round3(fracDark),
      frac_dark_leaf: round3(fracDarkLeaf),
      frac_bright: round3(fracBright),
      frac_bright_leaf: round3(fracBrightLeaf),
      frac_sunburn: round3(fracSunburn),
      edge_aniso: round3(edge.aniso),
      edge_dir: round3(edge.dir)
    }
  };
}

function edgeOrientationStats(imageData, step = 2) {
  const { data, width, height } = imageData;
  const w = Math.max(5, Math.floor(width / step));
  const h = Math.max(5, Math.floor(height / step));
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x * step;
      const sy = y * step;
      const i = (sy * width + sx) * 4;
      gray[y * w + x] = luminance(data[i], data[i + 1], data[i + 2]);
    }
  }
  const bins = new Float32Array(12);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -1 * gray[i - w - 1] + 1 * gray[i - w + 1] +
        -2 * gray[i - 1]     + 2 * gray[i + 1] +
        -1 * gray[i + w - 1] + 1 * gray[i + w + 1];
      const gy =
        -1 * gray[i - w - 1] + -2 * gray[i - w] + -1 * gray[i - w + 1] +
         1 * gray[i + w - 1] +  2 * gray[i + w] +  1 * gray[i + w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 65) continue;
      const ang = Math.atan2(gy, gx);
      const a = (ang < 0 ? ang + Math.PI : ang);
      const bin = Math.min(11, Math.floor((a / Math.PI) * 12));
      bins[bin] += mag;
      total += mag;
    }
  }
  if (total <= 0) return { aniso: 0, dir: 0 };
  let best = 0;
  let bestI = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] > best) { best = bins[i]; bestI = i; }
  }
  const aniso = Math.max(0, Math.min(1, (best / total - 1 / 12) / (1 - 1 / 12)));
  const dir = bestI / 11;
  return { aniso, dir };
}

function droopScore(imageData, step = 2) {
  const { data, width, height } = imageData;
  const w = Math.max(3, Math.floor(width / step));
  const h = Math.max(3, Math.floor(height / step));
  const gray = new Float32Array(w * h);
  const leaf = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x * step;
      const sy = y * step;
      const i = (sy * width + sx) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      gray[y * w + x] = luminance(r, g, b);
      leaf[y * w + x] = ((g > 55) && (g > r + 10) && (g > b + 10)) ? 1 : 0;
    }
  }

  let total = 0;
  let vertish = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (leaf[i] === 0) continue;
      const neigh = leaf[i - 1] + leaf[i + 1] + leaf[i - w] + leaf[i + w];
      if (neigh < 2) continue;
      const gx =
        -1 * gray[i - w - 1] + 1 * gray[i - w + 1] +
        -2 * gray[i - 1]     + 2 * gray[i + 1] +
        -1 * gray[i + w - 1] + 1 * gray[i + w + 1];
      const gy =
        -1 * gray[i - w - 1] + -2 * gray[i - w] + -1 * gray[i - w + 1] +
         1 * gray[i + w - 1] +  2 * gray[i + w] +  1 * gray[i + w + 1];

      const mag = Math.hypot(gx, gy);
      if (mag < 60) continue;
      total++;
      const ang = Math.abs(Math.atan2(gy, gx)) * (180 / Math.PI);
      if (ang > 55 && ang < 125) vertish++;
    }
  }
  if (total < 30) return 0.2;
  const frac = vertish / total;
  return Math.max(0, Math.min(1, (frac - 0.35) / 0.4));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function round3(v) {
  return Number((v || 0).toFixed(3));
}

function diseaseHowTo(crop, disease = null) {
  const base = "Retire folhas muito atacadas, evite molhar as folhas (água na raiz), dê mais espaço/vento entre plantas e mantenha palhada sem encostar no caule.";
  if (crop === "melancia") return base + " Se tiver, use calda bordalesa/calda sulfocálcica com orientação técnica e respeite carência.";
  if (crop === "feijao") return base + " Evite plantar feijão no mesmo lugar em sequência (rotação).";
  if (crop === "milho") {
    const core = "Use cultivar resistente quando possível, evite milho seguido na mesma área, faça rotação com não hospedeiras e reduza restos de cultura quando houver alta severidade. Em cultivo suscetível e clima favorável, avalie fungicida com orientação técnica.";
    if (!disease) return base + " " + core;
    if (String(disease).includes("cercosporiose")) return base + " " + core + " Atenção na relação N/K (adubação equilibrada).";
    if (String(disease).includes("mancha branca")) return base + " " + core + " Evite plantio tardio onde a doença é forte e monitore após pendoamento.";
    if (String(disease).includes("ferrugem")) return base + " " + core + " Monitore cedo: ferrugens podem evoluir rápido em ambiente favorável.";
    if (String(disease).includes("helmintosporiose")) return base + " " + core + " Começando cedo (antes de florescer) o prejuízo tende a ser maior: monitore e aja cedo.";
    return base + " " + core;
  }
  return base;
}

function pickDisease(crop, s) {
  const meanLum = typeof s?.meanLum === "number" ? s.meanLum : 0;
  const meanGI = typeof s?.meanGI === "number" ? s.meanGI : 0;
  const stdGI = typeof s?.stdGI === "number" ? s.stdGI : 0;
  const meanYellow = typeof s?.meanYellow === "number" ? s.meanYellow : 0;
  const meanRedDom = typeof s?.meanRedDom === "number" ? s.meanRedDom : 0;
  const lesionFrac = typeof s?.lesionFrac === "number" ? s.lesionFrac : 0;
  const necFrac = typeof s?.necFrac === "number" ? s.necFrac : 0;
  const edgeAniso = typeof s?.edgeAniso === "number" ? s.edgeAniso : 0;

  const patchy = stdGI > 0.06;
  const pale = meanGI < 0.02 && meanLum > 110;

  if (crop === "milho") {
    const isRusty = (lesionFrac > 0.045 && meanRedDom > 0.070 && necFrac < 0.030 && stdGI > 0.030);
    if (isRusty) {
      if (meanRedDom > 0.095) return "ferrugem polissora / ferrugem comum (possível)";
      return "ferrugem tropical (ferrugem branca) (possível)";
    }

    if (necFrac > 0.040 && lesionFrac > 0.065 && stdGI > 0.045) return "antracnose do milho / mancha foliar severa (possível)";

    const isWhiteSpot = (necFrac > 0.020 && meanYellow > 0.055 && meanRedDom < 0.060);
    if (isWhiteSpot) return "mancha branca (possível)";

    const isGraySpot = (edgeAniso > 0.42 && patchy && necFrac > 0.016 && meanRedDom < 0.070);
    if (isGraySpot) return "cercosporiose (possível)";

    const isBlight = (edgeAniso < 0.44 && necFrac > 0.025 && stdGI > 0.040 && meanRedDom >= 0.060);
    if (isBlight) return "helmintosporiose / mancha de Bipolaris (possível)";

    return patchy ? "mancha foliar (possível)" : "doença foliar (possível)";
  }
  if (crop === "feijao") return patchy ? "antracnose / mancha angular (possível)" : "ferrugem do feijoeiro (possível)";
  if (crop === "melancia") return patchy ? "antracnose / mancha de alternária (possível)" : "oídio / míldio (possível)";
  if (crop === "mandioca") return patchy ? "mancha parda (cercosporiose) (possível)" : "bacteriose (possível)";
  return pale ? "clorose (pode ser nutrição ou doença)" : "mancha foliar (possível)";
}
