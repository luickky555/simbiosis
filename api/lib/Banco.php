<?php
declare(strict_types=1);

/*
  Conexão com o banco (MySQL) via PDO

  A gente deixa as credenciais em variável de ambiente (RQ_DB_*),
  porque é mais certo pra produção e não fica senha no código.
*/

require_once __DIR__ . '/Configuracao.php';

final class Db
{
  private static ?PDO $pdo = null;
  private static bool $migrated = false;

  /**
   * Pega a conexão do banco (a gente cria só uma e reaproveita).
   * Aqui também rola umas “correções” automáticas do banco, bem básicas, pra não quebrar.
   */
  public static function pdo(): PDO
  {
    if (self::$pdo) return self::$pdo;
    $c = Config::db();
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $c['host'], $c['port'], $c['name'], $c['charset']);
    $pdo = new PDO($dsn, $c['user'], $c['pass'], [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    self::$pdo = $pdo;
    self::migrate($pdo, (string)$c['name']);
    return $pdo;
  }

  /**
   * Ajustes mínimos no banco pra manter compatível (sem precisar rodar script na mão).
   */
  private static function migrate(PDO $pdo, string $dbName): void
  {
    if (self::$migrated) return;
    self::$migrated = true;
    try {
      $st = $pdo->prepare("SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='producer_code'");
      $st->execute([$dbName]);
      $c = (int)($st->fetchColumn() ?: 0);
      if ($c === 0) {
        $pdo->exec("ALTER TABLE users ADD COLUMN producer_code VARCHAR(16) NULL");
      }
      $st = $pdo->prepare("SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND INDEX_NAME='uniq_producer_code'");
      $st->execute([$dbName]);
      $ix = (int)($st->fetchColumn() ?: 0);
      if ($ix === 0) {
        $pdo->exec("CREATE UNIQUE INDEX uniq_producer_code ON users (producer_code)");
      }
    } catch (Throwable) {
    }
  }

  /**
   * Data/hora do servidor no formato do MySQL.
   */
  public static function now(): string
  {
    return (new DateTimeImmutable('now'))->format('Y-m-d H:i:s');
  }
}
