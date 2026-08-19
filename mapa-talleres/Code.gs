/**
 * Backend de Google Apps Script para el mapa interactivo de casas de
 * repuestos y talleres. Este script debe pegarse en el editor de Apps
 * Script vinculado a tu Google Sheet (Extensiones > Apps Script).
 *
 * La hoja debe tener estas columnas, en este orden, en la fila 1:
 * nombre | direccion | latitud | longitud | telefono | zona | provincia |
 * estado_contacto | fecha_ultimo_contacto | notas
 *
 * Ver README.md en esta misma carpeta para instrucciones de despliegue.
 */

var NOMBRE_HOJA = 'Hoja 1'; // Cambiar si tu hoja tiene otro nombre
var NOMBRE_HOJA_IMPORTAR = 'Importar'; // Pestaña donde pegás/importás el CSV del scraper
var NOMBRE_HOJA_HISTORIAL = 'Historial de Búsquedas';
var NOMBRE_HOJA_COBERTURA = 'Cobertura de Zonas';
var NOMBRE_HOJA_WHATSAPP = 'WhatsApp por Zona';

// Barrios de CABA agrupados por comuna (conocimiento general, no
// verificado contra una fuente oficial — sirve para sugerir zonas
// vecinas a una "caliente", no es un dato jurídico/administrativo).
var COMUNAS_CABA = {
  'Comuna 1': ['Retiro', 'San Nicolás', 'Puerto Madero', 'San Telmo', 'Monserrat', 'Constitución'],
  'Comuna 2': ['Recoleta'],
  'Comuna 3': ['Balvanera', 'San Cristóbal'],
  'Comuna 4': ['La Boca', 'Barracas', 'Parque Patricios', 'Nueva Pompeya'],
  'Comuna 5': ['Almagro', 'Boedo'],
  'Comuna 6': ['Caballito'],
  'Comuna 7': ['Flores', 'Parque Chacabuco'],
  'Comuna 8': ['Villa Soldati', 'Villa Riachuelo', 'Villa Lugano'],
  'Comuna 9': ['Liniers', 'Mataderos', 'Parque Avellaneda'],
  'Comuna 10': ['Villa Real', 'Monte Castro', 'Versalles', 'Floresta', 'Vélez Sarsfield', 'Villa Luro'],
  'Comuna 11': ['Villa Devoto', 'Villa del Parque', 'Villa Santa Rita', 'Villa General Mitre'],
  'Comuna 12': ['Coghlan', 'Saavedra', 'Villa Urquiza', 'Villa Pueyrredón'],
  'Comuna 13': ['Belgrano', 'Núñez', 'Colegiales'],
  'Comuna 14': ['Palermo'],
  'Comuna 15': ['Chacarita', 'Villa Crespo', 'La Paternal', 'Villa Ortúzar', 'Agronomía', 'Parque Chas']
};

// ============================================================
// Pegá acá tu API key de SerpApi (serpapi.com > tu panel > API Key).
// No la compartas ni la subas a ningún repositorio público.
// ============================================================
var SERPAPI_API_KEY = 'PEGAR_AQUI_TU_API_KEY_DE_SERPAPI';

// Palabras que confirman que un sitio web es del rubro (autos/camiones)
var PALABRAS_RUBRO = [
  'repuesto', 'repuestos', 'autopartes', 'auto partes', 'recambio', 'recambios',
  'autoparts', 'auto parts', 'taller mecanico', 'taller', 'mecanica', 'mecanico',
  'lubricentro', 'accesorios para auto', 'accesorios automotor', 'camion', 'camiones'
];
// Palabras que sugieren que el negocio es de motos (fuera de nuestro catálogo)
var PALABRAS_MOTO = ['moto', 'motos', 'motocicleta', 'motocicletas', 'ciclomotor'];
// Palabras que confirman que sí trabaja autos/camiones (para no descartar sitios mixtos moto+auto)
var PALABRAS_AUTO_CAMION = ['auto', 'autos', 'automotor', 'vehiculo', 'vehiculos', 'camioneta', 'camion', 'camiones', 'coche', 'coches'];
var COLUMNAS = [
  'nombre',
  'direccion',
  'latitud',
  'longitud',
  'telefono',
  'zona',
  'provincia',
  'estado_contacto',
  'fecha_ultimo_contacto',
  'notas'
];

// Nombres alternativos que puede traer el CSV del scraper para cada campo
var CANDIDATOS_CSV = {
  nombre: ['nombre', 'name', 'business name', 'nombre del negocio', 'title', 'nombre_negocio'],
  direccion: ['direccion', 'direccion completa', 'address', 'full address', 'full_address'],
  telefono: ['telefono', 'phone', 'phone number', 'phone_number'],
  latitud: ['latitud', 'lat', 'latitude'],
  longitud: ['longitud', 'lng', 'lon', 'long', 'longitude'],
  sitioWeb: ['sitio web', 'website', 'web', 'url']
};

var GBA_PARTIDOS = [
  'Almirante Brown', 'Avellaneda', 'Berazategui', 'Esteban Echeverria', 'Ezeiza',
  'Florencio Varela', 'General San Martin', 'Hurlingham', 'Ituzaingo', 'Jose C Paz',
  'La Matanza', 'Lanus', 'Lomas de Zamora', 'Malvinas Argentinas', 'Merlo', 'Moreno',
  'Moron', 'Presidente Peron', 'Quilmes', 'San Fernando', 'San Isidro', 'San Miguel',
  'San Vicente', 'Tigre', 'Tres de Febrero', 'Vicente Lopez'
];

