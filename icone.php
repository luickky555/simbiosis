<?php
declare(strict_types=1);

$size = isset($_GET['size']) ? (int)$_GET['size'] : 192;
$size = max(16, min(1024, $size));

header('Cache-Control: public, max-age=3600');

$logoCandidates = [
  __DIR__ . '/app/assets/app_icon.png',
  __DIR__ . '/app/assets/app_icon.jpg',
  __DIR__ . '/app/assets/app_icon.jpeg',
  __DIR__ . '/app/assets/app_icon.webp',
  __DIR__ . '/app_icon.png',
  __DIR__ . '/app_icon.jpg',
  __DIR__ . '/app_icon.jpeg',
  __DIR__ . '/app_icon.webp',
  __DIR__ . '/favicon.png',
  __DIR__ . '/icone_navegador.jpg',
  __DIR__ . '/favicon.jpeg',
  __DIR__ . '/favicon.webp',
  __DIR__ . '/app/assets/logo.png',
  __DIR__ . '/app/assets/logo.jpg',
  __DIR__ . '/app/assets/logo.jpeg',
  __DIR__ . '/app/assets/logo.webp',
  __DIR__ . '/logo.png',
  __DIR__ . '/logo.jpg',
  __DIR__ . '/logo.jpeg',
  __DIR__ . '/logo.webp',
];
$logoPath = null;
foreach ($logoCandidates as $p) {
  if (is_string($p) && is_file($p)) { $logoPath = $p; break; }
}
$hasLogo = $logoPath !== null;

if (!extension_loaded('gd')) {
  $s = (string)$size;
  if ($hasLogo) {
    $ext = strtolower((string)pathinfo((string)$logoPath, PATHINFO_EXTENSION));
    $mime = match ($ext) {
      'png' => 'image/png',
      'jpg', 'jpeg' => 'image/jpeg',
      'webp' => 'image/webp',
      default => 'application/octet-stream',
    };
    header('Content-Type: ' . $mime);
    @readfile((string)$logoPath);
    exit;
  }
  header('Content-Type: image/svg+xml; charset=utf-8');
  echo <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="$s" height="$s" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="44" fill="#2f6b3f"/>
  <path d="M86 170c26 18 58 18 84 0 14-10 22-24 24-40-20 6-40 0-52-14-12 14-32 20-52 14 2 16 10 30 24 40z" fill="#e8f3d6"/>
  <text x="128" y="86" text-anchor="middle" font-family="system-ui,Segoe UI,Arial" font-size="34" fill="#ffffff">RQ</text>
</svg>
SVG;
  exit;
}

header('Content-Type: image/png');

$img = imagecreatetruecolor($size, $size);
imagesavealpha($img, true);
$transparent = imagecolorallocatealpha($img, 0, 0, 0, 127);
imagefill($img, 0, 0, $transparent);

if ($hasLogo) {
  $raw = @file_get_contents($logoPath);
  $src = $raw !== false ? @imagecreatefromstring($raw) : false;
  if ($src !== false) {
    imagesavealpha($src, true);
    $sw = imagesx($src);
    $sh = imagesy($src);
    if ($sw > 0 && $sh > 0) {
      $scale = min($size / $sw, $size / $sh);
      $nw = max(1, (int)round($sw * $scale));
      $nh = max(1, (int)round($sh * $scale));
      $dx = (int)floor(($size - $nw) / 2);
      $dy = (int)floor(($size - $nh) / 2);
      imagecopyresampled($img, $src, $dx, $dy, 0, 0, $nw, $nh, $sw, $sh);
      imagepng($img);
      imagedestroy($src);
      imagedestroy($img);
      exit;
    }
    imagedestroy($src);
  }
}

$bg = imagecolorallocate($img, 47, 107, 63);
$cream = imagecolorallocate($img, 232, 243, 214);
$white = imagecolorallocate($img, 255, 255, 255);

imagefilledrectangle($img, 0, 0, $size, $size, $bg);

$pad = (int)round($size * 0.12);
$cx = (int)round($size / 2);
$cy = (int)round($size * 0.62);

$w = (int)round($size * 0.34);
$h = (int)round($size * 0.28);
$poly = [
  $cx - $w, $cy,
  $cx - (int)round($w * 0.6), $cy + (int)round($h * 0.6),
  $cx, $cy + $h,
  $cx + (int)round($w * 0.6), $cy + (int)round($h * 0.6),
  $cx + $w, $cy,
  $cx + (int)round($w * 0.2), $cy - (int)round($h * 0.9),
  $cx - (int)round($w * 0.2), $cy - (int)round($h * 0.9),
];
imagefilledpolygon($img, $poly, count($poly) / 2, $cream);

$fontSize = max(10, (int)round($size * 0.18));
$text = 'RQ';
$font = 5;
$tw = imagefontwidth($font) * strlen($text);
$th = imagefontheight($font);
$tx = $cx - (int)round($tw / 2);
$ty = $pad;
imagestring($img, $font, $tx, $ty, $text, $white);

imagepng($img);
imagedestroy($img);
