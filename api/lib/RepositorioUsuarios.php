<?php
declare(strict_types=1);

/*
  Repositório de usuários

  Aqui fica a parte de usuário:
  - salva/atualiza pelo `device_id` (id do celular)
  - calcula `region_hash` pela comunidade (pra separar por região)
  - cria um `producer_code` (código pra resgatar o cadastro em outro celular)
*/

require_once __DIR__ . '/Banco.php';

final class UserRepo
{
  private const PRODUCER_CODE_LEN = 10;

  /**
   * Arruma o texto da comunidade pra ficar “padrão” (pra calcular a região):
   * - minúsculas, espaços normalizados, remove caracteres estranhos.
   */
  public static function normalizeCommunity(string $community): string
  {
    $c = trim($community);
    $c = mb_strtolower($c, 'UTF-8');
    $c = preg_replace('/\s+/', ' ', $c) ?? $c;
    $c = preg_replace('/[^a-z0-9 áéíóúâêôãõç\-]/u', '', $c) ?? $c;
    return trim($c);
  }

  /**
   * Gera um código (hash) estável da comunidade (sha256).
   */
  public static function regionHash(string $community): string
  {
    $norm = self::normalizeCommunity($community);
    return hash('sha256', $norm);
  }

  /**
   * Busca usuário pelo `device_id` e garante que tem `producer_code`.
   */
  public static function getByDeviceId(string $deviceId): ?array
  {
    $pdo = Db::pdo();
    $st = $pdo->prepare('SELECT id, device_id, first_name, community, crops, region_hash, producer_code, created_at, updated_at FROM users WHERE device_id = ? LIMIT 1');
    $st->execute([$deviceId]);
    $u = $st->fetch();
    if (!$u) return null;
    $u['crops'] = $u['crops'] ? json_decode((string)$u['crops'], true) : [];
    if (!isset($u['producer_code']) || $u['producer_code'] === null || trim((string)$u['producer_code']) === '') {
      $pc = self::generateUniqueProducerCode($pdo);
      $st2 = $pdo->prepare('UPDATE users SET producer_code=?, updated_at=? WHERE id=?');
      $st2->execute([$pc, Db::now(), (int)$u['id']]);
      $u['producer_code'] = $pc;
    }
    return $u;
  }

  /**
   * Cria ou atualiza usuário pelo `device_id`.
   */
  public static function upsert(string $deviceId, string $firstName, string $community, array $crops, ?string $producerCode = null): array
  {
    $pdo = Db::pdo();
    $firstName = trim($firstName);
    $community = trim($community);
    $crops = array_values(array_filter(array_map('strval', $crops), fn($x) => trim($x) !== ''));
    $region = self::regionHash($community);
    $now = Db::now();
    $producerCode = is_string($producerCode) ? trim($producerCode) : null;
    if ($producerCode !== null && (strlen($producerCode) < 6 || strlen($producerCode) > 16)) $producerCode = null;

    $existing = self::getByDeviceId($deviceId);
    if ($existing) {
      $pc = (string)($existing['producer_code'] ?? '');
      if (trim($pc) === '') $pc = $producerCode ?: self::generateUniqueProducerCode($pdo);
      $st = $pdo->prepare('UPDATE users SET first_name=?, community=?, crops=?, region_hash=?, producer_code=?, updated_at=? WHERE device_id=?');
      $st->execute([$firstName, $community, json_encode($crops, JSON_UNESCAPED_UNICODE), $region, $pc, $now, $deviceId]);
    } else {
      $pc = $producerCode ?: self::generateUniqueProducerCode($pdo);
      try {
        $st = $pdo->prepare('INSERT INTO users (device_id, first_name, community, crops, region_hash, producer_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
        $st->execute([$deviceId, $firstName, $community, json_encode($crops, JSON_UNESCAPED_UNICODE), $region, $pc, $now, $now]);
      } catch (Throwable) {
        $pc = self::generateUniqueProducerCode($pdo);
        $st = $pdo->prepare('INSERT INTO users (device_id, first_name, community, crops, region_hash, producer_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
        $st->execute([$deviceId, $firstName, $community, json_encode($crops, JSON_UNESCAPED_UNICODE), $region, $pc, $now, $now]);
      }
    }
    return self::getByDeviceId($deviceId) ?? [];
  }

  /**
   * Resgata cadastro por `producer_code` e liga no celular atual.
   */
  public static function claimByProducerCode(string $deviceId, string $producerCode): array
  {
    $pdo = Db::pdo();
    $code = trim($producerCode);
    if (strlen($code) < 6 || strlen($code) > 16) Response::error('Código inválido.', 422);
    $st = $pdo->prepare('SELECT id FROM users WHERE producer_code = ? LIMIT 1');
    $st->execute([$code]);
    $row = $st->fetch();
    if (!$row) Response::error('Código não encontrado.', 404);
    $userId = (int)($row['id'] ?? 0);
    if ($userId <= 0) Response::error('Código não encontrado.', 404);

    $st = $pdo->prepare('SELECT id FROM users WHERE device_id = ? LIMIT 1');
    $st->execute([$deviceId]);
    $existing = $st->fetch();
    if ($existing && (int)($existing['id'] ?? 0) !== $userId) {
      Response::error('Esse celular já está cadastrado em outro usuário.', 409);
    }

    $now = Db::now();
    $st = $pdo->prepare('UPDATE users SET device_id=?, updated_at=? WHERE id=?');
    $st->execute([$deviceId, $now, $userId]);
    return self::getByDeviceId($deviceId) ?? [];
  }

  /**
   * Confere se existe usuário; se não existir, devolve erro 403.
   */
  public static function requireUser(string $deviceId): array
  {
    $u = self::getByDeviceId($deviceId);
    if (!$u) Response::error('Cadastre seu nome primeiro. (Menu Início → Cadastro)', 403);
    return $u;
  }

  /**
   * Gera um `producer_code` curto.
   * A gente evita letras/números parecidos pra não confundir na hora de digitar.
   */
  private static function generateUniqueProducerCode(PDO $pdo): string
  {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for ($tries = 0; $tries < 30; $tries++) {
      $bytes = random_bytes(self::PRODUCER_CODE_LEN);
      $out = '';
      for ($i = 0; $i < self::PRODUCER_CODE_LEN; $i++) {
        $out .= $alphabet[ord($bytes[$i]) % strlen($alphabet)];
      }
      $st = $pdo->prepare('SELECT id FROM users WHERE producer_code = ? LIMIT 1');
      $st->execute([$out]);
      $row = $st->fetch();
      if (!$row) return $out;
    }
    return bin2hex(random_bytes(8));
  }
}