// normalizado -> nombre "canónico" (con tildes) para escribir en la columna provincia
var PROVINCIAS_ARGENTINAS = {
  'buenos aires': 'Buenos Aires', 'catamarca': 'Catamarca', 'chaco': 'Chaco',
  'chubut': 'Chubut', 'cordoba': 'Córdoba', 'corrientes': 'Corrientes',
  'entre rios': 'Entre Ríos', 'formosa': 'Formosa', 'jujuy': 'Jujuy',
  'la pampa': 'La Pampa', 'la rioja': 'La Rioja', 'mendoza': 'Mendoza',
  'misiones': 'Misiones', 'neuquen': 'Neuquén', 'rio negro': 'Río Negro',
  'salta': 'Salta', 'san juan': 'San Juan', 'san luis': 'San Luis',
  'santa cruz': 'Santa Cruz', 'santa fe': 'Santa Fe',
  'santiago del estero': 'Santiago del Estero',
  'tierra del fuego': 'Tierra del Fuego', 'tucuman': 'Tucumán'
};

/**
 * Punto de entrada del Web App.
 * - Sin parámetros: devuelve el JSON con todos los lugares.
 * - ?action=geocodificar: geocodifica las filas sin latitud/longitud,
 *   guarda el resultado en la hoja y devuelve un resumen.
 * - ?action=buscar&query=texto: busca esa zona en SerpApi, verifica sitios
 *   web, deduplica e importa. Pensado para llamarse desde mapa.html.
 */
function doGet(e) {
  var accion = e && e.parameter && e.parameter.action;

  if (accion === 'geocodificar') {
    var resultado = geocodificarFaltantes();
    return responderJSON(resultado);
  }

  if (accion === 'buscar') {
    var consulta = e.parameter.query || '';
    if (!consulta.trim()) {
      return responderJSON({ ok: false, error: 'Falta el parámetro query.' });
    }
    try {
      var resumen = ejecutarBusquedaZona(consulta.trim());
      return responderJSON(Object.assign({ ok: true }, resumen));
    } catch (err) {
      return responderJSON({ ok: false, error: err.message });
    }
  }

  if (accion === 'actualizarEstado') {
    var nombreParam = e.parameter.nombre || '';
    var direccionParam = e.parameter.direccion || '';
    var estadoParam = e.parameter.estado || '';
    if (!nombreParam || !direccionParam || !estadoParam) {
      return responderJSON({ ok: false, error: 'Faltan parámetros (nombre, direccion, estado).' });
    }
    return responderJSON(actualizarEstadoContacto(nombreParam, direccionParam, estadoParam));
  }

  return responderJSON(obtenerDatos());
}

function responderJSON(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function obtenerHoja() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOMBRE_HOJA);
}

/**
 * Lee la hoja completa y la devuelve como un array de objetos JSON,
 * usando la fila 1 como encabezados (más flexible que asumir un orden
 * fijo de columnas si alguna vez reordenás la hoja).
 */
function obtenerDatos() {
  var hoja = obtenerHoja();
  var valores = hoja.getDataRange().getValues();
  var encabezados = valores[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });

  var lugares = [];
  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    if (fila.join('') === '') continue; // saltar filas vacías

    var lugar = {};
    for (var j = 0; j < encabezados.length; j++) {
      lugar[encabezados[j]] = fila[j];
    }

    // Normalizar lat/lng a número (o null si están vacíos)
    lugar.latitud = lugar.latitud === '' ? null : Number(lugar.latitud);
    lugar.longitud = lugar.longitud === '' ? null : Number(lugar.longitud);

    lugares.push(lugar);
  }

  return lugares;
}

/**
 * Recorre la hoja, geocodifica con Nominatim (OpenStreetMap) las filas
 * que no tienen latitud/longitud cargada, y escribe el resultado de
 * vuelta en la hoja para no tener que repetir la búsqueda la próxima vez.
 *
 * Nominatim pide máximo 1 solicitud por segundo y un User-Agent
 * identificable, por eso el Utilities.sleep(1100) entre filas.
 */
function geocodificarFaltantes() {
  var hoja = obtenerHoja();
  var valores = hoja.getDataRange().getValues();
  var encabezados = valores[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });

  var idxDireccion = encabezados.indexOf('direccion');
  var idxLat = encabezados.indexOf('latitud');
  var idxLng = encabezados.indexOf('longitud');
  var idxProvincia = encabezados.indexOf('provincia');
  var idxNombre = encabezados.indexOf('nombre');

  if (idxDireccion === -1 || idxLat === -1 || idxLng === -1) {
    return {
      ok: false,
      error: 'La hoja necesita columnas "direccion", "latitud" y "longitud".'
    };
  }

  var geocodificados = 0;
  var fallidos = [];

  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    var direccion = fila[idxDireccion];
    var latActual = fila[idxLat];
    var lngActual = fila[idxLng];

    if (!direccion) continue; // sin dirección no hay nada que geocodificar
    if (latActual !== '' && lngActual !== '' && latActual != null && lngActual != null) {
      continue; // ya tiene coordenadas, no gastamos otra consulta
    }

    var provincia = idxProvincia !== -1 ? fila[idxProvincia] : '';
    var consulta = [direccion, provincia, 'Argentina'].filter(String).join(', ');

    var coords = geocodificarDireccion(consulta);

    if (coords) {
      hoja.getRange(i + 1, idxLat + 1).setValue(coords.lat);
      hoja.getRange(i + 1, idxLng + 1).setValue(coords.lng);
      geocodificados++;
    } else {
      fallidos.push(idxNombre !== -1 ? fila[idxNombre] : direccion);
    }

    // Respetar el límite de 1 solicitud/segundo de Nominatim
    Utilities.sleep(1100);
  }

  return {
    ok: true,
    geocodificados: geocodificados,
    fallidos: fallidos
  };
}

