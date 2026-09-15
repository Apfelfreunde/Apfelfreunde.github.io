APFELBUCH – ERSTE VERSION
=========================

Was diese Version kann
----------------------
- Läuft als responsive Web-App auf PC und Smartphone.
- Kann auf unterstützten Geräten als PWA installiert werden.
- Fotos können per Kamera oder Dateiauswahl hinzugefügt werden.
- Sorten werden durch Bildbeispiele angelernt.
- Unbekannte Bilder werden mit den angelernten Sorten verglichen.
- Trainingsbilder und KI-Merkmale werden in IndexedDB im Browser gespeichert.
- Trainingsdaten können als JSON exportiert und auf einem anderen Gerät importiert werden.

So startest du die App auf dem PC
---------------------------------
1. Entpacke den Ordner.
2. Öffne in diesem Ordner ein Terminal / eine Eingabeaufforderung.
3. Starte einen kleinen lokalen Webserver, z. B. mit Python:

   python -m http.server 8000

4. Öffne im Browser:
   http://localhost:8000

Wichtig: Nicht einfach index.html doppelklicken. PWA und Service Worker brauchen einen Webserver.

Handy-Nutzung
-------------
Am zuverlässigsten ist es, diesen Ordner auf einem HTTPS-Webhosting zu veröffentlichen,
z. B. GitHub Pages, Netlify oder Vercel. Dann kann die Seite auf Android/iPhone geöffnet
und zum Startbildschirm hinzugefügt werden. Für direkten Kamerazugriff verlangen viele
Browser HTTPS.

KI-Hinweis
----------
Die App nutzt MobileNet im Browser als Bild-Merkmalsmodell und vergleicht deine eigenen
Trainingsbeispiele. Sie ist deshalb bereits lernfähig, aber noch kein spezialisiertes
pomologisches KI-Modell. Für eine ernsthafte Sortenerkennung werden viele gute, korrekt
beschriftete Fotos benötigt. Später sollte daraus ein eigenes Modell trainiert werden.

Empfohlene nächste Ausbaustufe
------------------------------
- zentrale Cloud-Datenbank, damit Handy und PC automatisch dieselben Sorten/Fotos sehen
- Benutzerkonto und automatische Synchronisation
- Metadaten pro Sorte: Synonyme, Herkunft, Reifezeit, Geschmack, Nutzung, Lagerung
- mehrere Fotoarten pro Apfel (Seite, Stiel, Kelch, Schnittbild)
- eigenes Trainingsmodell mit Export/Backup
- Buchansicht und PDF-/Druckexport
