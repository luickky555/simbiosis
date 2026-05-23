<?php
declare(strict_types=1);

/*
  Repositório de alertas

  Alertas = recados da comunidade, separados por região:
  - alguém publica (ex.: “lagarta apareceu”)
  - quem é da mesma região recebe na sincronização
*/

require_once __DIR__ . '/Banco.php';
require_once __DIR__ . '/RepositorioRegistros.php';

final class AlertRepo
{
  /**
   * Publica (ou atualiza) um alerta na região.
   */
  public static function publish(string $regionHash, string $localUuid, string $kind, int $severity, string $message, string $createdAtIso, array $payload): void
  {
    $pdo = Db::pdo();
    $severity = max(1, min(5, $severity));
    $message = mb_substr(trim($message), 0, 255, 'UTF-8');
    $createdAt = RecordRepo::isoToMysql($createdAtIso) ?? Db::now();

    $st = $pdo->prepare(
      'INSERT INTO alerts (region_hash, local_uuid, kind, severity, message, payload, created_at)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE kind=VALUES(kind), severity=VALUES(severity), message=VALUES(message), payload=VALUES(payload), created_at=VALUES(created_at)'
    );
    $st->execute([
      $regionHash,
      $localUuid,
      $kind,
      $severity,
      $message,
      json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
      $createdAt
    ]);
  }

  /**
   * Busca alertas da região mais recentes que `sinceIso` (quando informado).
   */
  public static function pull(string $regionHash, ?string $sinceIso, int $limit = 50): array
  {
    $pdo = Db::pdo();
    $limit = max(1, min(200, $limit));
    if ($sinceIso) {
      $since = RecordRepo::isoToMysql($sinceIso) ?? null;
    } else {
      $since = null;
    }
    if ($since) {
      $st = $pdo->prepare('SELECT local_uuid, kind, severity, message, payload, created_at FROM alerts WHERE region_hash=? AND created_at > ? ORDER BY created_at DESC LIMIT ' . $limit);
      $st->execute([$regionHash, $since]);
    } else {
      $st = $pdo->prepare('SELECT local_uuid, kind, severity, message, payload, created_at FROM alerts WHERE region_hash=? ORDER BY created_at DESC LIMIT ' . $limit);
      $st->execute([$regionHash]);
    }
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
      $r['payload'] = $r['payload'] ? json_decode((string)$r['payload'], true) : [];
      $r['created_at'] = RecordRepo::mysqlToIso((string)$r['created_at']);
    }
    return $rows;
  }
}