/**
 * Consulta el servicio gratuito de geocoding de Nominatim (OpenStreetMap)
 * para una dirección de texto libre, limitado a Argentina.
 * Devuelve {lat, lng} o null si no encontró resultados.
 */
function geocodificarDireccion(direccionTexto) {
  var url = 'https://nominatim.openstreetmap.org/search'
    + '?format=json'
    + '&limit=1'
    + '&countrycodes=ar'
    + '&q=' + encodeURIComponent(direccionTexto);

  var opciones = {
    method: 'get',
    headers: {
      // Nominatim exige un User-Agent/Referer identificable para uso gratuito
      'User-Agent': 'CatalogoFebi-MapaTalleres/1.0 (contacto: reemplazar@tuemail.com)'
    },
    muteHttpExceptions: true
  };

  try {
    var respuesta = UrlFetchApp.fetch(url, opciones);
    if (respuesta.getResponseCode() !== 200) return null;

    var datos = JSON.parse(respuesta.getContentText());
    if (!datos || datos.length === 0) return null;

    return {
      lat: parseFloat(datos[0].lat),
      lng: parseFloat(datos[0].lon)
    };
  } catch (err) {
    return null;
  }
}

function normalizarTexto(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sacar acentos
    .replace(/\s+/g, ' ');
}

function encontrarColumna(encabezadosCSV, candidatos) {
  var normalizados = encabezadosCSV.map(normalizarTexto);
  for (var i = 0; i < candidatos.length; i++) {
    var idx = normalizados.indexOf(normalizarTexto(candidatos[i]));
    if (idx !== -1) return idx;
  }
  return -1;
}

function inferirZonaProvincia(direccion) {
  var norm = normalizarTexto(direccion);
  if (!norm) return { zona: '', provincia: '' };

  if (norm.indexOf('caba') !== -1 || norm.indexOf('capital federal') !== -1 ||
      norm.indexOf('autonoma de buenos aires') !== -1 || /\bc1\d{3}\b/.test(norm)) {
    // Cubre "Ciudad Autónoma de Buenos Aires" y la abreviatura "Cdad. Autónoma..."
    // que usa Google Maps, además de códigos postales C1xxx (propios de CABA).
    return { zona: 'CABA', provincia: 'CABA' };
  }

  for (var i = 0; i < GBA_PARTIDOS.length; i++) {
    if (norm.indexOf(normalizarTexto(GBA_PARTIDOS[i])) !== -1) {
      return { zona: 'GBA', provincia: 'Buenos Aires' };
    }
  }

  for (var provNorm in PROVINCIAS_ARGENTINAS) {
    if (norm.indexOf(provNorm) !== -1) {
      return { zona: 'Interior', provincia: PROVINCIAS_ARGENTINAS[provNorm] };
    }
  }

  return { zona: '', provincia: '' };
}

function claveDuplicado(nombre, direccion) {
  return normalizarTexto(nombre) + '|' + normalizarTexto(direccion);
}

/**
 * Busca una fila por nombre+dirección (misma clave que usamos para
 * deduplicar) y le actualiza estado_contacto, dejando fecha_ultimo_contacto
 * en la fecha de hoy. Pensado para llamarse desde el popup del mapa.
 */
function actualizarEstadoContacto(nombre, direccion, nuevoEstado) {
  var hoja = obtenerHoja();
  var valores = hoja.getDataRange().getValues();
  var encabezados = valores[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });

  var idxNombre = encabezados.indexOf('nombre');
  var idxDireccion = encabezados.indexOf('direccion');
  var idxEstado = encabezados.indexOf('estado_contacto');
  var idxFecha = encabezados.indexOf('fecha_ultimo_contacto');

  if (idxNombre === -1 || idxDireccion === -1 || idxEstado === -1) {
    return { ok: false, error: 'A la hoja le faltan columnas nombre/direccion/estado_contacto.' };
  }

  var claveBuscada = claveDuplicado(nombre, direccion);

  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    if (claveDuplicado(fila[idxNombre], fila[idxDireccion]) === claveBuscada) {
      hoja.getRange(i + 1, idxEstado + 1).setValue(nuevoEstado);
      if (idxFecha !== -1) {
        var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        hoja.getRange(i + 1, idxFecha + 1).setValue(hoy);
      }
      return { ok: true, nombre: nombre, estado: nuevoEstado };
    }
  }

  return { ok: false, error: 'No encontré ese lugar en la hoja (nombre + dirección no coinciden con ningún registro).' };
}

/**
 * Convierte un teléfono en el formato que necesita un link wa.me
 * (54 9 + código de área + número, todo junto, sin separadores).
 *
 * Es una heurística, no una certeza: asume que el número es de celular.
 * Los teléfonos fijos (comunes en talleres) no tienen WhatsApp y el link
 * generado no va a funcionar aunque el formato quede "correcto".
 */
function normalizarTelefonoWhatsApp(telefono) {
  if (!telefono) return '';
  var digitos = String(telefono).replace(/\D/g, '');
  if (!digitos) return '';

  if (digitos.indexOf('54') === 0) {
    digitos = digitos.substring(2);
  }
  digitos = digitos.replace(/^0/, '');  // 0 de larga distancia nacional
  digitos = digitos.replace(/^15/, ''); // 15 de celular (formato local, no hace falta en wa.me)

  if (digitos.indexOf('9') !== 0) {
    digitos = '9' + digitos;
  }

  return '54' + digitos;
}

