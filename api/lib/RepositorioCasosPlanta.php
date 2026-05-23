<?php
declare(strict_types=1);

/*
  Casos de planta

  Ideia:
  - guardar “casos” (só números) por cultura e região
  - comparar pra achar casos parecidos da comunidade

  Obs: a foto NÃO vai pro servidor, só os números (features).
*/

require_once __DIR__ . '/Banco.php';
require_once __DIR__ . '/RepositorioRegistros.php';

final class PlantCaseRepo
{
  private const MAX_FEATURES = 40;

  /**
   * Pega os números do registro `plant_check` (do app)
   * e salva como um caso pra comparação.
   */
  public static function insertFromPlantCheck(string $regionHash, array $payload): ?int
  {
    $crop = isset($payload['crop']) ? (string)$payload['crop'] : '';
    if (trim($crop) === '') return null;

    $ai = isset($payload['ai']) && is_array($payload['ai']) ? $payload['ai'] : null;
    $water = isset($payload['water']) && is_array($payload['water']) ? $payload['water'] : null;
    $nutrition = isset($payload['nutrition']) && is_array($payload['nutrition']) ? $payload['nutrition'] : null;

    $features = [];
    if ($ai && isset($ai['debug']) && is_array($ai['debug'])) {
      foreach ($ai['debug'] as $k => $v) {
        if (!is_string($k) || !is_numeric($v)) continue;
        $features[$k] = (float)$v;
      }
    }
    if ($ai && isset($ai['issues']) && is_array($ai['issues'])) {
      $map = [
        'doenca' => 'ai_doenca',
        'pragas' => 'ai_pragas',
        'sol_forte' => 'ai_sol_forte',
        'foto_ruim' => 'ai_foto_ruim',
        'clorose' => 'ai_clorose',
      ];
      foreach ($ai['issues'] as $it) {
        if (!is_array($it)) continue;
        $k = isset($it['key']) ? (string)$it['key'] : '';
        if ($k === '' || !isset($map[$k])) continue;
        $s = $it['score'] ?? null;
        if (!is_numeric($s)) continue;
        $features[$map[$k]] = (float)$s;
      }
    }
    if ($water && isset($water['stress']) && is_numeric($water['stress'])) $features['water_stress'] = (float)$water['stress'];
    if ($nutrition && isset($nutrition['best']) && is_array($nutrition['best']) && isset($nutrition['best']['score']) && is_numeric($nutrition['best']['score'])) {
      $features['nutrient_score'] = (float)$nutrition['best']['score'];
    }
    if ($ai && isset($ai['best']) && is_array($ai['best']) && isset($ai['best']['score']) && is_numeric($ai['best']['score'])) {
      $features['ai_score'] = (float)$ai['best']['score'];
    }

    if (!$features) return null;

    $prediction = [
      'best' => $ai['best'] ?? null,
      'disease' => $ai['disease'] ?? null,
      'nutrient' => $nutrition['nutrient'] ?? null,
    ];

    return self::insert($regionHash, $crop, $features, $prediction);
  }

