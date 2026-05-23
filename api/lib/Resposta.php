<?php
declare(strict_types=1);

/*
  Resposta da API

  Só pra não repetir código:
  - `json(...)` manda um JSON e encerra
  - `error(...)` manda um erro no formato que o app entende e encerra
*/

final class Response
{
  /**
   * Manda o JSON e para a execução.
   */
  public static function json(array $data, int $status = 200): void
  {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  /**
   * Manda erro no formato padrão do app e para a execução.
   */
  public static function error(string $message, int $status = 400, ?array $details = null): void
  {
    $payload = ['ok' => false, 'error' => ['message' => $message]];
    if ($details !== null) $payload['error']['details'] = $details;
    self::json($payload, $status);
  }
}
