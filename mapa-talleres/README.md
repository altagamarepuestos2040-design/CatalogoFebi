# Mapa de talleres y casas de repuestos

Mapa interactivo con Leaflet.js + OpenStreetMap (sin API key) que muestra los
lugares cargados en un Google Sheet, coloreados según `estado_contacto`.

Archivos:
- `Code.gs` — script de Google Apps Script: expone el Sheet como JSON y geocodifica direcciones con Nominatim.
- `mapa.html` — página con el mapa (Leaflet).

## 1. Preparar el Google Sheet

Creá (o usá uno existente) un Google Sheet con estas columnas en la fila 1,
en cualquier orden pero con estos nombres exactos:

```
nombre | direccion | latitud | longitud | telefono | zona | provincia | estado_contacto | fecha_ultimo_contacto | notas
```

- `zona`: usar `CABA`, `GBA` o `Interior` (los filtros del mapa buscan estos valores).
- `estado_contacto`: usar `sin_contactar`, `contactado` o `cliente` (también tolera "Sin contactar", "Contactado", etc. con mayúsculas/tildes).
- `latitud` y `longitud` pueden quedar vacías — el script las completa automáticamente (paso 4).

## 2. Cargar el script en Apps Script

1. Abrí tu Google Sheet.
2. Menú **Extensiones > Apps Script**.
3. Borrá el contenido de `Código.gs` que viene por defecto y pegá el contenido de [`Code.gs`](Code.gs).
4. Si tu hoja no se llama `Hoja 1`, cambiá la constante `NOMBRE_HOJA` al principio del script por el nombre real de tu pestaña.
5. En `geocodificarDireccion`, reemplazá el email de ejemplo en el `User-Agent` por uno tuyo (Nominatim pide poder identificar quién hace las consultas).
6. Guardá el proyecto (ícono de disco o Ctrl+S).

## 3. Publicar como Web App

1. En el editor de Apps Script: **Implementar > Nueva implementación**.
2. Tipo: **Aplicación web**.
3. Configurá:
   - **Ejecutar como**: Yo (tu cuenta).
   - **Quién tiene acceso**: Cualquier usuario.
4. Hacé clic en **Implementar** y autorizá los permisos que pida Google (acceso a la hoja y a servicios externos por el `UrlFetchApp` del geocoding).
5. Copiá la **URL de la aplicación web** que te da (termina en `/exec`).

Cada vez que modifiques `Code.gs` tenés que crear una **nueva implementación**
(o editar la existente) para que los cambios se reflejen en esa URL.

## 4. Geocodificar las direcciones existentes

Tenés dos formas de completar `latitud`/`longitud` para las filas que no las tengan:

**Opción A — desde el Sheet (recomendada):**
Al volver a abrir el Sheet vas a ver un nuevo menú **Mapa Talleres > Geocodificar
direcciones faltantes**. Hacé clic y esperá — geocodifica ~1 dirección por
segundo (límite de Nominatim) y va guardando lat/lng directamente en la hoja,
así no se vuelve a geocodificar la próxima vez.

**Opción B — desde el navegador:**
Entrá a `TU_URL_DEL_WEB_APP?action=geocodificar`. Vas a ver un JSON de resumen
cuando termine (puede tardar si hay muchas filas, ya que respeta 1 request/seg).

Repetí este paso cada vez que agregues filas nuevas sin coordenadas.

## 5. Conectar el mapa (`mapa.html`) a tu Sheet

Abrí `mapa.html` y reemplazá esta línea con la URL que copiaste en el paso 3:

```js
var URL_WEB_APP = 'PEGAR_AQUI_LA_URL_DE_TU_WEB_APP';
```

Guardá el archivo y abrilo en el navegador (doble clic, o subilo a GitHub
Pages / cualquier hosting estático). El mapa va a cargar los datos
automáticamente desde tu Sheet.

## 6. Importar talleres desde un CSV (scraping de Google Maps)

`importar_talleres.py` toma un CSV exportado de una herramienta de scraping
de Google Maps y sube al Sheet solo los registros que todavía no están
cargados (compara por nombre + dirección).

### 6.1 Crear una cuenta de servicio de Google (una sola vez)

