"""
Importa talleres/casas de repuestos desde un CSV exportado de una
herramienta de scraping de Google Maps hacia el Google Sheet que alimenta
el mapa (ver mapa-talleres/mapa.html y Code.gs).

- Detecta las columnas del CSV aunque tengan nombres distintos según la
  herramienta usada (nombre, direccion, telefono, latitud, longitud, ...).
- Infiere "zona" (CABA/GBA/Interior) y "provincia" a partir del texto de
  la dirección, cuando es posible; si no, las deja vacías para completar
  a mano.
- Evita duplicados comparando contra lo que ya está en el Sheet, por
  nombre + dirección normalizados (sin tildes, mayúsculas ni espacios
  de más).
- Sube únicamente los registros nuevos, en un solo batch.

Uso:
    pip install -r requirements.txt
    python importar_talleres.py --csv nuevos_talleres.csv --sheet-id TU_SHEET_ID

Ver README.md, sección "Importar talleres desde un CSV" para cómo
generar credenciales.json (cuenta de servicio de Google).
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd
import gspread
from google.oauth2.service_account import Credentials


# Columnas exactas que espera el Sheet (deben coincidir con Code.gs)
COLUMNAS_SHEET = [
    'nombre', 'direccion', 'latitud', 'longitud', 'telefono',
    'zona', 'provincia', 'estado_contacto', 'fecha_ultimo_contacto', 'notas'
]

# Nombres alternativos que puede traer el CSV para cada campo, según la
# herramienta de scraping usada.
CANDIDATOS_CSV = {
    'nombre': ['nombre', 'name', 'business name', 'nombre del negocio', 'title', 'nombre_negocio'],
    'direccion': ['direccion', 'direccion completa', 'address', 'full address', 'full_address'],
    'telefono': ['telefono', 'phone', 'phone number', 'phone_number'],
    'latitud': ['latitud', 'lat', 'latitude'],
    'longitud': ['longitud', 'lng', 'lon', 'long', 'longitude'],
    'sitio_web': ['sitio web', 'website', 'web', 'url'],
}

GBA_PARTIDOS = [
    'Almirante Brown', 'Avellaneda', 'Berazategui', 'Esteban Echeverria', 'Ezeiza',
    'Florencio Varela', 'General San Martin', 'Hurlingham', 'Ituzaingo', 'Jose C Paz',
    'La Matanza', 'Lanus', 'Lomas de Zamora', 'Malvinas Argentinas', 'Merlo', 'Moreno',
    'Moron', 'Presidente Peron', 'Quilmes', 'San Fernando', 'San Isidro', 'San Miguel',
    'San Vicente', 'Tigre', 'Tres de Febrero', 'Vicente Lopez',
]

# normalizado -> nombre "canónico" (con tildes) para escribir en la columna provincia
PROVINCIAS_ARGENTINAS = {
    'buenos aires': 'Buenos Aires', 'catamarca': 'Catamarca', 'chaco': 'Chaco',
    'chubut': 'Chubut', 'cordoba': 'Córdoba', 'corrientes': 'Corrientes',
    'entre rios': 'Entre Ríos', 'formosa': 'Formosa', 'jujuy': 'Jujuy',
    'la pampa': 'La Pampa', 'la rioja': 'La Rioja', 'mendoza': 'Mendoza',
    'misiones': 'Misiones', 'neuquen': 'Neuquén', 'rio negro': 'Río Negro',
    'salta': 'Salta', 'san juan': 'San Juan', 'san luis': 'San Luis',
    'santa cruz': 'Santa Cruz', 'santa fe': 'Santa Fe',
    'santiago del estero': 'Santiago del Estero',
    'tierra del fuego': 'Tierra del Fuego', 'tucuman': 'Tucumán',
}


def normalizar_texto(texto):
    """minúsculas, sin tildes, sin espacios repetidos — para comparar."""
    if texto is None:
        return ''
    texto = str(texto).strip().lower()
    texto = unicodedata.normalize('NFKD', texto)
    texto = ''.join(c for c in texto if not unicodedata.combining(c))
    texto = re.sub(r'\s+', ' ', texto)
    return texto


def encontrar_columna(columnas_csv, candidatos):
    normalizadas = {normalizar_texto(c): c for c in columnas_csv}
    for candidato in candidatos:
        if normalizar_texto(candidato) in normalizadas:
            return normalizadas[normalizar_texto(candidato)]
    return None


def inferir_zona_provincia(direccion):
    norm = normalizar_texto(direccion)
    if not norm:
        return '', ''

    if 'caba' in norm or 'capital federal' in norm or 'ciudad autonoma de buenos aires' in norm:
        return 'CABA', 'CABA'

    for partido in GBA_PARTIDOS:
        if normalizar_texto(partido) in norm:
            return 'GBA', 'Buenos Aires'

    for prov_norm, prov_canon in PROVINCIAS_ARGENTINAS.items():
        if prov_norm in norm:
            return 'Interior', prov_canon

    return '', ''


def clave_duplicado(nombre, direccion):
    return normalizar_texto(nombre) + '|' + normalizar_texto(direccion)


def extraer_sheet_id(valor):
    """Acepta tanto un ID pelado como una URL completa del Sheet."""
    match = re.search(r'/d/([a-zA-Z0-9-_]+)', valor)
    return match.group(1) if match else valor


def cargar_csv(ruta_csv):
    if not Path(ruta_csv).exists():
        sys.exit(f'No se encontró el archivo CSV: {ruta_csv}')

    df = pd.read_csv(ruta_csv, dtype=str, keep_default_na=False)

    col_nombre = encontrar_columna(df.columns, CANDIDATOS_CSV['nombre'])
    col_direccion = encontrar_columna(df.columns, CANDIDATOS_CSV['direccion'])
    if not col_nombre or not col_direccion:
        sys.exit(
            'El CSV necesita al menos una columna de nombre y una de dirección. '
            f'Columnas encontradas: {list(df.columns)}'
        )

    col_telefono = encontrar_columna(df.columns, CANDIDATOS_CSV['telefono'])
    col_lat = encontrar_columna(df.columns, CANDIDATOS_CSV['latitud'])
    col_lng = encontrar_columna(df.columns, CANDIDATOS_CSV['longitud'])
    col_web = encontrar_columna(df.columns, CANDIDATOS_CSV['sitio_web'])

    registros = []
    for _, fila in df.iterrows():
        nombre = fila[col_nombre].strip()
        direccion = fila[col_direccion].strip()
        if not nombre and not direccion:
            continue  # fila vacía

        zona, provincia = inferir_zona_provincia(direccion)

        registros.append({
            'nombre': nombre,
            'direccion': direccion,
            'latitud': (fila[col_lat].strip().replace(',', '.') if col_lat else ''),
            'longitud': (fila[col_lng].strip().replace(',', '.') if col_lng else ''),
            'telefono': (fila[col_telefono].strip() if col_telefono else ''),
            'zona': zona,
            'provincia': provincia,
            'estado_contacto': 'Sin contactar',
            'fecha_ultimo_contacto': '',
            'notas': '',
        })

    tiene_sitio_web = col_web is not None
    return registros, tiene_sitio_web


def conectar_sheet(credenciales_json, sheet_id, nombre_hoja):
    scopes = ['https://www.googleapis.com/auth/spreadsheets']
    try:
        creds = Credentials.from_service_account_file(credenciales_json, scopes=scopes)
    except FileNotFoundError:
        sys.exit(
            f'No se encontró el archivo de credenciales: {credenciales_json}\n'
            'Ver README.md, sección "Importar talleres desde un CSV" para generarlo.'
        )

    cliente = gspread.authorize(creds)
    try:
        hoja_calculo = cliente.open_by_key(sheet_id)
    except gspread.exceptions.APIError as error:
        sys.exit(
            'No se pudo abrir el Google Sheet. Verificá que el --sheet-id sea correcto '
            'y que hayas compartido la hoja con el email de la cuenta de servicio '
            f'(client_email dentro de {credenciales_json}).\n\nDetalle: {error}'
        )

    try:
        return hoja_calculo.worksheet(nombre_hoja)
    except gspread.exceptions.WorksheetNotFound:
        sys.exit(f'La hoja "{nombre_hoja}" no existe en ese Google Sheet.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--csv', required=True, help='Ruta al CSV exportado de la herramienta de scraping')
    parser.add_argument('--sheet-id', required=True, help='ID del Google Sheet (o la URL completa)')
    parser.add_argument('--worksheet', default='Hoja 1', help='Nombre de la pestaña dentro del Sheet (default: "Hoja 1")')
    parser.add_argument('--credenciales', default='credenciales.json', help='Ruta al JSON de la cuenta de servicio')
    args = parser.parse_args()

    sheet_id = extraer_sheet_id(args.sheet_id)

    registros_csv, tiene_sitio_web = cargar_csv(args.csv)
    print(f'Leídos en el CSV: {len(registros_csv)}')

    hoja = conectar_sheet(args.credenciales, sheet_id, args.worksheet)

    valores_existentes = hoja.get_all_values()
    if not valores_existentes:
        sys.exit('El Sheet está vacío, necesita al menos la fila de encabezados.')

    encabezados = [h.strip().lower() for h in valores_existentes[0]]
    faltantes = [c for c in COLUMNAS_SHEET if c not in encabezados]
    if faltantes:
        sys.exit(f'Al Sheet le faltan estas columnas en la fila 1: {faltantes}')

    idx_nombre = encabezados.index('nombre')
    idx_direccion = encabezados.index('direccion')

    claves_existentes = set()
    for fila in valores_existentes[1:]:
        if len(fila) <= max(idx_nombre, idx_direccion):
            continue
        claves_existentes.add(clave_duplicado(fila[idx_nombre], fila[idx_direccion]))

    nuevas_filas = []
    sin_zona = 0
    duplicados = 0

    for registro in registros_csv:
        clave = clave_duplicado(registro['nombre'], registro['direccion'])
        if clave in claves_existentes:
            duplicados += 1
            continue

        claves_existentes.add(clave)  # también evita duplicados internos del propio CSV
        if not registro['zona']:
            sin_zona += 1

        # Respeta el orden real de columnas del Sheet (fila 1), no un orden fijo
        nuevas_filas.append([registro.get(col, '') for col in encabezados])

    if nuevas_filas:
        print(f'Subiendo {len(nuevas_filas)} registros nuevos...')
        # RAW evita que Sheets reinterprete los números según la configuración
        # regional de la hoja (con USER_ENTERED, "-34.6037" se lee como
        # -346037 en una hoja con configuración regional Argentina/Español).
        hoja.append_rows(nuevas_filas, value_input_option='RAW')

    print(f'Nuevos agregados: {len(nuevas_filas)}')
    print(f'Duplicados descartados: {duplicados}')
    if sin_zona:
        print(f'Sin zona/provincia inferida (completar a mano en el Sheet): {sin_zona}')
    if tiene_sitio_web:
        print('Nota: el CSV traía una columna de sitio web; no se importa porque el '
              'Sheet no tiene esa columna (se puede agregar a mano en "notas" si te sirve).')


if __name__ == '__main__':
    main()
