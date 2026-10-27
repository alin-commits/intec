#!/usr/bin/env python
"""
LECTOR DE CATÁLOGOS → COMMERCIAL HUB
====================================

Lee los catálogos y tarifas de los proveedores y manda su texto al Hub, para
que el chat de Catálogos pueda responder a los comerciales.

Lo que manda:
  - de los Excel de tarifas, una fila por producto: referencia, EAN,
    descripción y precio, ya normalizados aunque cada proveedor use su
    formato;
  - de los PDF, el texto en trozos que se entiendan solos: las tablas fila a
    fila con el nombre de cada columna delante, el resto en orden de lectura,
    y todo encabezado por el título de su página.

Lo de los PDF se hace así porque un catálogo cuenta las cosas en tablas, y
el texto en crudo las deja como una ristra de números sin pies ni cabeza:
«950 10 2 1 6 7 8». De ahí no sale una respuesta útil por mucho que se
busque bien. Sacar las tablas cuesta unos 50 minutos de más en una pasada
completa; con --sin-tablas se salta, y se lee peor.

Lo que NO manda: los ficheros. En la carpeta hay 2,7 GB y un catálogo de
376 MB. Lo que sube es el texto, que son unos 40 MB en total.

No escribe nada en la carpeta: solo lee.

---------------------------------------------------------------------------
PUESTA EN MARCHA
---------------------------------------------------------------------------
1. Hace falta Python con dos librerías. Para comprobar que están:

     python -c "import openpyxl, pymupdf; print('listo')"

   Si falta alguna:  pip install openpyxl pymupdf

2. Decir, una sola vez, la clave de envío (la misma del agente de Sage) y de
   qué carpeta leer. La carpeta no va escrita en este fichero porque el
   repositorio es público y la ruta dice qué máquina guarda qué:

     setx INTEC_SAGE_TOKEN "la-clave-que-te-pase"
     setx INTEC_CATALOGOS_RUTA "\\servidor\recurso\08 TARIFAS 2026"

   Cierra y vuelve a abrir la consola después de esto.

3. Probarlo con unos pocos antes de soltarlo entero:

     python lector-catalogos.py --limite 5

4. La primera lectura completa (tarda; son 283 ficheros y unas 14.000
   páginas de PDF, así que cuenta con hora y media):

     python lector-catalogos.py

   Las siguientes son rápidas: solo se vuelve a leer lo que ha cambiado de
   fecha o de tamaño. Para rehacerlo todo después de cambiar cómo se lee,
   hace falta --todo.

5. Programarlo, si se quiere. Una vez al día de sobra, que las tarifas
   cambian una vez al año:

     schtasks /Create /TN "Intec - Catalogos" /SC DAILY /ST 07:30 ^
       /TR "python C:\\intec\\lector-catalogos.py"

   Si el ordenador está apagado a esa hora no pasa nada: el chat sigue
   respondiendo con lo que ya subió, y la próxima vez se recoge lo nuevo.
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import warnings
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# openpyxl avisa de extensiones que no entiende en algunos Excel. No es un
# error —el fichero se lee igual— pero en una pasada de 280 ficheros llena la
# pantalla de avisos y tapa lo que sí importa.
warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

# La carpeta no va escrita aquí: este repositorio es público y la ruta dice
# qué máquina de la red interna guarda qué. Se pone una vez en el equipo que
# vaya a leerla, con:  setx INTEC_CATALOGOS_RUTA "\\servidor\recurso\carpeta"
RUTA_POR_DEFECTO = ""
HUB_POR_DEFECTO = "https://app.suministrointec.com"

# Vercel corta las peticiones a 4,5 MB. Se envía bastante por debajo: el JSON
# abulta más que el texto suelto y conviene margen.
TOPE_ENVIO = 3_000_000

# El Hub tiene dos topes, no uno: el tamaño del envío y cuántas cosas lleva
# dentro (5.000 precios, 4.000 trozos). Una tarifa de 15.000 artículos cabe
# de sobra en 3 MB y aun así se pasa de la segunda, que es lo que rechazaba
# justo las tarifas más gordas. Aquí se va por debajo de las dos.
TOPE_PRECIOS_TANDA = 4000
TOPE_TROZOS_TANDA = 3000

# Un trozo por página, partido si la página es larguísima. Se va por páginas
# porque una página de catálogo suele ser un producto o una familia, y así la
# respuesta puede decir «página 34» y el comercial va a comprobarlo.
TOPE_TROZO = 2500

# Debajo de esto, la página no tiene texto de verdad: es un escaneo o una
# maqueta en imagen.
MINIMO_TEXTO_PAGINA = 40

# Lo que deja Excel cuando una fórmula no sale: no es contenido, es un hueco.
ERROR_DE_HOJA = re.compile(r"#(N/A|¡?REF|¡?VALOR|VALUE|DIV/0|NAME|NOMBRE|NULL|NUM)", re.IGNORECASE)

# Buscar tablas en una página cuesta tiempo —un quinto de segundo— y en una de
# texto corrido no hay ninguna. Se mira solo donde hay cifras suficientes para
# que la haya. Con los 280 ficheros de la carpeta son unos 50 minutos de más
# en una pasada completa, y de ahí sale lo que de verdad se pregunta: las
# medidas, los caudales y los códigos. Se puede quitar con --sin-tablas.
DIGITOS = re.compile(r"(?:\d[\d.,]*\s+){6}")
CON_TABLAS = True

# Por dónde se parte el texto de una página en piezas: por saltos de línea y
# por finales de frase. Partir por ahí deja cada fila y cada párrafo entero.
SEPARADOR = re.compile(r"\n+|(?<=[.;:])\s{2,}")

EXTENSIONES = {".pdf", ".xlsx", ".xls", ".doc", ".docx"}

# Cómo llama cada proveedor a cada cosa. No hay formato común: esto es el
# vocabulario que aparece de verdad en la carpeta. Si un día entra una tarifa
# que no se detecta, lo que falta es una palabra en esta lista.
PALABRAS = {
    "price": ("precio", "tarifa", "pvp", "p.v.p", "eur", "€", "importe", "neto", "coste", "price"),
    "reference": ("referencia", "ref.", "ref ", "codigo", "código", "cod.", "code", "articulo", "artículo"),
    "ean": ("ean", "barras", "barcode", "gtin"),
    "description": ("descrip", "denominacion", "denominación", "nombre", "concepto", "producto", "modelo"),
}

# El orden importa: «CÓDIGO EAN» es un EAN, no una referencia, así que el EAN
# se mira primero.
ORDEN = ("ean", "price", "reference", "description")


def tipo_de_columna(titulo):
    t = str(titulo).strip().lower()
    if not t:
        return None
    for clave in ORDEN:
        if any(p in t for p in PALABRAS[clave]):
            return clave
    return None


def a_numero(valor):
    """El precio, venga como venga: 28,93 · 28.93 · «28,93 €» · 1.234,50."""
    if isinstance(valor, (int, float)):
        return float(valor)
    if valor is None:
        return None
    texto = str(valor).strip()
    if not texto:
        return None
    limpio = re.sub(r"[^\d,.\-]", "", texto)
    if not limpio:
        return None
    # Si hay punto y coma, el último separador es el decimal.
    if "," in limpio and "." in limpio:
        if limpio.rfind(",") > limpio.rfind("."):
            limpio = limpio.replace(".", "").replace(",", ".")
        else:
            limpio = limpio.replace(",", "")
    elif "," in limpio:
        limpio = limpio.replace(",", ".")
    try:
        return float(limpio)
    except ValueError:
        return None


def año_de(nombre, texto_cabecera=""):
    """De qué año es la tarifa. En la carpeta de 2026 hay ficheros de 2022."""
    ahora = datetime.now().year
    for fuente in (nombre, texto_cabecera):
        # Nada de \b: en «Tarifa_2026» el guion bajo cuenta como letra, no hay
        # frontera de palabra, y el año se perdía justo en los nombres que lo
        # llevan pegado, que son la mitad.
        años = [int(a) for a in re.findall(r"(?<!\d)(20\d{2})(?!\d)", str(fuente)) if 2000 <= int(a) <= ahora + 2]
        if años:
            return max(años)
    return None


def hash_de(ruta, tam, modificado):
    """
    Para saber si un fichero ha cambiado.

    Tamaño y fecha, no el contenido: hacer SHA de 2,7 GB cada vez costaría más
    que leerlos. Un cambio que deje el mismo tamaño y la misma fecha no se
    detecta, pero eso no pasa guardando desde Excel o copiando un fichero.
    """
    return hashlib.sha1(f"{os.path.basename(ruta)}|{tam}|{int(modificado)}".encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- Excel ----

def sirve_como_texto(linea):
    """
    Si una línea de una hoja de cálculo dice algo que alguien pueda buscar.

    Fuera las fórmulas rotas —#N/A, #¡REF!— y las filas que son solo cifras y
    símbolos: en una tarifa que no se ha entendido, una fila sin palabras es
    una referencia suelta sin su descripción, y para eso está la tabla de
    precios.
    """
    if ERROR_DE_HOJA.search(linea):
        return False
    letras = sum(1 for c in linea if c.isalpha())
    return letras >= 8 and letras >= len(linea) * 0.2


def leer_excel(ruta):
    """Devuelve (precios, trozos, aviso)."""
    import openpyxl

    try:
        libro = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    except Exception as fallo:
        return [], [], f"no se pudo abrir: {str(fallo)[:120]}"

    precios, trozos = [], []
    try:
        for nombre_hoja in libro.sheetnames:
            hoja = libro[nombre_hoja]
            filas = []
            for i, fila in enumerate(hoja.iter_rows(values_only=True)):
                filas.append(fila)
                if i > 30000:        # una tarifa más larga que esto no existe
                    break
            if not filas:
                continue

            mejor, mejor_idx, mejor_puntos = None, -1, 0
            for i, fila in enumerate(filas[:20]):
                mapa = {}
                for j, celda in enumerate(fila):
                    if celda is None or not str(celda).strip():
                        continue
                    t = tipo_de_columna(celda)
                    if t and t not in mapa:
                        mapa[t] = (j, str(celda).strip())
                puntos = len(mapa) + (2 if "price" in mapa else 0)
                if puntos > mejor_puntos:
                    mejor, mejor_idx, mejor_puntos = mapa, i, puntos

            if not mejor or "price" not in mejor:
                # No se ha entendido el formato. Se guarda el texto en crudo
                # para que al menos se pueda buscar por palabras, aunque no se
                # pueda dar el precio exacto.
                #
                # Pero solo lo que sea texto: una hoja con fórmulas rotas
                # llenaba el índice de líneas como «15201 #N/A #N/A», y esas
                # no las busca nadie y compiten por salir con las que sí
                # dicen algo. La mitad de lo guardado eran de esta clase.
                for fila in filas:
                    linea = " ".join(str(c).strip() for c in fila if c is not None and str(c).strip())
                    if len(linea) < 20 or not sirve_como_texto(linea):
                        continue
                    trozos.append({"page": None, "content": linea[:TOPE_TROZO]})
                continue

            col_precio = mejor["price"][0]
            for fila in filas[mejor_idx + 1:]:
                if col_precio >= len(fila):
                    continue
                precio = a_numero(fila[col_precio])
                if precio is None or precio <= 0:
                    continue
                registro = {"reference": None, "ean": None, "description": None,
                            "price": round(precio, 4), "currency": "EUR", "unit": None}
                for clave in ("reference", "ean", "description"):
                    if clave in mejor and mejor[clave][0] < len(fila):
                        v = fila[mejor[clave][0]]
                        registro[clave] = str(v).strip()[:600] if v is not None and str(v).strip() else None
                if not registro["reference"] and not registro["description"]:
                    continue        # una fila sin nombre ni código no sirve de nada
                registro["raw"] = {
                    titulo: (str(fila[j])[:200] if j < len(fila) and fila[j] is not None else None)
                    for j, titulo in (v for v in mejor.values())
                }
                precios.append(registro)
    finally:
        libro.close()

    # Una tarifa entendida no deja trozos de texto a propósito: su descripción
    # ya está en cada precio, y la tabla de precios se busca por palabras igual
    # que los catálogos. Guardar las dos cosas era duplicar quince mil filas.
    aviso = None if precios else "no se encontró columna de precio; se guarda solo el texto"
    return precios, trozos, aviso


# ------------------------------------------------------------------ PDF ----

def titulo_de(pagina):
    """
    De qué va la página, para encabezar sus trozos.

    Es el texto más grande de la mitad de arriba: en un catálogo, el titular
    de la página («Compresores de pistón AB») y no el pie ni la numeración.
    Sin él, un trozo que dice «8 bar · 50 l/min · 2 CV» no deja saber de qué
    producto habla, que es justo lo que pregunta el comercial.
    """
    try:
        datos = pagina.get_text("dict")
    except Exception:
        return ""
    alto = pagina.rect.height or 1
    mejor, mejor_tam = "", 0
    for bloque in datos.get("blocks", []):
        for linea in bloque.get("lines", []):
            arriba = linea.get("bbox", [0, 0, 0, 0])[1]
            if arriba > alto * 0.45:
                continue
            texto = " ".join(t.get("text", "") for t in linea.get("spans", [])).strip()
            tam = max((t.get("size", 0) for t in linea.get("spans", [])), default=0)
            # Dos palabras como mínimo: descarta los números de página sueltos.
            if tam > mejor_tam and len(texto) >= 6 and len(texto.split()) >= 2:
                mejor, mejor_tam = texto, tam
    return " ".join(mejor.split())[:120]


def tablas_de(pagina):
    """
    Las tablas de la página, cada fila con el nombre de su columna delante.

    Un catálogo pone las características en tablas, y el texto suelto las deja
    como una ristra de números sin pies ni cabeza: «950 10 2 1 6 7 8». Así
    cada fila se lee sola —«Código: AB000330115 · Diámetro: 115x1,0»— y se
    encuentra buscando por lo que diga cualquiera de sus celdas.

    Devuelve [] si esta versión de PyMuPDF no sabe sacarlas o si falla: es una
    mejora, no un requisito, y un catálogo raro no puede tumbar la pasada.
    """
    try:
        encontradas = pagina.find_tables()
    except Exception:
        return []
    salida = []
    for tabla in getattr(encontradas, "tables", []):
        try:
            filas = tabla.extract()
        except Exception:
            continue
        if not filas or len(filas) < 2:
            continue
        cabecera = [" ".join(str(c).split())[:40] if c else "" for c in filas[0]]
        # Una cabecera sin palabras no es cabecera: esa tabla va tal cual.
        con_nombre = sum(1 for c in cabecera if re.search(r"[a-zA-ZáéíóúñÁÉÍÓÚÑ]{3}", c))
        for fila in filas[1:]:
            celdas = [" ".join(str(c).split()) if c else "" for c in fila]
            if not any(celdas):
                continue
            if con_nombre >= 2:
                partes = [f"{cabecera[i]}: {v}" if i < len(cabecera) and cabecera[i] else v
                          for i, v in enumerate(celdas) if v]
            else:
                partes = [v for v in celdas if v]
            linea = " · ".join(partes)
            if len(linea) >= 12:
                salida.append(linea)
    return salida


def partir(piezas, pagina, titulo):
    """
    Junta las piezas de una página en trozos, sin cortar ninguna por la mitad.

    Antes se cortaba cada 2.500 caracteres a pelo y la cuenta caía donde caía:
    a mitad de una fila de tabla, o entre el nombre de un producto y su
    precio. Lo que queda partido ni lo encuentra la búsqueda ni lo entiende
    quien lee la respuesta.

    Cada trozo empieza por el título de la página. Cuesta 120 caracteres y
    hace que el trozo se explique solo.
    """
    cabeza = f"{titulo}. " if titulo else ""
    hueco = TOPE_TROZO - len(cabeza)
    # El título suele ser también la primera línea de la página: ponerlo
    # delante otra vez sería decirlo dos veces seguidas.
    def montar(partes):
        cuerpo = " ".join(partes)
        return cuerpo if titulo and cuerpo.startswith(titulo) else cabeza + cuerpo

    trozos, actual, largo = [], [], 0
    for pieza in piezas:
        pieza = " ".join(str(pieza).split())
        if not pieza:
            continue
        # Una pieza más larga que el hueco va sola, partida como se pueda.
        if len(pieza) > hueco:
            if actual:
                trozos.append(montar(actual))
                actual, largo = [], 0
            for j in range(0, len(pieza), hueco):
                trozos.append(montar([pieza[j:j + hueco]]))
            continue
        if largo + len(pieza) + 1 > hueco and actual:
            trozos.append(montar(actual))
            actual, largo = [], 0
        actual.append(pieza)
        largo += len(pieza) + 1
    if actual:
        trozos.append(montar(actual))
    return [{"page": pagina, "content": t} for t in trozos if len(t) >= MINIMO_TEXTO_PAGINA]


def leer_pdf(ruta):
    """Devuelve (trozos, páginas, aviso)."""
    import pymupdf

    try:
        doc = pymupdf.open(ruta)
    except Exception as fallo:
        return [], None, f"no se pudo abrir: {str(fallo)[:120]}"

    trozos, con_texto = [], 0
    try:
        total = doc.page_count
        for i in range(total):
            pagina = doc[i]
            # sort=True devuelve el texto en orden de lectura y no en el orden
            # en que el PDF lo dibuja, que es lo que dejaba los números de una
            # tabla delante del título al que pertenecen.
            try:
                crudo = pagina.get_text(sort=True)
            except Exception:
                crudo = pagina.get_text()
            texto = " ".join(crudo.split())
            if len(texto) < MINIMO_TEXTO_PAGINA:
                continue
            con_texto += 1

            titulo = titulo_de(pagina)
            # Las tablas van primero y enteras: son las que llevan las medidas,
            # los códigos y las características, que es lo que se pregunta.
            tablas = tablas_de(pagina) if CON_TABLAS and DIGITOS.search(texto) else []
            piezas = list(tablas)
            """
            Y el resto de la página, sin lo que ya va en las tablas.

            Antes se añadía el texto crudo entero: una página de tarifa se
            indexaba dos veces, una con las filas etiquetadas y otra como
            ristra de números. Eso dobla el índice, parte el presupuesto de
            trozos de cada envío y hace que la misma página salga dos veces
            compitiendo consigo misma en la búsqueda.

            Se quita quedándose con las líneas del texto que no estén ya
            dentro de alguna fila de tabla. Comparando sin espacios: la tabla
            da «115x1,0» donde el texto suelto puede dar «115 x 1,0».
            """
            def apretado(valor):
                return "".join(valor.split()).lower()

            yaEnTablas = {apretado(fila) for fila in tablas}
            def esta_en_una_tabla(linea):
                corta = apretado(linea)
                if len(corta) < 8:
                    return False
                return any(corta in fila for fila in yaEnTablas)

            sobrante = "\n".join(
                linea for linea in crudo.splitlines()
                if not esta_en_una_tabla(linea)
            )
            piezas += [p for p in SEPARADOR.split(sobrante) if p.strip()]
            trozos += partir(piezas, pagina=i + 1, titulo=titulo)
    finally:
        doc.close()

    if con_texto == 0:
        # Las páginas están en imagen. Se puede leer, pero pasándoselas al
        # modelo, que es otro paso: aquí queda apuntado para no olvidarlo.
        return [], total, "catálogo sin texto (escaneado): hay que leerlo con el modelo"
    return trozos, total, None


# ------------------------------------------------------------- el envío ----

class ClaveRechazada(Exception):
    """
    El Hub no acepta la clave.

    Va aparte de los demás fallos porque no es cosa de este fichero: va a
    pasar con los 280. Sin esto, el lector recorría 2,7 GB para repetir el
    mismo error una vez por catálogo y tardaba media hora en decir algo que
    se sabe al primer intento.
    """


def enviar(hub, token, cuerpo, intentos=3):
    datos = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
    peticion = urllib.request.Request(
        f"{hub}/api/catalogos/ingesta", data=datos, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    for intento in range(1, intentos + 1):
        try:
            with urllib.request.urlopen(peticion, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as fallo:
            detalle = fallo.read().decode("utf-8", "replace")[:200]
            if fallo.code < 500 or intento == intentos:
                if fallo.code in (401, 403):
                    raise ClaveRechazada(detalle) from None
                raise RuntimeError(f"el Hub respondió {fallo.code}: {detalle}") from None
        except Exception as fallo:
            if intento == intentos:
                raise RuntimeError(f"no se pudo enviar: {str(fallo)[:160]}") from None
        time.sleep(3 * intento)
    return None


def ya_leidos(hub, token):
    peticion = urllib.request.Request(f"{hub}/api/catalogos/ingesta",
                                      headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(peticion, timeout=60) as r:
            return json.loads(r.read().decode("utf-8")).get("leidos", {})
    except Exception as fallo:
        print(f"  aviso: no se pudo preguntar qué hay leído ({str(fallo)[:80]}); se leerá todo")
        return {}


def en_tandas(fichero, trozos, precios):
    """
    Parte un catálogo en envíos que quepan.

    La primera tanda es la que borra lo anterior en el Hub, así que siempre
    hay al menos una aunque el fichero no tenga nada que mandar: es lo que
    deja apuntado el error cuando no se ha podido leer.
    """
    # El número de orden va seguido en todo el fichero, no por tanda: en la
    # base de datos (file_id, ordinal) es único, así que si cada tanda
    # empezara por cero, la segunda chocaría con la primera.
    trozos = [{**t, "ordinal": i} for i, t in enumerate(trozos)]

    tandas, actual, tamaño = [], {"chunks": [], "precios": []}, 0

    def cerrar():
        nonlocal actual, tamaño
        if actual["chunks"] or actual["precios"]:
            tandas.append(actual)
            actual = {"chunks": [], "precios": []}
            tamaño = 0

    for t in trozos:
        if tamaño + len(t["content"]) > TOPE_ENVIO or len(actual["chunks"]) >= TOPE_TROZOS_TANDA:
            cerrar()
        actual["chunks"].append(t)
        tamaño += len(t["content"])
    for p in precios:
        if tamaño > TOPE_ENVIO or len(actual["precios"]) >= TOPE_PRECIOS_TANDA:
            cerrar()
        actual["precios"].append(p)
        tamaño += 200
    tandas.append(actual)

    for i, tanda in enumerate(tandas):
        yield {"fichero": fichero, "parte": i + 1, "ultima": i == len(tandas) - 1,
               "chunks": tanda["chunks"], "precios": tanda["precios"]}


# ------------------------------------------------------------- principal ---

def main():
    p = argparse.ArgumentParser(description="Lee los catálogos de proveedor y los manda al Hub.")
    p.add_argument("--ruta", default=os.environ.get("INTEC_CATALOGOS_RUTA", RUTA_POR_DEFECTO))
    p.add_argument("--hub", default=os.environ.get("INTEC_HUB_URL", HUB_POR_DEFECTO))
    p.add_argument("--todo", action="store_true", help="releer también lo que no ha cambiado")
    p.add_argument("--limite", type=int, default=0, help="parar después de N ficheros (para probar)")
    p.add_argument("--solo", default="", help="solo los de este proveedor (la carpeta)")
    p.add_argument("--seco", action="store_true", help="leer y contar, sin mandar nada")
    p.add_argument("--sin-tablas", action="store_true",
                   help="no sacar las tablas de los PDF: va unas cinco veces más rápido y lee peor")
    p.add_argument("--volcar", default="", help="con --seco: escribir la primera tanda en este fichero")
    args = p.parse_args()

    token = os.environ.get("INTEC_SAGE_TOKEN", "").strip()
    if not token and not args.seco:
        print("Falta la clave. Ponla una vez con:  setx INTEC_SAGE_TOKEN \"la-clave\"")
        print("y vuelve a abrir la consola. Para probar sin mandar nada: --seco")
        return 1

    if not args.ruta:
        print("No sé de qué carpeta leer. Dilo una vez, en este equipo:")
        print('  setx INTEC_CATALOGOS_RUTA "\\\\servidor\\recurso\\08 TARIFAS 2026"')
        print("y vuelve a abrir la consola. O pásala suelta con --ruta.")
        return 1

    if not os.path.isdir(args.ruta):
        print(f"No se ve la carpeta:\n  {args.ruta}")
        print("Comprueba que está accesible desde este equipo.")
        return 1

    try:
        import openpyxl, pymupdf   # noqa: F401
    except ImportError as falta:
        print(f"Falta una librería ({falta.name}). Instálala con:  pip install openpyxl pymupdf")
        return 1

    global CON_TABLAS
    CON_TABLAS = not args.sin_tablas

    hub = args.hub.rstrip("/")
    conocidos = {} if (args.todo or args.seco) else ya_leidos(hub, token)
    if conocidos:
        print(f"ya leídos: {len(conocidos)} ficheros (se saltan si no han cambiado)")

    ficheros = []
    for carpeta, _, nombres in os.walk(args.ruta):
        proveedor = os.path.basename(carpeta) or os.path.basename(args.ruta)
        if args.solo and args.solo.lower() not in proveedor.lower():
            continue
        for n in sorted(nombres):
            if n.startswith("~$"):
                continue
            if os.path.splitext(n)[1].lower() in EXTENSIONES:
                ficheros.append((proveedor, os.path.join(carpeta, n)))
    ficheros.sort(key=lambda f: f[1])
    print(f"ficheros en la carpeta: {len(ficheros)}\n")

    leidos = saltados = fallados = 0
    total_precios = total_trozos = 0
    empezado = time.time()

    for proveedor, ruta in ficheros:
        if args.limite and leidos + fallados >= args.limite:
            break
        nombre = os.path.basename(ruta)
        relativa = os.path.relpath(ruta, args.ruta).replace("\\", "/")
        try:
            tam = os.path.getsize(ruta)
            modificado = os.path.getmtime(ruta)
        except OSError as fallo:
            print(f"  {proveedor}/{nombre}: no se pudo mirar ({fallo})")
            fallados += 1
            continue

        huella = hash_de(ruta, tam, modificado)
        if conocidos.get(relativa) == huella:
            saltados += 1
            continue

        extension = os.path.splitext(nombre)[1].lower()
        precios, trozos, paginas, aviso = [], [], None, None

        # Un fichero roto no puede llevarse por delante la pasada entera: son
        # 280, tarda un buen rato, y perderlo todo por el número 200 sería
        # tener que empezar de cero sin saber siquiera cuál fue.
        try:
            if extension == ".xlsx":
                precios, trozos, aviso = leer_excel(ruta)
            elif extension == ".pdf":
                trozos, paginas, aviso = leer_pdf(ruta)
            else:
                # .xls, .doc y .docx son formatos viejos que no se pueden abrir
                # sin Office. Son nueve ficheros de 283: se apuntan para que se
                # vean en la lista y se decida qué hacer, en vez de desaparecer.
                aviso = f"formato no soportado ({extension}); conviértelo a xlsx o pdf"
        except Exception as fallo:  # noqa: BLE001 - aquí da igual por qué falló
            precios, trozos = [], []
            aviso = f"no se pudo leer: {type(fallo).__name__} {str(fallo)[:100]}"

        fichero = {
            "supplier": proveedor[:120],
            "file_name": nombre[:300],
            "rel_path": relativa[:600],
            "kind": extension.lstrip(".")[:12],
            "bytes": tam,
            "modified_at": datetime.fromtimestamp(modificado, timezone.utc).isoformat(),
            "content_hash": huella,
            "pages": paginas,
            "year_hint": año_de(nombre),
            "read_error": aviso,
        }

        marca = "·" if not aviso else "!"
        print(f"  {marca} {proveedor[:22]:<22} {nombre[:44]:<44} "
              f"{len(precios):>5} precios {len(trozos):>5} trozos"
              + (f"   {aviso[:46]}" if aviso else ""))

        if args.seco:
            leidos += 1
            total_precios += len(precios)
            total_trozos += len(trozos)
            if args.volcar and leidos == 1:
                # La primera tanda a un fichero, para poder comprobar que
                # encaja con lo que espera el Hub sin mandar nada.
                primera = next(en_tandas(fichero, trozos, precios))
                with io.open(args.volcar, "w", encoding="utf-8") as f:
                    json.dump(primera, f, ensure_ascii=False)
                print(f"      (primera tanda volcada en {args.volcar})")
            continue

        try:
            for tanda in en_tandas(fichero, trozos, precios):
                enviar(hub, token, tanda)
            leidos += 1
            total_precios += len(precios)
            total_trozos += len(trozos)
        except ClaveRechazada as fallo:
            print(f"\nEl Hub no acepta la clave: {fallo}")
            print("\nQué mirar, por este orden:")
            print("  1. Que INTEC_SAGE_TOKEN valga lo mismo que SAGE_INGEST_TOKEN en Vercel.")
            print("  2. Que cerraras y abrieras PowerShell después del setx.")
            print("  3. Si acabas de subir un cambio, que Vercel haya terminado de desplegarlo.")
            print("\nNo se ha mandado nada. Cuando lo arregles, vuelve a lanzarlo y sigue donde iba.")
            return 1
        except RuntimeError as fallo:
            print(f"      no se pudo mandar: {fallo}")
            fallados += 1

    tardado = time.time() - empezado
    print(f"\nleídos {leidos} · saltados {saltados} · con problemas {fallados}")
    print(f"{total_precios} precios y {total_trozos} trozos de texto en {tardado / 60:.1f} minutos")
    if args.seco:
        print("(en seco: no se ha mandado nada al Hub)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