/**
 * Genera (o refresca) una pestaña con un link de WhatsApp por cada lugar
 * cargado, agrupados y ordenados por zona + provincia, para desplegar y
 * mandar los mensajes a mano vos mismo.
 */
function generarListadoWhatsApp() {
  var ui = SpreadsheetApp.getUi();
  var hojaPrincipal = obtenerHoja();
  var valores = hojaPrincipal.getDataRange().getValues();
  var encabezados = valores[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });

  var idxNombre = encabezados.indexOf('nombre');
  var idxTelefono = encabezados.indexOf('telefono');
  var idxZona = encabezados.indexOf('zona');
  var idxProvincia = encabezados.indexOf('provincia');
  var idxDireccion = encabezados.indexOf('direccion');
  var idxEstado = encabezados.indexOf('estado_contacto');

  var filas = [];
  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    if (fila.join('') === '') continue;

    var telefonoWa = normalizarTelefonoWhatsApp(fila[idxTelefono]);

    filas.push({
      zona: idxZona !== -1 ? (fila[idxZona] || 'Sin definir') : 'Sin definir',
      provincia: idxProvincia !== -1 ? (fila[idxProvincia] || '') : '',
      nombre: fila[idxNombre] || '',
      telefono: idxTelefono !== -1 ? (fila[idxTelefono] || '') : '',
      telefonoWa: telefonoWa,
      direccion: idxDireccion !== -1 ? (fila[idxDireccion] || '') : '',
      estado: idxEstado !== -1 ? (fila[idxEstado] || '') : ''
    });
  }

  filas.sort(function (a, b) {
    var zonaCmp = (a.zona + a.provincia).localeCompare(b.zona + b.provincia);
    return zonaCmp !== 0 ? zonaCmp : a.nombre.localeCompare(b.nombre);
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hojaWa = ss.getSheetByName(NOMBRE_HOJA_WHATSAPP);
  if (hojaWa) {
    hojaWa.clear();
  } else {
    hojaWa = ss.insertSheet(NOMBRE_HOJA_WHATSAPP);
  }

  hojaWa.getRange(1, 1, 1, 7).setValues([[
    'Zona', 'Provincia', 'Nombre', 'Teléfono', 'WhatsApp', 'Dirección', 'Estado'
  ]]);
  hojaWa.getRange(1, 1, 1, 7).setFontWeight('bold');

  var sinTelefono = 0;
  var filasSalida = filas.map(function (f) {
    if (!f.telefonoWa) {
      sinTelefono++;
      return [f.zona, f.provincia, f.nombre, f.telefono, '(sin teléfono)', f.direccion, f.estado];
    }
    var link = 'https://wa.me/' + f.telefonoWa;
    return [
      f.zona, f.provincia, f.nombre, f.telefono,
      '=HYPERLINK("' + link + '"; "Abrir WhatsApp")',
      f.direccion, f.estado
    ];
  });

  if (filasSalida.length > 0) {
    hojaWa.getRange(2, 1, filasSalida.length, 7).setValues(filasSalida);
  }
  hojaWa.autoResizeColumns(1, 7);

  ui.alert(
    'Listado generado en la pestaña "' + NOMBRE_HOJA_WHATSAPP + '".\n\n' +
    'Total: ' + filas.length + '\n' +
    'Sin teléfono cargado: ' + sinTelefono + '\n\n' +
    'Recordá: los links asumen que el número es de celular. Los fijos no van a abrir WhatsApp.'
  );
}

/**
 * Convierte un valor de celda (puede venir como número real o como texto
 * con coma o punto decimal) a un número JS real. Devolver un número (no
 * texto) es clave: si se pasa un string a setValues(), Sheets lo
 * reinterpreta según la configuración regional de la hoja y puede correr
 * el punto decimal (ver bug del 2026-07-29). Un número real no sufre esa
 * reinterpretación.
 */
function parsearCoordenada(valor) {
  if (valor === '' || valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return valor;
  var texto = String(valor).trim().replace(',', '.');
  var numero = parseFloat(texto);
  return isNaN(numero) ? '' : numero;
}

/**
 * Lee la pestaña "Importar" (CSV pegado ahí con Archivo > Importar),
 * detecta sus columnas aunque tengan nombres distintos, infiere
 * zona/provincia, descarta duplicados contra la hoja principal, y sube
 * solo los registros nuevos. Al terminar, limpia la pestaña "Importar"
 * para que quede lista para la próxima carga.
 */
function importarDesdeHojaStaging() {
  var ui = SpreadsheetApp.getUi();
  var hojaStaging = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOMBRE_HOJA_IMPORTAR);

  if (!hojaStaging) {
    ui.alert(
      'No encontré una pestaña llamada "' + NOMBRE_HOJA_IMPORTAR + '". ' +
      'Creala primero (Archivo > Importar > Subir tu CSV > "Insertar nueva hoja") ' +
      'y ponele ese nombre exacto.'
    );
    return;
  }

  var valoresStaging = hojaStaging.getDataRange().getValues();
  if (valoresStaging.length < 2) {
    ui.alert('La pestaña "' + NOMBRE_HOJA_IMPORTAR + '" no tiene filas de datos para importar.');
    return;
  }

  var encabezadosCSV = valoresStaging[0].map(String);
  var idxNombre = encontrarColumna(encabezadosCSV, CANDIDATOS_CSV.nombre);
  var idxDireccion = encontrarColumna(encabezadosCSV, CANDIDATOS_CSV.direccion);

  if (idxNombre === -1 || idxDireccion === -1) {
    ui.alert(
      'El CSV necesita al menos una columna de nombre y una de dirección. ' +
      'Encabezados encontrados: ' + encabezadosCSV.join(', ')
    );
    return;
  }

  var idxTelefono = encontrarColumna(encabezadosCSV, CANDIDATOS_CSV.telefono);
  var idxLat = encontrarColumna(encabezadosCSV, CANDIDATOS_CSV.latitud);
  var idxLng = encontrarColumna(encabezadosCSV, CANDIDATOS_CSV.longitud);
  var idxWeb = encontrarColumna(encabezadosCSV, CANDIDATOS_CSV.sitioWeb);

  // ---- Leer la hoja principal para armar columnas y set de duplicados ----
  var hojaPrincipal = obtenerHoja();
  var valoresPrincipal = hojaPrincipal.getDataRange().getValues();
  var encabezadosPrincipal = valoresPrincipal[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });

  var faltantes = COLUMNAS.filter(function (c) { return encabezadosPrincipal.indexOf(c) === -1; });
  if (faltantes.length > 0) {
    ui.alert('A la hoja principal le faltan estas columnas en la fila 1: ' + faltantes.join(', '));
    return;
  }

  var idxNombrePrincipal = encabezadosPrincipal.indexOf('nombre');
  var idxDireccionPrincipal = encabezadosPrincipal.indexOf('direccion');

  var clavesExistentes = {};
  for (var f = 1; f < valoresPrincipal.length; f++) {
    var filaP = valoresPrincipal[f];
    if (filaP.join('') === '') continue;
    clavesExistentes[claveDuplicado(filaP[idxNombrePrincipal], filaP[idxDireccionPrincipal])] = true;
  }

  // ---- Procesar filas del CSV ----
  var nuevasFilas = [];
  var duplicados = 0;
  var sinZona = 0;

  for (var i = 1; i < valoresStaging.length; i++) {
    var filaCSV = valoresStaging[i];
    var nombre = String(filaCSV[idxNombre] || '').trim();
    var direccion = String(filaCSV[idxDireccion] || '').trim();
    if (!nombre && !direccion) continue; // fila vacía

    var clave = claveDuplicado(nombre, direccion);
    if (clavesExistentes[clave]) {
      duplicados++;
      continue;
    }
    clavesExistentes[clave] = true; // evita duplicados internos del propio CSV

    var zonaProvincia = inferirZonaProvincia(direccion);
    if (!zonaProvincia.zona) sinZona++;

    var registro = {
      nombre: nombre,
      direccion: direccion,
      latitud: idxLat !== -1 ? parsearCoordenada(filaCSV[idxLat]) : '',
      longitud: idxLng !== -1 ? parsearCoordenada(filaCSV[idxLng]) : '',
      telefono: idxTelefono !== -1 ? String(filaCSV[idxTelefono] || '').trim() : '',
      zona: zonaProvincia.zona,
      provincia: zonaProvincia.provincia,
      estado_contacto: 'Sin contactar',
      fecha_ultimo_contacto: '',
      notas: ''
    };

    // Respeta el orden real de columnas de la hoja principal
    nuevasFilas.push(encabezadosPrincipal.map(function (col) { return registro[col] !== undefined ? registro[col] : ''; }));
  }

  if (nuevasFilas.length > 0) {
    hojaPrincipal.getRange(hojaPrincipal.getLastRow() + 1, 1, nuevasFilas.length, encabezadosPrincipal.length)
      .setValues(nuevasFilas);
  }

  // Limpiar la pestaña de staging para la próxima carga (deja los encabezados)
  if (hojaStaging.getLastRow() > 1) {
    hojaStaging.getRange(2, 1, hojaStaging.getLastRow() - 1, hojaStaging.getLastColumn()).clearContent();
  }

  var mensaje = 'Leídos en el CSV: ' + (valoresStaging.length - 1) + '\n' +
    'Nuevos agregados: ' + nuevasFilas.length + '\n' +
    'Duplicados descartados: ' + duplicados;
  if (sinZona > 0) {
    mensaje += '\nSin zona/provincia inferida (completar a mano): ' + sinZona;
  }
  if (idxWeb !== -1) {
    mensaje += '\n\nNota: el CSV traía una columna de sitio web que no se importó (la hoja no tiene esa columna).';
  }

  ui.alert(mensaje);
}