  /**
   * Insere um caso no banco (números + um “resultado” opcional).
   */
  public static function insert(string $regionHash, string $crop, array $features, ?array $prediction = null): int
  {
    $pdo = Db::pdo();
    $crop = self::crop($crop);
    $features = self::sanitizeFeatures($features);
    $prediction = $prediction ? self::sanitizePrediction($prediction) : null;
    $now = Db::now();

    $st = $pdo->prepare('INSERT INTO plant_cases (region_hash, crop, features, prediction, label, created_at) VALUES (?,?,?,?,?,?)');
    $st->execute([
      $regionHash,
      $crop,
      json_encode($features, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
      $prediction ? json_encode($prediction, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
      null,
      $now
    ]);
    return (int)$pdo->lastInsertId();
  }

  /**
   * Salva um rótulo (o retorno do usuário) que ele escolheu pra aquele caso.
   */
  public static function feedback(int $caseId, string $label): void
  {
    $pdo = Db::pdo();
    $label = trim($label);
    $label = mb_substr($label, 0, 60, 'UTF-8');
    if ($label === '') return;
    $st = $pdo->prepare('UPDATE plant_cases SET label=? WHERE id=?');
    $st->execute([$label, $caseId]);
  }

  /**
   * Compara os números com os últimos casos da mesma região/cultura e retorna os mais parecidos.
   * A gente normaliza por desvio padrão pra não deixar um número “mandar” mais que os outros.
   */
  public static function compare(string $regionHash, string $crop, array $features, int $limit = 6): array
  {
    $pdo = Db::pdo();
    $crop = self::crop($crop);
    $features = self::sanitizeFeatures($features);
    $limit = max(1, min(12, $limit));

    $st = $pdo->prepare('SELECT id, features, prediction, label, created_at FROM plant_cases WHERE region_hash=? AND crop=? ORDER BY created_at DESC LIMIT 500');
    $st->execute([$regionHash, $crop]);
    $rows = $st->fetchAll();

    $decoded = [];
    foreach ($rows as $r) {
      $f = json_decode((string)$r['features'], true);
      if (!is_array($f)) continue;
      $pred = $r['prediction'] ? json_decode((string)$r['prediction'], true) : null;
      $decoded[] = [
        'id' => (int)$r['id'],
        'label' => $r['label'] ? (string)$r['label'] : null,
        'prediction' => is_array($pred) ? $pred : null,
        'created_at' => RecordRepo::mysqlToIso((string)$r['created_at']),
        'features' => $f,
      ];
    }

    $std = self::featureStdMap($features, $decoded);
    $items = [];
    foreach ($decoded as $d) {
      $dist = self::distanceNorm($features, $d['features'], $std);
      $items[] = [
        'id' => $d['id'],
        'label' => $d['label'],
        'prediction' => $d['prediction'],
        'created_at' => $d['created_at'],
        'distance' => $dist
      ];
    }

    usort($items, fn($a, $b) => $a['distance'] <=> $b['distance']);
    $top = array_slice($items, 0, $limit);

    $vote = [];
    foreach ($top as $t) {
      if (!$t['label']) continue;
      $vote[$t['label']] = ($vote[$t['label']] ?? 0) + 1;
    }
    arsort($vote);
    $bestLabel = $vote ? array_key_first($vote) : null;

    return [
      'matches' => $top,
      'suggested_label' => $bestLabel,
      'has_labels' => !empty($vote),
    ];
  }

  private static function crop(string $crop): string
  {
    $c = strtolower(trim($crop));
    $allowed = ['mandioca', 'milho', 'feijao', 'melancia'];
    if (!in_array($c, $allowed, true)) return 'mandioca';
    return $c;
  }

  /**
   * Sanitiza features:
   * - limita quantidade
   * - normaliza nomes (a-z0-9_)
   * - converte para float
   */
  private static function sanitizeFeatures(array $features): array
  {
    $out = [];
    $i = 0;
    foreach ($features as $k => $v) {
      if ($i >= self::MAX_FEATURES) break;
      if (!is_string($k)) continue;
      if (!is_numeric($v)) continue;
      $key = preg_replace('/[^a-z0-9_]/', '', strtolower($k)) ?? '';
      if ($key === '') continue;
      $out[$key] = (float)$v;
      $i++;
    }
    return $out;
  }

  /**
   * Sanitiza prediction (somente campos necessários para UI/inspeção).
   */
  private static function sanitizePrediction(array $prediction): array
  {
    $out = [];
    $best = $prediction['best'] ?? null;
    if (is_array($best)) {
      $out['best'] = [
        'key' => isset($best['key']) ? (string)$best['key'] : null,
        'label' => isset($best['label']) ? (string)$best['label'] : null,
        'score' => isset($best['score']) ? (float)$best['score'] : null
      ];
    }
    $d = $prediction['disease'] ?? null;
    if (is_array($d)) {
      $out['disease'] = [
        'name' => isset($d['name']) ? (string)$d['name'] : null
      ];
    }
    $n = $prediction['nutrient'] ?? null;
    if (is_string($n) && trim($n) !== '') $out['nutrient'] = trim($n);
    return $out;
  }

  /**
   * Distância euclidiana simples (sem normalização).
   */
  private static function distance(array $a, array $b): float
  {
    $keys = array_unique(array_merge(array_keys($a), array_keys($b)));
    $sum = 0.0;
    $n = 0;
    foreach ($keys as $k) {
      if (!isset($a[$k]) || !isset($b[$k])) continue;
      $x = (float)$a[$k];
      $y = (float)$b[$k];
      $d = $x - $y;
      $sum += $d * $d;
      $n++;
    }
    if ($n === 0) return 999999.0;
    return sqrt($sum / $n);
  }

  /**
   * Calcula um mapa de desvio-padrão por feature usando:
   * - a query atual
   * - e os casos recentes decodificados.
   *
   * Usa Welford (média/variância incremental) para estabilidade numérica.
   */
  private static function featureStdMap(array $query, array $decodedRows): array
  {
    $keys = array_keys($query);
    $agg = [];
    foreach ($keys as $k) {
      $agg[$k] = ['n' => 0, 'mean' => 0.0, 'm2' => 0.0];
    }

    $push = function (string $k, float $x) use (&$agg): void {
      $a = $agg[$k];
      $n1 = $a['n'] + 1;
      $delta = $x - $a['mean'];
      $mean = $a['mean'] + ($delta / $n1);
      $delta2 = $x - $mean;
      $m2 = $a['m2'] + ($delta * $delta2);
      $agg[$k] = ['n' => $n1, 'mean' => $mean, 'm2' => $m2];
    };

    foreach ($keys as $k) {
      $xq = $query[$k] ?? null;
      if (is_numeric($xq)) $push($k, (float)$xq);
    }

    foreach ($decodedRows as $row) {
      $f = $row['features'] ?? null;
      if (!is_array($f)) continue;
      foreach ($keys as $k) {
        if (!isset($f[$k]) || !is_numeric($f[$k])) continue;
        $push($k, (float)$f[$k]);
      }
    }

    $std = [];
    foreach ($agg as $k => $a) {
      $n = (int)$a['n'];
      if ($n <= 1) {
        $std[$k] = 1.0;
        continue;
      }
      $var = $a['m2'] / max(1, ($n - 1));
      $s = sqrt(max(0.0, $var));
      if (!is_finite($s) || $s < 1e-6) $s = 1.0;
      $std[$k] = $s;
    }
    return $std;
  }

  /**
   * Distância euclidiana com normalização por feature (divide por std).
   */
  private static function distanceNorm(array $a, array $b, array $std): float
  {
    $keys = array_unique(array_merge(array_keys($a), array_keys($b)));
    $sum = 0.0;
    $n = 0;
    foreach ($keys as $k) {
      if (!isset($a[$k]) || !isset($b[$k])) continue;
      $x = (float)$a[$k];
      $y = (float)$b[$k];
      $s = isset($std[$k]) ? (float)$std[$k] : 1.0;
      if (!is_finite($s) || $s < 1e-6) $s = 1.0;
      $d = ($x - $y) / $s;
      $sum += $d * $d;
      $n++;
    }
    if ($n === 0) return 999999.0;
    return sqrt($sum / $n);
  }
}
