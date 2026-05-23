<?php
declare(strict_types=1);

/*
  Repositório do Diário

  Aqui a gente guarda os registros do Diário no banco:
  - `local_uuid` vem do celular (um id único)
  - `payload` é JSON (a foto não vai pro servidor)
*/

require_once __DIR__ . '/Banco.php';

final class RecordRepo
{
  /**
   * Insere/atualiza um registro do usuário.
   */
  public static function upsert(int $userId, string $localUuid, string $type, string $createdAtIso, array $payload): void
  {
    $pdo = Db::pdo();
    $localUuid = trim($localUuid);
    $type = trim($type);
    $createdAt = self::isoToMysql($createdAtIso) ?? Db::now();

    $st = $pdo->prepare(
      'INSERT INTO records (user_id, local_uuid, type, created_at, payload)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE type=VALUES(type), created_at=VALUES(created_at), payload=VALUES(payload)'
    );
    $st->execute([
      $userId,
      $localUuid,
      $type,
      $createdAt,
      json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    ]);
  }

  /**
   * Lista os registros mais recentes do usuário.
   */
  public static function listRecent(int $userId, int $limit = 80): array
  {
    $pdo = Db::pdo();
    $limit = max(1, min(200, $limit));
    $st = $pdo->prepare('SELECT local_uuid, type, created_at, payload FROM records WHERE user_id=? ORDER BY created_at DESC LIMIT ' . $limit);
    $st->execute([$userId]);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
      $r['payload'] = $r['payload'] ? json_decode((string)$r['payload'], true) : [];
      $r['created_at'] = self::mysqlToIso((string)$r['created_at']);
    }
    return $rows;
  }

  /**
   * Converte ISO para data/hora do MySQL (Y-m-d H:i:s).
   */
  public static function isoToMysql(string $iso): ?string
  {
    try {
      $dt = new DateTimeImmutable($iso);
      return $dt->format('Y-m-d H:i:s');
    } catch (Throwable) {
      return null;
    }
  }

  /**
   * Converte data/hora do MySQL para ISO.
   */
  public static function mysqlToIso(string $mysql): string
  {
    try {
      $dt = new DateTimeImmutable($mysql);
      return $dt->format(DATE_ATOM);
    } catch (Throwable) {
      return $mysql;
    }
  }
}