1. Entrá a la [Google Cloud Console](https://console.cloud.google.com/) y creá un proyecto nuevo (o usá uno existente).
2. **APIs y servicios > Biblioteca** → buscá "Google Sheets API" → **Habilitar**.
3. **APIs y servicios > Credenciales** → **Crear credenciales > Cuenta de servicio**.
4. Ponele un nombre cualquiera (ej. "mapa-talleres") y hacé clic en **Listo** (no necesita roles a nivel de proyecto).
5. En la lista de cuentas de servicio, entrá a la que creaste → pestaña **Claves** → **Agregar clave > Crear clave nueva > JSON**. Se descarga un archivo `.json`.
6. Guardá ese archivo como `mapa-talleres/credenciales.json`. **No lo subas a git** (ya está en `.gitignore`).
7. Abrí ese JSON y copiá el valor de `client_email` (algo como `mapa-talleres@tu-proyecto.iam.gserviceaccount.com`).
8. Abrí tu Google Sheet real → botón **Compartir** → pegá ese email → dale rol de **Editor** → **Enviar**.

Sin este paso 8 el script no va a poder escribir en la hoja, aunque las
credenciales sean correctas.

### 6.2 Instalar dependencias

```bash
pip install -r mapa-talleres/requirements.txt
```

### 6.3 Correr el script

```bash
python mapa-talleres/importar_talleres.py --csv nuevos_talleres.csv --sheet-id TU_SHEET_ID
```

- `--sheet-id`: podés pegar el ID pelado o la URL completa del Sheet, cualquiera de las dos funciona.
- `--worksheet`: nombre de la pestaña (default `"Hoja 1"`, igual que `NOMBRE_HOJA` en `Code.gs`).
- `--credenciales`: ruta al JSON del paso 6.1 (default `credenciales.json`, buscado en el directorio donde corrés el comando).

El script:
- Detecta las columnas del CSV aunque se llamen distinto (`name`/`nombre`, `address`/`direccion`, `phone`/`telefono`, `lat`/`latitud`, `lng`/`longitud`, etc.).
- Infiere `zona` (CABA/GBA/Interior) y `provincia` buscando esos nombres en el texto de la dirección; si no reconoce nada, las deja vacías para completar a mano.
- Carga `estado_contacto` como `"Sin contactar"` y deja `fecha_ultimo_contacto`/`notas` vacías para todo registro nuevo.
- Descarta cualquier fila cuyo nombre + dirección (normalizados, sin tildes ni mayúsculas) ya exista en el Sheet.
- Al final imprime un resumen: leídos, nuevos agregados, duplicados descartados, y cuántos quedaron sin zona/provincia para revisar a mano.

Si el CSV no trae latitud/longitud, dejalas vacías: correr después
**Mapa Talleres > Geocodificar direcciones faltantes** desde el Sheet (paso 4) las completa automáticamente.

## 7. Segundo mapa independiente (minería / petróleo)

`mapa-mineria.html` es una copia de `mapa.html` pensada para el segmento de
maquinaria pesada y camiones de apoyo en minería y petroleras (Jujuy, Salta,
Catamarca, Tucumán, Neuquén, Río Negro, Mendoza, Chubut, Santa Cruz). Filtra
por `provincia` en vez de por `zona` (CABA/GBA/Interior no aplica a este
segmento).

Para que **no se crucen los datos** con el mapa de talleres, hay que repetir
los pasos 1 a 3 de este README **desde cero, con un Google Sheet nuevo y una
implementación de Apps Script nueva**:

1. Creá un Google Sheet distinto (mismas columnas de la sección 1).
2. Pegá el mismo `Code.gs` en su propio editor de Apps Script (cambiá
   `NOMBRE_HOJA` si tu pestaña no se llama `Hoja 1`).
3. Publicá una Web App nueva (pasos 3 del README) y copiá su URL.
4. Pegala en `mapa-mineria.html`, reemplazando:
   ```js
   var URL_WEB_APP = 'PEGAR_AQUI_LA_URL_DEL_WEB_APP_DE_MINERIA_PETROLEO';
   ```

Los dos mapas quedan accesibles desde el panel de administración del
catálogo (`admin.html`), cada uno como un link que abre su propio archivo en
una pestaña nueva.

## Notas

- Nominatim es gratuito pero pide **máximo 1 solicitud por segundo** y un
  `User-Agent` identificable — el script ya respeta esto con `Utilities.sleep(1100)`.
  Si tenés cientos de filas para geocodificar, la primera corrida puede tardar
  varios minutos; es normal.
- El mapa nunca geocodifica nada solo — la geocodificación corre únicamente
  cuando vos la disparás desde el menú del Sheet o la URL `?action=geocodificar`,
  para no demorar la carga del mapa ni golpear a Nominatim en cada visita.
- Si en el futuro agregás más estados de contacto (por ejemplo "no interesado"),
  sumá su color en `COLOR_POR_ESTADO` dentro de `mapa.html`.
