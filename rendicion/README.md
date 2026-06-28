# Automatizacion de rendiciones

Esta carpeta contiene la primera fase de la automatizacion: un relevamiento de solo lectura de las pantallas disponibles para el usuario autenticado.

## Ejecutar

Desde PowerShell:

```powershell
.\rendicion\iniciar_relevamiento.ps1
```

1. Se abre una ventana de Chrome con un perfil separado.
2. Inicia sesion directamente en la pagina de Janos Group.
3. Cuando aparezca la pantalla principal, vuelve a PowerShell y presiona Enter.
4. El resultado queda en `rendicion/relevamiento/mapa.json`, junto con HTML y capturas de cada pantalla inspeccionada.

El relevamiento no completa ni envia formularios. Evita enlaces de salida, cancelacion y eliminacion. La sesion queda en `rendicion/.perfil-chrome`, dentro de este equipo; no se escribe la contrasena en los archivos generados.

No compartas la carpeta `.perfil-chrome`, porque contiene las cookies de la sesion.

## Historial descargado

Para convertir el `mis.html` guardado por Chrome a CSV:

```powershell
$modules = "C:\Users\HunterPC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules"
$env:NODE_PATH = "$modules;$modules\.pnpm\node_modules"
& "C:\Users\HunterPC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\rendicion\extraer_historial.js "C:\ruta\mis.html"
```

## Preparar cargas desde CSV

Completa una copia de `plantilla_carga.csv`. Los textos de categoria, salon y trabajo deben coincidir con los que muestra la web.

El modo predeterminado completa cada fila y guarda una captura, pero no envia nada:

```powershell
.\rendicion\iniciar_carga.ps1 -Csv .\rendicion\plantilla_carga.csv
```

Despues de revisar las capturas, agrega `-Confirmar`. Aun asi, el programa pide escribir `SI` antes de enviar cada rendicion.
