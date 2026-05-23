<?php
declare(strict_types=1);

/*
  API do sistema (PHP)

  Resumo do que rola:
  - Sem login/senha: o app manda `X-Device-Id` e pronto.
  - Cadastro é bem simples (nome, comunidade e culturas).
  - A sincronização recebe o que o app fez offline e devolve alertas da região.
*/

require_once __DIR__ . '/lib/Resposta.php';
require_once __DIR__ . '/lib/Requisicao.php';
require_once __DIR__ . '/lib/RepositorioUsuarios.php';
require_once __DIR__ . '/lib/RepositorioRegistros.php';
require_once __DIR__ . '/lib/RepositorioAlertas.php';
require_once __DIR__ . '/lib/RepositorioCasosPlanta.php';

try {
  $method = Request::method();
  $path = Request::path();

  $route = null;
  $apiPos = strpos($path, '/api/');
  if ($apiPos !== false) {
    $route = substr($path, $apiPos + 4);
    if ($route === '/inicio.php' || str_starts_with($route, '/inicio.php/')) $route = null;
  } else {
    $pathInfo = $_SERVER['PATH_INFO'] ?? '';
    if (is_string($pathInfo) && $pathInfo !== '') $route = $pathInfo;
    $r = Request::query('r', null);
    if ($route === null && $r !== null) $route = $r;
  }
  $route = is_string($route) && $route !== '' ? $route : '/';
  if ($route[0] !== '/') $route = '/' . $route;

  if ($route === '/ping' && $method === 'GET') {
    Response::json(['ok' => true, 'server_time' => (new DateTimeImmutable())->format(DATE_ATOM)]);
  }

  if ($route === '/users/register' && $method === 'POST') {
    $deviceId = Request::deviceId();
    $b = Request::jsonBody();
    $first = (string)($b['first_name'] ?? '');
    $community = (string)($b['community'] ?? '');
    $crops = is_array($b['crops'] ?? null) ? $b['crops'] : [];
    $producerCode = isset($b['producer_code']) ? (string)$b['producer_code'] : null;
    if (trim($first) === '' || mb_strlen(trim($first), 'UTF-8') < 2) Response::error('Digite seu primeiro nome.', 422);
    if (trim($community) === '' || mb_strlen(trim($community), 'UTF-8') < 2) Response::error('Digite sua comunidade.', 422);
    $u = UserRepo::upsert($deviceId, $first, $community, $crops, $producerCode);
    Response::json(['ok' => true, 'user' => $u]);
  }

  if ($route === '/users/me' && $method === 'GET') {
    $deviceId = Request::deviceId();
    $u = UserRepo::getByDeviceId($deviceId);
    Response::json(['ok' => true, 'user' => $u]);
  }

  if ($route === '/users/claim_code' && $method === 'POST') {
    $deviceId = Request::deviceId();
    $b = Request::jsonBody();
    $code = (string)($b['code'] ?? '');
    if (trim($code) === '') Response::error('Faltou code.', 422);
    $u = UserRepo::claimByProducerCode($deviceId, $code);
    Response::json(['ok' => true, 'user' => $u]);
  }

  if ($route === '/records/recent' && $method === 'GET') {
    $deviceId = Request::deviceId();
    $u = UserRepo::requireUser($deviceId);
    $limit = (int)(Request::query('limit', '80') ?? 80);
    $rows = RecordRepo::listRecent((int)$u['id'], $limit);
    Response::json(['ok' => true, 'records' => $rows]);
  }

  if ($route === '/alerts/publish' && $method === 'POST') {
    $deviceId = Request::deviceId();
    $u = UserRepo::requireUser($deviceId);
    $b = Request::jsonBody();
    $id = (string)($b['id'] ?? '');
    $kind = (string)($b['kind'] ?? 'aviso');
    $severity = (int)($b['severity'] ?? 2);
    $message = (string)($b['message'] ?? '');
    $createdAt = (string)($b['created_at'] ?? (new DateTimeImmutable())->format(DATE_ATOM));
    $meta = is_array($b['meta'] ?? null) ? $b['meta'] : [];
    if (trim($id) === '') Response::error('Faltou id do alerta.', 422);
    if (trim($message) === '') Response::error('Faltou mensagem do alerta.', 422);
    AlertRepo::publish((string)$u['region_hash'], $id, $kind, $severity, $message, $createdAt, $meta);
    Response::json(['ok' => true]);
  }

  if ($route === '/alerts/pull' && $method === 'GET') {
    $deviceId = Request::deviceId();
    $u = UserRepo::requireUser($deviceId);
    $since = Request::query('since', null);
    $rows = AlertRepo::pull((string)$u['region_hash'], $since, 50);
    Response::json(['ok' => true, 'alerts' => $rows]);
  }

  if ($route === '/plant/case' && $method === 'POST') {
    $deviceId = Request::deviceId();
    $u = UserRepo::requireUser($deviceId);
    $b = Request::jsonBody();
    $crop = (string)($b['crop'] ?? '');
    $features = is_array($b['features'] ?? null) ? $b['features'] : [];
    $prediction = is_array($b['prediction'] ?? null) ? $b['prediction'] : null;
    if (trim($crop) === '') Response::error('Faltou crop.', 422);
    if (!$features) Response::error('Faltou features.', 422);
    $id = PlantCaseRepo::insert((string)$u['region_hash'], $crop, $features, $prediction);
    Response::json(['ok' => true, 'case_id' => $id]);
  }

  if ($route === '/plant/compare' && $method === 'POST') {
    $deviceId = Request::deviceId();
    $u = UserRepo::requireUser($deviceId);
    $b = Request::jsonBody();
    $crop = (string)($b['crop'] ?? '');
    $features = is_array($b['features'] ?? null) ? $b['features'] : [];
    $limit = isset($b['limit']) ? (int)$b['limit'] : 6;
    if (trim($crop) === '') Response::error('Faltou crop.', 422);
    if (!$features) Response::error('Faltou features.', 422);
    try {
      $cmp = PlantCaseRepo::compare((string)$u['region_hash'], $crop, $features, $limit);
    } catch (Throwable) {
      $cmp = ['matches' => [], 'suggested_label' => null, 'has_labels' => false];
    }
    Response::json(['ok' => true, 'compare' => $cmp]);
  }

  if ($route === '/plant/feedback' && $method === 'POST') {
    $deviceId = Request::deviceId();
    UserRepo::requireUser($deviceId);
    $b = Request::jsonBody();
    $caseId = (int)($b['case_id'] ?? 0);
    $label = (string)($b['label'] ?? '');
    if ($caseId <= 0) Response::error('Faltou case_id.', 422);
    if (trim($label) === '') Response::error('Faltou label.', 422);
    PlantCaseRepo::feedback($caseId, $label);
    Response::json(['ok' => true]);
  }

  if ($route === '/sync/push' && $method === 'POST') {
    $deviceId = Request::deviceId();
    $u = UserRepo::requireUser($deviceId);
    $b = Request::jsonBody();
    $mutations = is_array($b['mutations'] ?? null) ? $b['mutations'] : [];
    $ack = [];
    foreach ($mutations as $m) {
      if (!is_array($m)) continue;
      $op = (string)($m['op'] ?? 'upsert');
      $entity = (string)($m['entity'] ?? '');
      $data = is_array($m['data'] ?? null) ? $m['data'] : [];
      if ($op !== 'upsert') continue;
      if ($entity === 'record') {
        $id = (string)($data['id'] ?? '');
        $type = (string)($data['type'] ?? '');
        $createdAt = (string)($data['created_at'] ?? (new DateTimeImmutable())->format(DATE_ATOM));
        $payload = is_array($data['data'] ?? null) ? $data['data'] : [];
        if ($id !== '' && $type !== '') {
          RecordRepo::upsert((int)$u['id'], $id, $type, $createdAt, $payload);
          if ($type === 'plant_check') {
            try { PlantCaseRepo::insertFromPlantCheck((string)$u['region_hash'], $payload); } catch (Throwable) {}
          }
          $ack[] = $id;
        }
      } elseif ($entity === 'alert') {
        $id = (string)($data['id'] ?? '');
        $kind = (string)($data['kind'] ?? 'aviso');
        $severity = (int)($data['severity'] ?? 2);
        $message = (string)($data['message'] ?? '');
        $createdAt = (string)($data['created_at'] ?? (new DateTimeImmutable())->format(DATE_ATOM));
        $meta = is_array($data['meta'] ?? null) ? $data['meta'] : [];
        if ($id !== '' && trim($message) !== '') {
          AlertRepo::publish((string)$u['region_hash'], $id, $kind, $severity, $message, $createdAt, $meta);
          $ack[] = $id;
        }
      }
    }

    $since = (string)($b['last_pull'] ?? '');
    $alerts = AlertRepo::pull((string)$u['region_hash'], $since !== '' ? $since : null, 50);
    Response::json([
      'ok' => true,
      'ack' => $ack,
      'server_time' => (new DateTimeImmutable())->format(DATE_ATOM),
      'alerts' => $alerts,
    ]);
  }

  Response::error('Rota não encontrada.', 404);
} catch (Throwable $e) {
  Response::error('Erro no servidor.', 500, [
    'type' => get_class($e),
    'message' => $e->getMessage(),
  ]);
}