// Máximo de páginas de SerpApi a pedir por búsqueda (20 resultados c/u).
// 3 páginas = hasta 60 resultados, a costa de 3 búsquedas de tu cuota
// mensual en vez de 1. Subilo si necesitás cubrir zonas muy densas.
var SERPAPI_MAX_PAGINAS = 3;

/**
 * Calcula el punto central (promedio) de las coordenadas de un grupo de
 * resultados crudos de SerpApi. Se usa para anclar las páginas 2+ de una
 * búsqueda, en vez de geocodificar el texto de la consulta (que mezcla
 * rubro + zona y Nominatim no siempre puede ubicar).
 */
function calcularCentroide(resultadosCrudos) {
  var puntos = resultadosCrudos
    .filter(function (r) { return r.gps_coordinates; })
    .map(function (r) { return r.gps_coordinates; });

  if (puntos.length === 0) return null;

  var sumaLat = puntos.reduce(function (acc, p) { return acc + p.latitude; }, 0);
  var sumaLng = puntos.reduce(function (acc, p) { return acc + p.longitude; }, 0);

  return {
    lat: sumaLat / puntos.length,
    lng: sumaLng / puntos.length
  };
}

/**
 * Llama a la API de Google Maps de SerpApi para una consulta de texto
 * (ej. "casas de repuestos en Warnes, CABA, Argentina") y devuelve un
 * array de resultados ya mapeados a nuestros campos.
 *
 * Pagina automáticamente si una página viene completa (20/20, señal de
 * que probablemente hay más) hasta SERPAPI_MAX_PAGINAS. Para paginar de
 * forma confiable, SerpApi pide coordenadas (ll) además del texto —
 * en vez de geocodificar la consulta, usamos el centro de los propios
 * resultados de la página 1 como ancla.
 */
