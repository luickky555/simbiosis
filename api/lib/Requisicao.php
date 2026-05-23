<?php
declare(strict_types=1);

/*
  Requisição (ajudinhas)

  Aqui fica o básico pra API:
  - pegar JSON do body
  - ler o `X-Device-Id`
  - pegar caminho, método e parâmetros
*/

final class Request
{
  /**
   * Lê o JSON do body e devolve como array.
   * Se o JSON estiver errado, já devolve erro 400.
   */
  public static function jsonBody(): array
  {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) Response::error('JSON inválido.', 400);
    return $data;
  }

  /**
   * Retorna o device_id informado pelo app (header `X-Device-Id`).
   * Se não vier, devolve erro 401.
   */
  public static function deviceId(): string
  {
    $id = $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
    $id = trim($id);
    if ($id === '') Response::error('Faltou X-Device-Id.', 401);
    if (strlen($id) > 80) Response::error('X-Device-Id inválido.', 401);
    return $id;
  }

  /**
   * Pega o caminho da URL (sem os parâmetros).
   */
  public static function path(): string
  {
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = parse_url($uri, PHP_URL_PATH);
    if (!is_string($path)) return '/';
    return $path;
  }

  /**
   * Pega o método HTTP (GET/POST/...).
   */
  public static function method(): string
  {
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
  }

  /**
   * Pega um parâmetro da URL.
   */
  public static function query(string $key, ?string $default = null): ?string
  {
    $v = $_GET[$key] ?? $default;
    if ($v === null) return null;
    $v = trim((string)$v);
    return $v === '' ? $default : $v;
  }
}
