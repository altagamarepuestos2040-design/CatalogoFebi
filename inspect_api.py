"""
Intercepta requests de red en partsfinder para descubrir la API interna.
Ejecutar: python inspect_api.py
Resultado: api_requests.json con todos los endpoints encontrados
"""

import sys
import json
import time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

EMAIL = "fariasjc0@gmail.com"
PASSWORD = "Thomas2040"
ARTICLE_URL = "https://partsfinder.bilsteingroup.com/es/article/febi/06161"
LOGIN_URL = "https://partsfinder.bilsteingroup.com/es/search"

captured = []

def on_request(request):
    url = request.url
    # Solo nos interesan requests que no sean imágenes/css/js estáticos
    if any(ext in url for ext in ['.png', '.jpg', '.svg', '.css', '.woff', '.ico']):
        return
    if 'google' in url or 'analytics' in url or 'facebook' in url:
        return
    captured.append({
        "type": "request",
        "method": request.method,
        "url": url,
        "headers": dict(request.headers),
        "post_data": request.post_data,
    })

def on_response(response):
    url = response.url
    if any(ext in url for ext in ['.png', '.jpg', '.svg', '.css', '.woff', '.ico']):
        return
    if 'google' in url or 'analytics' in url or 'facebook' in url:
        return
    # Solo capturar respuestas JSON
    content_type = response.headers.get('content-type', '')
    if 'json' not in content_type and 'javascript' not in content_type:
        # igual guardar la URL para análisis
        pass
    captured.append({
        "type": "response",
        "status": response.status,
        "url": url,
        "content_type": content_type,
    })

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=300)
        context = browser.new_context()
        page = context.new_page()

        # Interceptar todos los requests y responses
        page.on("request", on_request)
        page.on("response", on_response)

        # ── LOGIN ──
        print(">> Abriendo login...")
        page.goto(LOGIN_URL, wait_until="networkidle")
        time.sleep(2)

        # Buscar campos de login
        # El sitio puede tener un botón/link para abrir el form de login
        try:
            login_btn = page.locator("text=Iniciar sesión").first
            login_btn.click()
            time.sleep(1)
        except:
            pass

        # Intentar llenar email y password
        try:
            page.fill("input[type='email']", EMAIL)
            page.fill("input[type='password']", PASSWORD)
            page.keyboard.press("Enter")
            page.wait_for_load_state("networkidle")
            print("OK Login enviado")
        except Exception as e:
            print(f"ERR Error en login: {e}")
            print("  Esperando 15s para login manual si es necesario...")
            time.sleep(15)

        time.sleep(2)

        # ── NAVEGAR AL ARTÍCULO ──
        print(f">> Navegando a {ARTICLE_URL}...")
        page.goto(ARTICLE_URL, wait_until="networkidle")
        time.sleep(3)

        # Limpiar capturas anteriores al login/navegación
        captured.clear()
        print("OK Capturas reseteadas, empezando a interceptar desde aquí")

        # ── PESTAÑA REFERENCIA ORIGINAL ──
        print(">> Buscando pestaña 'Referencia original'...")
        try:
            ref_tab = page.locator("text=Referencia original").first
            ref_tab.click()
            page.wait_for_load_state("networkidle")
            time.sleep(2)
            print("OK Pestaña OE clickeada")
        except Exception as e:
            print(f"ERR No encontré pestaña OE: {e}")

        # ── PESTAÑA VEHÍCULOS ──
        print(">> Buscando pestaña 'Vehículos en los que se emplea'...")
        try:
            veh_tab = page.locator("text=Vehículos en los que se emplea").first
            veh_tab.click()
            page.wait_for_load_state("networkidle")
            time.sleep(2)
            print("OK Pestaña vehículos clickeada")
        except Exception as e:
            print(f"ERR No encontré pestaña vehículos: {e}")

        # ── OBTENER LISTA DE MARCAS DEL DROPDOWN ──
        print(">> Intentando abrir el dropdown de marcas...")
        brands = []
        try:
            # Buscar el dropdown/select de marcas
            dropdown = page.locator("select, [role='listbox'], [role='combobox']").first
            dropdown.click()
            time.sleep(1)

            # Intentar obtener las opciones
            options = page.locator("option, [role='option']").all()
            for opt in options:
                txt = opt.inner_text().strip()
                if txt:
                    brands.append(txt)
            print(f"OK Marcas encontradas: {brands}")
        except Exception as e:
            print(f"ERR Error con dropdown: {e}")

        # Si no encontramos marcas con el método anterior, buscar de otra forma
        if not brands:
            print(">> Intentando detectar marcas por otro selector...")
            try:
                # Tomar screenshot para analizar
                page.screenshot(path="debug_brands.png")
                print("  Screenshot guardado: debug_brands.png")

                # Buscar elementos que contengan nombres de marca típicos
                all_text = page.locator("body").inner_text()
                if "Alfa Romeo" in all_text:
                    print("  'Alfa Romeo' encontrado en la página")
                if "BMW" in all_text:
                    print("  'BMW' encontrado en la página")
            except Exception as e2:
                print(f"ERR Error: {e2}")

        # ── SELECCIONAR PRIMERA MARCA Y GRABAR API ──
        print(">> Intentando seleccionar 'Alfa Romeo' del dropdown...")
        try:
            # Buscar por texto Alfa Romeo en el dropdown
            alfa = page.locator("text=Alfa Romeo").first
            alfa.click()
            page.wait_for_load_state("networkidle")
            time.sleep(2)
            print("OK Alfa Romeo seleccionado")
        except Exception as e:
            print(f"ERR Error seleccionando marca: {e}")

        # Expandir primer vehículo para ver qué request hace
        print(">> Intentando expandir el primer vehículo...")
        try:
            # Buscar botón de expandir (v, chevron, arrow)
            expand = page.locator("[class*='expand'], [class*='arrow'], [class*='toggle'], button").first
            expand.click()
            page.wait_for_load_state("networkidle")
            time.sleep(2)
            print("OK Primer vehículo expandido")
        except Exception as e:
            print(f"ERR Error expandiendo vehículo: {e}")

        # ── GUARDAR RESULTADOS ──
        output = {
            "total_captured": len(captured),
            "brands_found": brands,
            "requests": [r for r in captured if r["type"] == "request"],
            "responses": [r for r in captured if r["type"] == "response"],
        }

        with open("api_requests.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"\n{'='*50}")
        print(f"OK Guardado en api_requests.json")
        print(f"  Total requests capturados: {len([r for r in captured if r['type'] == 'request'])}")
        print(f"  Total responses capturadas: {len([r for r in captured if r['type'] == 'response'])}")
        print(f"\nURLs de requests únicos:")
        seen = set()
        for r in captured:
            if r["type"] == "request" and r["url"] not in seen:
                seen.add(r["url"])
                print(f"  [{r['method']}] {r['url']}")

        print("\nEsperando 10s antes de cerrar para que puedas ver el navegador...")
        time.sleep(10)
        browser.close()

if __name__ == "__main__":
    main()
