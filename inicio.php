<?php
declare(strict_types=1);

header('Content-Type: text/html; charset=utf-8');

$appName = 'SIMBIOSIS LITE';
$appShort = 'SIMBIOSIS';
$appVersion = '0.4.6';
$logoCandidates = [
  __DIR__ . '/logo.png',
  __DIR__ . '/logo.jpg',
  __DIR__ . '/logo.jpeg',
  __DIR__ . '/logo.webp',
];
$logoPath = null;
foreach ($logoCandidates as $p) {
  if (is_string($p) && is_file($p)) { $logoPath = $p; break; }
}
$logoUrl = $logoPath ? ('logo.' . pathinfo($logoPath, PATHINFO_EXTENSION) . '?v=' . rawurlencode($appVersion)) : ('icone.php?size=192&v=' . rawurlencode($appVersion));
?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#2f6b3f">
  <meta name="description" content="SIMBIOSIS LITE: plataforma offline-first para agricultura familiar em consórcio (mandioca, milho, feijão e melancia).">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <base href="./">

  <link rel="manifest" href="manifesto.webmanifest?v=<?= htmlspecialchars($appVersion, ENT_QUOTES) ?>">
  <link rel="icon" sizes="64x64" href="icone.php?size=64&v=<?= htmlspecialchars($appVersion, ENT_QUOTES) ?>">
  <link rel="icon" sizes="32x32" href="icone.php?size=32&v=<?= htmlspecialchars($appVersion, ENT_QUOTES) ?>">
  <link rel="apple-touch-icon" href="icone.php?size=192&v=<?= htmlspecialchars($appVersion, ENT_QUOTES) ?>">

  <title><?= htmlspecialchars($appName, ENT_QUOTES) ?></title>

  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH" crossorigin="anonymous">
  <link rel="stylesheet" href="app/css/estilo.css?v=<?= htmlspecialchars($appVersion, ENT_QUOTES) ?>">
</head>
<body class="rq-body">
  <noscript>
    <div class="container py-4">
      <h1 class="h4">Ative o JavaScript</h1>
      <p>O <?= htmlspecialchars($appName, ENT_QUOTES) ?> precisa de JavaScript para funcionar offline.</p>
    </div>
  </noscript>

  <header class="rq-topbar">
    <div class="rq-topbar__brand">
      <img class="rq-topbar__logo" alt="SIMBIOSIS LITE" src="<?= htmlspecialchars($logoUrl, ENT_QUOTES) ?>">
    </div>
    <div class="rq-topbar__status" id="rqNetStatus" aria-live="polite"></div>
  </header>

  <main class="rq-main" id="rqApp" tabindex="-1"></main>

  <nav class="rq-bottombar" aria-label="Menu">
    <button class="rq-navbtn" data-route="#/home" type="button">
      <span class="rq-navbtn__icon" aria-hidden="true">🏠</span>
      <span class="rq-navbtn__label">Início</span>
    </button>
    <button class="rq-navbtn" data-route="#/diario" type="button">
      <span class="rq-navbtn__icon" aria-hidden="true">📒</span>
      <span class="rq-navbtn__label">Diário</span>
    </button>
    <button class="rq-navbtn" data-route="#/ajuda" type="button">
      <span class="rq-navbtn__icon" aria-hidden="true">❓</span>
      <span class="rq-navbtn__label">Ajuda</span>
    </button>
  </nav>

  <div class="rq-toastwrap" aria-live="polite" aria-atomic="true" id="rqToasts"></div>

  <script>
    window.__RQ__ = {
      name: <?= json_encode($appName, JSON_UNESCAPED_UNICODE) ?>,
      short: <?= json_encode($appShort, JSON_UNESCAPED_UNICODE) ?>,
      version: <?= json_encode($appVersion, JSON_UNESCAPED_UNICODE) ?>,
      apiBase: "api"
    };
  </script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz" crossorigin="anonymous"></script>
  <script type="module" src="app/js/aplicativo.js?v=<?= htmlspecialchars($appVersion, ENT_QUOTES) ?>"></script>
</body>
</html>
