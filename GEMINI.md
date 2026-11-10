# Reglas Permanentes del Proyecto — Giving Out WMS

## Protocolo Obligatorio de Checkpoint, Respaldo y Documentación

A partir del corte a operación real (Fase 3B), siempre que se realice un commit y push significativo en este repositorio, es **obligatorio** cumplir estrictamente con los siguientes pasos como parte del cierre de cada checkpoint importante:

1. **Documentación Técnica del Cambio:**
   - Detallar con precisión qué archivos y módulos fueron modificados y cuál fue el objetivo técnico/operativo.

2. **Registro de Trazabilidad en Git:**
   - Registrar el hash completo y abreviado del commit generado.
   - Registrar la rama exacta donde se realizó el commit y push.
   - Confirmar el estado de sincronización entre el HEAD local y el branch remoto en `origin`.
   - Dejar constancia explícita de si las ramas troncales `main` y `dev` fueron modificadas o permanecieron intactas.

3. **Ejecución y Registro de Pruebas:**
   - Ejecutar la suite de pruebas automatizadas y compilaciones (`nest build` en backend, `tsc -b && vite build` en frontend, `git diff --check`).
   - Registrar la cantidad de pruebas ejecutadas y su resultado numérico exacto (e.g. `38/38 PASS`, `93/93 PASS`).

4. **Actualización de CHANGELOG.md:**
   - Actualizar `CHANGELOG.md` agregando o complementando la entrada de versión correspondiente bajo el estándar *Keep a Changelog*.

5. **Actualización de Knowledge Items (KIs / Memoria Interna):**
   - Actualizar los archivos de conocimiento (`progress_and_decisions_summary.md` y `metadata.json`) en el almacén de conocimiento interno (`antigravity-ide/knowledge/giving_out_wms_receiving_and_reports/`).
   - Registrar el nuevo estado certificado y el **punto exacto de reanudación** para la siguiente sesión de trabajo.

6. **Constancia de Estado de Base de Datos:**
   - Dejar constancia formal de si hubo o no cambios en la base de datos (DDL, migraciones, registros de inventario, HUs, movimientos o estados de recepciones/pedidos).
   - En fases de preflight o consulta, auditar e informar que `LotInventory = 0`, `HandlingUnit = 0` y `InventoryMovement = 0` si aplica.
