Apfelbuch V20

Korrektur gegenüber V19:
- Verwechslersorten & Unterschiede werden jetzt in den Suchergebnissen wirklich angezeigt.
- Ursache: Der von findReference() gelieferte Fachdatensatz besitzt nicht zwingend das Laufzeit-Flag builtInKnowledge. V19 hat deshalb den Vergleichsblock trotz Fachwissen ausgeblendet.
- V20 prüft stattdessen direkt, ob ein Fachdatensatz vorhanden ist.
- Service-Worker-Cache auf V20 erhöht.

Alle bisherigen Funktionen bleiben erhalten.