function buscarEnSerpApi(consulta) {
  if (!SERPAPI_API_KEY) {
    throw new Error('Falta configurar SERPAPI_API_KEY al principio del script.');
  }

  var todosLosResultados = [];
  var centro = null;

  for (var pagina = 0; pagina < SERPAPI_MAX_PAGINAS; pagina++) {
    var url = 'https://serpapi.com/search.json'
      + '?engine=google_maps'
      + '&type=search'
      + '&q=' + encodeURIComponent(consulta)
      + '&hl=es'
      + '&google_domain=google.com'
      + '&api_key=' + encodeURIComponent(SERPAPI_API_KEY);

    if (pagina > 0 && centro) {
      url += '&ll=@' + centro.lat + ',' + centro.lng + ',14z';
      url += '&start=' + (pagina * 20);
    }

    var respuesta = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var codigo = respuesta.getResponseCode();
    var datos = JSON.parse(respuesta.getContentText());

    if (codigo !== 200) {
      if (pagina === 0) {
        throw new Error('SerpApi devolvió un error (' + codigo + '): ' + (datos.error || respuesta.getContentText()));
      }
      break; // si falla una página siguiente, nos quedamos con lo ya obtenido
    }

    var resultadosPagina = datos.local_results || [];
    todosLosResultados = todosLosResultados.concat(resultadosPagina);

    if (pagina === 0) {
      centro = calcularCentroide(resultadosPagina);
      if (!centro) break; // sin coordenadas no podemos anclar páginas siguientes
    }

    if (resultadosPagina.length < 20) break; // esta página vino incompleta, no hay más
  }

  return todosLosResultados.map(function (r) {
    return {
      nombre: r.title || '',
      direccion: r.address || '',
      telefono: r.phone || '',
      sitioWeb: r.website || '',
      latitud: (r.gps_coordinates && r.gps_coordinates.latitude) || '',
      longitud: (r.gps_coordinates && r.gps_coordinates.longitude) || ''
    };
  });
}

/**
 * Entra a un sitio web y clasifica si confirma que el negocio es del
 * rubro (autos/camiones). Devuelve un texto para la columna "notas".
 */
function verificarSitioWeb(url) {
  if (!url) return 'Revisar: sin sitio web';

  try {
    var respuesta = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: false
    });
    if (respuesta.getResponseCode() >= 400) {
      return 'Revisar: no se pudo abrir el sitio web';
    }

    var norm = normalizarTexto(respuesta.getContentText());
    var tieneRubro = PALABRAS_RUBRO.some(function (p) { return norm.indexOf(normalizarTexto(p)) !== -1; });
    var tieneMoto = PALABRAS_MOTO.some(function (p) { return norm.indexOf(normalizarTexto(p)) !== -1; });
    var tieneAutoCamion = PALABRAS_AUTO_CAMION.some(function (p) { return norm.indexOf(normalizarTexto(p)) !== -1; });

    if (tieneMoto && !tieneAutoCamion) return 'Revisar: el sitio parece ser de motos';
    if (tieneRubro) return 'Verificado: sitio web confirma rubro';
    return 'Revisar: sitio web no confirma rubro';
  } catch (err) {
    return 'Revisar: error al verificar el sitio web';
  }
}

/**
 * Núcleo reutilizable: busca una zona en SerpApi, verifica el sitio web
 * de cada resultado, descarta duplicados contra la hoja principal, e
 * importa los nuevos con zona/provincia inferida. Lo usan tanto el menú
 * del Sheet (buscarYCargarZona) como el endpoint web (?action=buscar),
 * para no duplicar la lógica.
 */
