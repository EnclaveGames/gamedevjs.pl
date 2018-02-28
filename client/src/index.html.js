import extractManifestSource from "../config/webpack/helpers/extractManifestSource";

module.exports = function(templateParams) {
    const isDebug = process.env.NODE_ENV !== 'production';

    return `

<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="utf-8">
    <title>Gamedev.js - Spotkania z tworzeniem gier w HTML5 i JavaScript</title>
    <meta name="description" content="Gamedev.js to społeczność organizująca spotkania związane z tworzeniem gier w technologii HTML5 i języku JavaScript, także na urządzenia mobilne" />
    <meta name="keywords" content="gamedev, html5, javascript, tworzenie gier, społeczność, spotkania, meetup, warszawa, kraków, poznań, gamejam, hackaton" />
    <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
    <meta name="msapplication-TileColor" content="#00bede">
    <meta name="msapplication-TileImage" content="/img/fav/144x144.png">
    <meta name="theme-color" content="#00bede">
    <link rel="apple-touch-icon" sizes="57x57" href="/img/fav/57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="/img/fav/60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="/img/fav/72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="/img/fav/76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="/img/fav/114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="/img/fav/120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="/img/fav/144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="/img/fav/152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/img/fav/180x180.png">
    <link rel="icon" type="image/png" sizes="192x192"  href="/img/fav/192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/img/fav/32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="/img/fav/96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/img/fav/16x16.png">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="manifest" href="/manifest.json">
</head>
<body>
    <div id="app"></div>
    <script>
        ${extractManifestSource(templateParams.compilation)};

        var __bootstrap = ${templateParams.htmlWebpackPlugin.options.bootstrap};

        ${isDebug ? '' : `
                if('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('/sw-precache-static.js');
                }
            ;`
        }
    </script>
    ${isDebug ? '' : `
        <script>window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
        </script>
        <script async src="https://googletagmanager.com/gtag/js?id=UA-37334507-6"></script>
    `}
</body>
</html>

`;
};