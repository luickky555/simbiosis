<?php
declare(strict_types=1);

/*
  Configuração da API

  Aqui a gente pega as configs do banco pelas variáveis de ambiente (RQ_DB_*),
  assim dá pra colocar em produção sem ficar mexendo no código.
*/

final class Config
{
  /**
   * Lê uma variável de ambiente com default.
   */
  public static function env(string $key, ?string $default = null): ?string
  {
    $v = getenv($key);
    if ($v === false || $v === '') return $default;
    return $v;
  }

  /**
   * Configuração de conexão MySQL/MariaDB.
   */
  public static function db(): array
  {
    return [
      'host' => self::env('RQ_DB_HOST', '127.0.0.1'),
      'port' => (int)(self::env('RQ_DB_PORT', '3306')),
      'name' => self::env('RQ_DB_NAME', 'simbiosis_lite'),
      'user' => self::env('RQ_DB_USER', 'root'),
      'pass' => self::env('RQ_DB_PASS', ''),
      'charset' => self::env('RQ_DB_CHARSET', 'utf8mb4'),
    ];
  }
}