function ejecutarBusquedaZona(consulta) {
  var resultados = buscarEnSerpApi(consulta);

  if (resultados.length === 0) {
    var resumenVacio = {
      consulta: consulta,
      encontrados: 0,
      nuevos: 0,
      duplicados: 0,
      verificados: 0,
      paraRevisar: 0,
      sinZona: 0
    };
    registrarHistorialBusqueda(resumenVacio);
    return resumenVacio;
  }

  var hojaPrincipal = obtenerHoja();
  var valoresPrincipal = hojaPrincipal.getDataRange().getValues();
  var encabezadosPrincipal = valoresPrincipal[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });

  var faltantes = COLUMNAS.filter(function (c) { return encabezadosPrincipal.indexOf(c) === -1; });
  if (faltantes.length > 0) {
    throw new Error('A la hoja principal le faltan estas columnas en la fila 1: ' + faltantes.join(', '));
  }

  var idxNombrePrincipal = encabezadosPrincipal.indexOf('nombre');
  var idxDireccionPrincipal = encabezadosPrincipal.indexOf('direccion');

  var clavesExistentes = {};
  for (var f = 1; f < valoresPrincipal.length; f++) {
    var filaP = valoresPrincipal[f];
    if (filaP.join('') === '') continue;
    clavesExistentes[claveDuplicado(filaP[idxNombrePrincipal], filaP[idxDireccionPrincipal])] = true;
  }

  var nuevasFilas = [];
  var duplicados = 0;
  var sinZona = 0;
  var verificados = 0;
  var paraRevisar = 0;

  for (var i = 0; i < resultados.length; i++) {
    var r = resultados[i];
    if (!r.nombre && !r.direccion) continue;

    var clave = claveDuplicado(r.nombre, r.direccion);
    if (clavesExistentes[clave]) {
      duplicados++;
      continue;
    }
    clavesExistentes[clave] = true;

    var zonaProvincia = inferirZonaProvincia(r.direccion);
    if (!zonaProvincia.zona) sinZona++;

    var notaVerificacion = verificarSitioWeb(r.sitioWeb);
    if (notaVerificacion.indexOf('Verificado') === 0) {
      verificados++;
    } else {
      paraRevisar++;
    }
    // Agregamos la URL real al final de la nota (Sheets la muestra como
    // link clickeable solo, y el mapa también la linkifica en el popup).
    var notaConLink = notaVerificacion + (r.sitioWeb ? ' | ' + r.sitioWeb : '');

    var registro = {
      nombre: r.nombre,
      direccion: r.direccion,
      latitud: parsearCoordenada(r.latitud),
      longitud: parsearCoordenada(r.longitud),
      telefono: r.telefono,
      zona: zonaProvincia.zona,
      provincia: zonaProvincia.provincia,
      estado_contacto: 'Sin contactar',
      fecha_ultimo_contacto: '',
      notas: notaConLink
    };

    nuevasFilas.push(encabezadosPrincipal.map(function (col) { return registro[col] !== undefined ? registro[col] : ''; }));
  }

  if (nuevasFilas.length > 0) {
    hojaPrincipal.getRange(hojaPrincipal.getLastRow() + 1, 1, nuevasFilas.length, encabezadosPrincipal.length)
      .setValues(nuevasFilas);
  }

  var resumen = {
    consulta: consulta,
    encontrados: resultados.length,
    nuevos: nuevasFilas.length,
    duplicados: duplicados,
    verificados: verificados,
    paraRevisar: paraRevisar,
    sinZona: sinZona
  };
  registrarHistorialBusqueda(resumen);
  return resumen;
}

/**
 * Agrega una fila a la pestaña "Historial de Búsquedas" (la crea con
 * encabezados si todavía no existe). Se llama automáticamente al final
 * de cada búsqueda, sin que el usuario tenga que hacer nada.
 */
function registrarHistorialBusqueda(resumen) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOMBRE_HOJA_HISTORIAL);
  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_HISTORIAL);
    hoja.getRange(1, 1, 1, 6).setValues([[
      'Fecha', 'Consulta', 'Encontrados', 'Nuevos', 'Duplicados', 'Para revisar'
    ]]);
    hoja.getRange(1, 1, 1, 6).setFontWeight('bold');
  }

  var hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  hoja.appendRow([
    hoy, resumen.consulta, resumen.encontrados, resumen.nuevos, resumen.duplicados, resumen.paraRevisar
  ]);
}

/**
 * Lee toda la pestaña de historial y devuelve, por cada nombre de zona
 * (barrio/partido), cuántas veces se buscó y cuántos "nuevos" sumó en
 * total — comparando el texto de cada consulta contra el nombre de la
 * zona (normalizado, sin tildes/mayúsculas).
 */
function calcularEstadisticasHistorial() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOMBRE_HOJA_HISTORIAL);
  var stats = {}; // nombreZonaNormalizado -> { buscada: bool, nuevos: number }

  if (!hoja) return stats;

  var valores = hoja.getDataRange().getValues();
  if (valores.length < 2) return stats;

  var encabezados = valores[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var idxConsulta = encabezados.indexOf('consulta');
  var idxNuevos = encabezados.indexOf('nuevos');

  var todosLosNombresZona = Object.keys(COMUNAS_CABA).reduce(function (acc, comuna) {
    return acc.concat(COMUNAS_CABA[comuna]);
  }, []).concat(GBA_PARTIDOS);

  for (var i = 1; i < valores.length; i++) {
    var consultaNorm = normalizarTexto(valores[i][idxConsulta]);
    var nuevos = Number(valores[i][idxNuevos]) || 0;

    todosLosNombresZona.forEach(function (nombreZona) {
      if (consultaNorm.indexOf(normalizarTexto(nombreZona)) !== -1) {
        var clave = normalizarTexto(nombreZona);
        if (!stats[clave]) stats[clave] = { buscada: true, nuevos: 0 };
        stats[clave].nuevos += nuevos;
      }
    });
  }

  return stats;
}

// A partir de cuántos "nuevos" acumulados una zona se considera "caliente"
// (candidata a tener zonas vecinas con más oferta sin buscar todavía).
var UMBRAL_ZONA_CALIENTE = 10;

/**
 * Genera (o refresca) la pestaña "Cobertura de Zonas": lista los barrios
 * de CABA (agrupados por comuna) y los partidos de GBA, marcando cuáles
 * ya se buscaron (según el historial) y sugiriendo vecinos sin buscar
 * cuando la zona ya buscada dio muchos resultados nuevos.
 */
