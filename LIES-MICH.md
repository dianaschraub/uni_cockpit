# Uni-Cockpit: GitHub-Paket für Android

Version 2.1.1: kräftige Farben, kompakte Kennzahlen und neu gestaltete Terminliste. Unter jedem
Countdown lässt sich „Teilaufgaben & Vorbereitung“ öffnen. Aufgabe 1–3 sind
pro Abgabe voreingestellt. Mit „Teilaufgabe hinzufügen“ können Aufgabe 4, 5
und weitere Einträge ergänzt und umbenannt werden. Mathe erhält zusätzlich
„Quiz als PDF umformatiert“. Alle Häkchen werden automatisch gespeichert.
Vorhandene Termine, Ergebnisse und Bearbeitungshäkchen bleiben erhalten.
Nach dem Update alle Cockpit-Tabs und die installierte App vollständig
schließen und erneut öffnen, damit der neue Offline-Cache aktiviert wird.

Dieses Paket enthält die fertige Firebase-App ohne Unterordner. ZIP zuerst
entpacken, dann alle enthaltenen Dateien in die oberste Ebene des GitHub-
Repositorys hochladen. Die ZIP-Datei selbst wird nicht hochgeladen.

In GitHub: Add file → Upload files → choose your files. Alle Dateien auswählen,
Upload abwarten und mit Commit changes bestätigen. Auf dem Handy kann dafür
die Chrome-Einstellung „Desktopwebsite“ hilfreich sein.

Netlify mit dem bestehenden Projekt unicockpit verknüpfen:

- Base directory: leer
- Build command: leer
- Publish directory: .

Die beiliegende netlify.toml enthält diese Einstellungen. Dieses Paket hat
keinen dist-Ordner; die index.html liegt direkt im Repository.

Die Firebase-Regeln müssen weiterhin separat in Firebase veröffentlicht sein.
Eine GitHub-Veröffentlichung verändert sie nicht. Die persönlichen Eingaben
stehen nicht in diesem Paket und werden nicht nach GitHub übertragen.

Das vollständige Quellcode-Paket mit Tests bleibt für die Weiterentwicklung
verfügbar. Diese flache Ausgabe vereinfacht das Hochladen auf Android.
