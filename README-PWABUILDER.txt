APFELBUCH – PWA FÜR ANDROID / PWABUILDER
=========================================

Diese Version ist für die Veröffentlichung als Progressive Web App (PWA)
und für das Verpacken als Android-App mit PWABuilder vorbereitet.

WICHTIG
-------
PWABuilder braucht eine öffentlich erreichbare HTTPS-Adresse zu deiner PWA.
Eine ZIP-Datei alleine kann PWABuilder nicht als fertige Online-App prüfen.

SCHRITT 1 – APP KOSTENLOS ONLINE STELLEN
----------------------------------------
Du kannst die Dateien in diesem ZIP z. B. auf GitHub Pages, Netlify oder
Cloudflare Pages veröffentlichen. Danach hast du eine Adresse ähnlich wie:
https://deinname.github.io/apfelbuch/

SCHRITT 2 – PWA TESTEN
----------------------
Öffne die HTTPS-Adresse auf deinem Android-Handy in Chrome.
- Kamera/Dateiauswahl testen
- eine Sorte anlegen
- ein Foto speichern
- App über Browser-Menü bzw. Installieren zum Startbildschirm hinzufügen

SCHRITT 3 – MIT PWABUILDER VERPACKEN
------------------------------------
1. Öffne https://www.pwabuilder.com/
2. Gib die HTTPS-Adresse deiner Apfelbuch-PWA ein.
3. Lass PWABuilder Manifest und Service Worker prüfen.
4. Wähle anschließend Android / Package for stores bzw. Test Package.
5. Für erste Tests reicht ein Testpaket. Für Google Play wird später ein
   korrekt signiertes Store-Paket und ein Google-Play-Entwicklerkonto benötigt.

ANDROID-ID (VORSCHLAG)
----------------------
Wenn PWABuilder nach einer Package ID fragt, kannst du z. B. verwenden:
de.apfelbuch.app

APP-NAME
--------
Apfelbuch

HINWEIS ZUR KI
--------------
Die App lädt TensorFlow.js und MobileNet derzeit von jsDelivr. Deshalb wird
beim ersten Laden Internet benötigt. Nach erfolgreichem Laden kann der Service
Worker bereits geladene Dateien zwischenspeichern, aber diese Version ist noch
nicht als vollständig offline-fähige KI-App ausgelegt.

DATEN
-----
Trainingsbilder und Merkmale liegen zunächst lokal auf dem jeweiligen Gerät in
IndexedDB. Mit Export/Import kannst du Daten zwischen Handy und PC übertragen.
Eine gemeinsame Cloud-Synchronisierung bauen wir als nächsten Schritt ein.