function actualizarCoberturaZonas() {
  var ui = SpreadsheetApp.getUi();
  var stats = calcularEstadisticasHistorial();

  var filas = [];

  Object.keys(COMUNAS_CABA).forEach(function (comuna) {
    var barrios = COMUNAS_CABA[comuna];
    var barriosCalientesEnComuna = barrios.filter(function (b) {
      var s = stats[normalizarTexto(b)];
      return s && s.nuevos >= UMBRAL_ZONA_CALIENTE;
    });

    barrios.forEach(function (barrio) {
      var s = stats[normalizarTexto(barrio)];
      var buscada = !!s;
      var nuevos = s ? s.nuevos : 0;
      var sugerencia = '';

      if (!buscada && barriosCalientesEnComuna.length > 0) {
        sugerencia = 'Sugerido: misma comuna que ' + barriosCalientesEnComuna.join(', ') + ' (zona con mucha oferta)';
      }

      filas.push([
        'CABA', comuna, barrio,
        buscada ? 'Buscada' : 'Pendiente',
        nuevos, sugerencia
      ]);
    });
  });

  GBA_PARTIDOS.forEach(function (partido) {
    var s = stats[normalizarTexto(partido)];
    var buscada = !!s;
    var nuevos = s ? s.nuevos : 0;
    filas.push(['GBA', '', partido, buscada ? 'Buscada' : 'Pendiente', nuevos, '']);
  });

  // Zonas calientes primero, después pendientes con sugerencia, después el resto
  filas.sort(function (a, b) {
    var prioridadA = a[5] ? 0 : (a[4] >= UMBRAL_ZONA_CALIENTE ? 1 : 2);
    var prioridadB = b[5] ? 0 : (b[4] >= UMBRAL_ZONA_CALIENTE ? 1 : 2);
    if (prioridadA !== prioridadB) return prioridadA - prioridadB;
    return b[4] - a[4];
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(NOMBRE_HOJA_COBERTURA);
  if (hoja) {
    hoja.clear();
  } else {
    hoja = ss.insertSheet(NOMBRE_HOJA_COBERTURA);
  }

  hoja.getRange(1, 1, 1, 6).setValues([[
    'Región', 'Comuna', 'Zona', 'Estado', 'Nuevos encontrados', 'Sugerencia'
  ]]);
  hoja.getRange(1, 1, 1, 6).setFontWeight('bold');

  if (filas.length > 0) {
    hoja.getRange(2, 1, filas.length, 6).setValues(filas);
  }
  hoja.autoResizeColumns(1, 6);

  var pendientes = filas.filter(function (f) { return f[3] === 'Pendiente'; }).length;
  var sugeridas = filas.filter(function (f) { return f[5]; }).length;

  ui.alert(
    'Cobertura actualizada en la pestaña "' + NOMBRE_HOJA_COBERTURA + '".\n\n' +
    'Zonas pendientes: ' + pendientes + ' de ' + filas.length + '\n' +
    'Con sugerencia prioritaria (vecinas a zona caliente): ' + sugeridas
  );
}

/**
 * Versión de menú: pide la consulta con un cuadro de diálogo y muestra
 * el resumen con ui.alert. Para disparar la búsqueda desde mapa.html en
 * cambio, se usa el endpoint ?action=buscar.
 */
function buscarYCargarZona() {
  var ui = SpreadsheetApp.getUi();

  var respuestaPrompt = ui.prompt(
    'Buscar zona con SerpApi',
    'Escribí la búsqueda, igual que la escribirías en Google Maps.\n' +
    'Ej: casas de repuestos en Warnes, CABA, Argentina',
    ui.ButtonSet.OK_CANCEL
  );

  if (respuestaPrompt.getSelectedButton() !== ui.Button.OK) return;
  var consulta = respuestaPrompt.getResponseText().trim();
  if (!consulta) return;

  var resumen;
  try {
    resumen = ejecutarBusquedaZona(consulta);
  } catch (err) {
    ui.alert('Error al buscar en SerpApi: ' + err.message);
    return;
  }

  if (resumen.encontrados === 0) {
    ui.alert('SerpApi no encontró resultados para: ' + consulta);
    return;
  }

  var mensaje = 'Búsqueda: ' + resumen.consulta + '\n\n' +
    'Encontrados: ' + resumen.encontrados + '\n' +
    'Nuevos agregados: ' + resumen.nuevos + '\n' +
    'Duplicados descartados: ' + resumen.duplicados + '\n' +
    'Verificados (sitio web confirma rubro): ' + resumen.verificados + '\n' +
    'Para revisar a mano: ' + resumen.paraRevisar;
  if (resumen.sinZona > 0) {
    mensaje += '\nSin zona/provincia inferida: ' + resumen.sinZona;
  }

  ui.alert(mensaje);
}

/**
 * Agrega un menú a la hoja de cálculo para poder disparar el geocoding,
 * la importación de CSV, y la búsqueda automática por SerpApi, sin tener
 * que llamar a la URL del Web App a mano.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Mapa Talleres')
    .addItem('Buscar zona automáticamente (SerpApi)', 'buscarYCargarZona')
    .addItem('Importar desde hoja "' + NOMBRE_HOJA_IMPORTAR + '"', 'importarDesdeHojaStaging')
    .addItem('Geocodificar direcciones faltantes', 'geocodificarFaltantesConAviso')
    .addSeparator()
    .addItem('Generar listado de WhatsApp por zona', 'generarListadoWhatsApp')
    .addItem('Actualizar cobertura de zonas', 'actualizarCoberturaZonas')
    .addToUi();
}

function geocodificarFaltantesConAviso() {
  var resultado = geocodificarFaltantes();
  var ui = SpreadsheetApp.getUi();
  if (!resultado.ok) {
    ui.alert('Error: ' + resultado.error);
    return;
  }
  var mensaje = 'Geocodificadas: ' + resultado.geocodificados + ' direcciones.';
  if (resultado.fallidos.length > 0) {
    mensaje += '\n\nNo se pudieron geocodificar:\n' + resultado.fallidos.join('\n');
  }
  ui.alert(mensaje);
}
