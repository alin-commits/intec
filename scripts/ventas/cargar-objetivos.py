#!/usr/bin/env python
"""
CARGA LOS OBJETIVOS DE VENTA POR SOCIEDAD
=========================================

De dónde salen: el cuadro de dirección «PRESUPUESTO ... CIFRAS VENTAS AGENTE
VENDEDOR.xlsx», hoja «COMPARATIVA», que lleva mes a mes el presupuesto de 2025
repartido por comercial y por canal.

Por qué sale de ahí y no de la hoja «6,15»: esa es la de 2026 y sus bloques no
cuadran con su propio total —suman 6.525.000 contra un total de 6.150.000, y
TIENDA pone 750.000 mientras sus tres comerciales suman 700.000—. Mientras eso
no se arregle en el Excel, cargar 2026 sería meter en el panel una cifra que
nadie ha cerrado. La de 2025 cuadra al céntimo y es la que se carga.

Cómo se reparte por sociedad, que es como el panel lo lee: el cuadro va por
comercial y por canal, y de todos sus bloques solo uno es una sociedad
distinta —JENDER—. Así que el objetivo de Jender es su bloque, y el de
Suministros Intec es el total del mes menos Jender. Tools Place y CST Ibérica
no tienen presupuesto de 2025 en ningún sitio del cuadro, así que no se les
inventa ninguno: se quedan sin objetivo, que es distinto de un objetivo de
cero.

El total no se calcula sumando los bloques a propósito: se coge la columna
«TOTAL FACTURADO», que es la oficial —los 6.500.000 del año— y de la que
cuelga el reparto mensual. Los bloques suman 601 € menos por un redondeo en
GENERAL, y el objetivo del grupo tiene que ser el que firmó Dirección, no el
que sale de volver a sumar sus partes.

Lo escrito queda en sales_targets, que es la tabla que se edita a mano desde
la página de Objetivos: volver a ejecutarlo pisa lo que haya de ese año para
esas sociedades, así que si alguien ha retocado un mes a mano, se pierde.
Avisa antes y pide confirmación.

Uso (desde la raíz del proyecto, con .env.local puesto):
    python scripts/ventas/cargar-objetivos.py --excel "C:\\ruta\\al.xlsx" --seco
    python scripts/ventas/cargar-objetivos.py --excel "C:\\ruta\\al.xlsx"
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
         "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]

HOJA = "COMPARATIVA "   # el espacio del final es parte del nombre en el Excel
ANIO = 2025

"""
Qué columna del Excel es cada cosa.

Van por número y no buscando el texto de la cabecera porque el cuadro reparte
los títulos en cuatro filas con celdas combinadas: buscarlos por texto acierta
hoy y falla el día que alguien mueva una columna. El número se comprueba
contra lo que se espera leer encima, y si no cuadra el cargador para.
"""
COLUMNA_TOTAL = 4       # «TOTAL FACTURADO / 2025»
COLUMNA_JENDER = 14     # el bloque «JENDER / 2025»
ESPERA_TOTAL = ["TOTAL FACTURADO", "2025"]
ESPERA_JENDER = ["JENDER", "2025"]

SOCIEDAD_JENDER = 2
SOCIEDAD_INTEC = 1
TOTAL_DEL_ANO = 6_500_000   # lo que tiene que sumar el año, para no cargar un Excel a medias


def variables_de_entorno():
    """Lo que hace falta de .env.local. La clave no se imprime nunca."""
    env = {}
    for linea in Path(".env.local").read_text(encoding="utf-8").splitlines():
        if "=" not in linea or linea.strip().startswith("#"):
            continue
        clave, valor = linea.split("=", 1)
        env[clave.strip()] = valor.strip()
    if not env.get("NEXT_PUBLIC_SUPABASE_URL") or not env.get("SUPABASE_SERVICE_ROLE_KEY"):
        print("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.")
        sys.exit(1)
    return env


def euros(valor):
    return f"{valor:,.2f} EUR".replace(",", "X").replace(".", ",").replace("X", ".")


def leer(ruta):
    """El objetivo de cada mes, por sociedad."""
    import openpyxl

    libro = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    if HOJA not in libro.sheetnames:
        print(f"El Excel no tiene la hoja «{HOJA.strip()}». Tiene: {', '.join(libro.sheetnames)}")
        sys.exit(1)
    filas = list(libro[HOJA].iter_rows(values_only=True))
    libro.close()

    def celda(fila, col):
        return fila[col - 1] if col - 1 < len(fila) else None

    def comprobar_cabecera(col, espera):
        # El nombre del bloque vive en una celda combinada a la izquierda de su
        # columna, así que se mira esa y la de al lado, no solo la suya.
        encima = " ".join(
            str(celda(filas[i], c)).strip()
            for i in range(0, min(5, len(filas)))
            for c in range(max(col - 1, 1), col + 2)
            if celda(filas[i], c) is not None
        ).lower()
        if all(parte.lower() in encima for parte in espera):
            return
        print(f"La columna {col} no es la de «{espera[0]}»: encima pone «{encima[:70]}».")
        print("El Excel ha cambiado de forma. Revisa las columnas antes de cargar nada.")
        sys.exit(1)

    comprobar_cabecera(COLUMNA_TOTAL, ESPERA_TOTAL)
    comprobar_cabecera(COLUMNA_JENDER, ESPERA_JENDER)

    por_mes = {}
    for fila in filas:
        etiqueta = str(celda(fila, 2) or "").strip().upper()
        if etiqueta not in MESES:
            continue
        mes = MESES.index(etiqueta) + 1
        def numero(col):
            valor = celda(fila, col)
            return float(valor) if isinstance(valor, (int, float)) else 0.0
        por_mes[mes] = (numero(COLUMNA_TOTAL), numero(COLUMNA_JENDER))

    if sorted(por_mes) != list(range(1, 13)):
        print(f"Faltan meses en la hoja: solo se han leído {sorted(por_mes)}.")
        sys.exit(1)

    total = sum(valor[0] for valor in por_mes.values())
    if round(total) != TOTAL_DEL_ANO:
        print(f"El año suma {euros(total)} y tendría que sumar {euros(TOTAL_DEL_ANO)}.")
        print("O el Excel ha cambiado de presupuesto o se está leyendo la columna de al lado.")
        sys.exit(1)

    filas_salida = []
    for mes, (total_mes, jender) in sorted(por_mes.items()):
        intec = round(total_mes - jender, 2)
        for sociedad, importe in ((SOCIEDAD_JENDER, round(jender, 2)), (SOCIEDAD_INTEC, intec)):
            # Un mes sin cifra no se carga: sin objetivo no es lo mismo que un
            # objetivo de cero, y el panel los distingue.
            if importe <= 0:
                continue
            filas_salida.append({
                "year": ANIO, "month": mes, "company_code": sociedad,
                "rep_key": None, "amount": importe,
            })
    return filas_salida


def pedir(env, metodo, ruta, cuerpo=None, prefer=None):
    cabeceras = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
    }
    if prefer:
        cabeceras["Prefer"] = prefer
    peticion = urllib.request.Request(
        f"{env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')}/rest/v1/{ruta}",
        data=json.dumps(cuerpo).encode("utf-8") if cuerpo is not None else None,
        method=metodo, headers=cabeceras,
    )
    try:
        with urllib.request.urlopen(peticion, timeout=60) as respuesta:
            texto = respuesta.read().decode("utf-8", "replace")
            return json.loads(texto) if texto.strip() else None
    except urllib.error.HTTPError as fallo:
        # El cuerpo del error dice qué columna no cuadra; la clave no sale ahí.
        print(f"No se pudo {metodo} {ruta.split('?')[0]} ({fallo.code}): "
              f"{fallo.read().decode('utf-8', 'replace')[:300]}")
        sys.exit(1)


def main():
    p = argparse.ArgumentParser(description="Carga en el Hub los objetivos de venta por sociedad.")
    p.add_argument("--excel", required=True, help="el cuadro de dirección, en .xlsx")
    p.add_argument("--seco", action="store_true", help="leer y enseñar, sin escribir nada")
    p.add_argument("--si", action="store_true", help="no preguntar antes de pisar lo que haya")
    args = p.parse_args()

    if not Path(args.excel).is_file():
        print(f"No encuentro el Excel:\n  {args.excel}")
        return 1

    filas = leer(args.excel)
    sociedades = sorted({fila["company_code"] for fila in filas})

    print(f"Objetivos de {ANIO}, por sociedad:")
    for sociedad in sociedades:
        suyas = [fila for fila in filas if fila["company_code"] == sociedad]
        print(f"  sociedad {sociedad}: {len(suyas)} meses, {euros(sum(f['amount'] for f in suyas))}")
    print(f"  --------\n  total:       {euros(sum(fila['amount'] for fila in filas))}")

    if args.seco:
        print("\n(en seco: no se ha escrito nada)")
        return 0

    env = variables_de_entorno()
    lista = ",".join(str(sociedad) for sociedad in sociedades)
    filtro = f"year=eq.{ANIO}&company_code=in.({lista})&rep_key=is.null"
    habia = pedir(env, "GET", f"sales_targets?select=month,company_code,amount&{filtro}") or []
    if habia:
        print(f"\nOJO: ya hay {len(habia)} objetivos guardados de {ANIO} para esas sociedades.")
        print("Se van a borrar y volver a escribir, así que cualquier retoque a mano se pierde.")
        if not args.si and input("¿Seguir? (escribe «si»): ").strip().lower() not in ("si", "sí"):
            print("No se ha escrito nada.")
            return 1
        pedir(env, "DELETE", f"sales_targets?{filtro}", prefer="return=minimal")

    pedir(env, "POST", "sales_targets", filas, prefer="return=minimal")
    print(f"\nCargado. Se ven en Ventas > Objetivos y en la columna «Objetivo» del mes a mes,"
          f" eligiendo el año {ANIO} en «Periodo».")
    return 0


if __name__ == "__main__":
    sys.exit(main())
