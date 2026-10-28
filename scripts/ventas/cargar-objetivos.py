#!/usr/bin/env python
"""
CARGA LOS OBJETIVOS DE VENTA POR SOCIEDAD
=========================================

De dónde salen: el cuadro de dirección «PRESUPUESTO ... CIFRAS VENTAS AGENTE
VENDEDOR.xlsx», que lleva el presupuesto mes a mes repartido por comercial y
por canal. 2025 está en la hoja «COMPARATIVA» y 2026 en la hoja «6,15».

Cómo se reparte por sociedad, que es como el panel lo lee: el cuadro va por
comercial y por canal, y de todos sus bloques solo uno es una sociedad
distinta —JENDER—. Así que el objetivo de Jender es su bloque, y el de
Suministros Intec es el total del mes menos Jender. Tools Place y CST Ibérica
no tienen presupuesto en ninguna parte del cuadro, así que no se les inventa
uno: se quedan sin objetivo, que es distinto de un objetivo de cero.

El total no sale de sumar los bloques a propósito, sino de la columna del
total del mes, que es la oficial: la que firmó Dirección y de la que cuelga el
reparto. En 2025 los bloques suman 601 € menos por un redondeo en GENERAL, y
en 2026 suman 375.000 € más —TIENDA pone 750.000 mientras sus tres comerciales
suman 700.000, y COM. EXTERNOS 2.100.000 contra 2.230.000 de los suyos—. Ese
descuadre es entre bloques de agentes y no toca el reparto por sociedad, que
solo usa el total y Jender; pero conviene saber que está ahí, porque el día
que se cierre el reparto de 2026 estas cifras pueden moverse.

Lo escrito queda en sales_targets, que es la tabla que se edita a mano desde
la página de Objetivos: volver a ejecutarlo pisa lo que haya de ese año para
esas sociedades, así que si alguien ha retocado un mes a mano, se pierde.
Avisa antes y pide confirmación.

Uso (desde la raíz del proyecto, con .env.local puesto):
    python scripts/ventas/cargar-objetivos.py --excel "C:\\ruta\\al.xlsx" --seco
    python scripts/ventas/cargar-objetivos.py --excel "C:\\ruta\\al.xlsx"
    python scripts/ventas/cargar-objetivos.py --excel "C:\\ruta\\al.xlsx" --anio 2026
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
         "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]

SOCIEDAD_INTEC = 1
SOCIEDAD_JENDER = 2

"""
Qué columna del Excel es cada cosa, y qué año.

Van por número de columna y no buscando el texto de la cabecera porque el
cuadro reparte los títulos en cuatro o cinco filas con celdas combinadas:
buscarlos por texto acierta hoy y falla el día que alguien mueva una columna.
El número se comprueba contra lo que se espera leer encima —el nombre del
bloque, que vive en una celda combinada a la izquierda, y el año, que está en
la columna misma— y si no cuadra el cargador para en vez de meter la columna
de al lado.

«suma» es lo que tiene que dar el año entero. Es la red de seguridad: si
alguien cambia el presupuesto en el Excel, esto para y hay que venir a mirar,
en vez de cargar en silencio una cifra que nadie ha cerrado.
"""
AÑOS = {
    2025: {
        "hoja": "COMPARATIVA ",   # el espacio del final es parte del nombre
        "total": {"columna": 4, "bloque": "TOTAL FACTURADO", "anio": "2025"},
        "jender": {"columna": 14, "bloque": "JENDER", "anio": "2025"},
        "suma": 6_500_000,
    },
    2026: {
        "hoja": "6,15",
        "total": {"columna": 4, "bloque": "TOTAL OBJETIVO", "anio": "2026"},
        "jender": {"columna": 21, "bloque": "JENDER", "anio": "PRESUPUESTO 2026"},
        "suma": 6_150_000,
    },
}


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


def leer(ruta, anio):
    """El objetivo de cada mes de un año, por sociedad."""
    import openpyxl

    config = AÑOS[anio]
    libro = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    if config["hoja"] not in libro.sheetnames:
        print(f"El Excel no tiene la hoja «{config['hoja'].strip()}». Tiene: {', '.join(libro.sheetnames)}")
        sys.exit(1)
    filas = list(libro[config["hoja"]].iter_rows(values_only=True))
    libro.close()

    def celda(fila, col):
        return fila[col - 1] if col - 1 < len(fila) else None

    def texto(desde, hasta):
        return " ".join(
            str(celda(filas[i], c)).strip()
            for i in range(0, min(5, len(filas)))
            for c in range(desde, hasta + 1)
            if celda(filas[i], c) is not None
        ).lower()

    def comprobar(que):
        col = que["columna"]
        # El año se busca en la columna misma; el nombre del bloque, en la
        # celda combinada que lo encabeza, hasta tres columnas a la izquierda.
        if que["anio"].lower() not in texto(col, col):
            print(f"La columna {col} no es de {que['anio']}: encima pone «{texto(col, col)[:70]}».")
        elif que["bloque"].lower() not in texto(max(col - 3, 1), col + 1):
            print(f"La columna {col} no cuelga de «{que['bloque']}»: encima pone «{texto(max(col - 3, 1), col + 1)[:70]}».")
        else:
            return
        print("El Excel ha cambiado de forma. Revisa las columnas antes de cargar nada.")
        sys.exit(1)

    comprobar(config["total"])
    comprobar(config["jender"])

    por_mes = {}
    for fila in filas:
        etiqueta = str(celda(fila, 2) or "").strip().upper()
        if etiqueta not in MESES:
            continue

        def numero(col):
            valor = celda(fila, col)
            return float(valor) if isinstance(valor, (int, float)) else 0.0

        por_mes[MESES.index(etiqueta) + 1] = (numero(config["total"]["columna"]), numero(config["jender"]["columna"]))

    if sorted(por_mes) != list(range(1, 13)):
        print(f"Faltan meses en la hoja de {anio}: solo se han leído {sorted(por_mes)}.")
        sys.exit(1)

    suma = sum(valor[0] for valor in por_mes.values())
    if round(suma) != config["suma"]:
        print(f"{anio} suma {euros(suma)} y tendría que sumar {euros(config['suma'])}.")
        print("O el Excel ha cambiado de presupuesto o se está leyendo la columna de al lado.")
        sys.exit(1)

    salida = []
    for mes, (total_mes, jender) in sorted(por_mes.items()):
        for sociedad, importe in ((SOCIEDAD_JENDER, round(jender, 2)),
                                  (SOCIEDAD_INTEC, round(total_mes - jender, 2))):
            # Un mes sin cifra no se carga: sin objetivo no es lo mismo que un
            # objetivo de cero, y el panel los distingue.
            if importe <= 0:
                continue
            salida.append({"year": anio, "month": mes, "company_code": sociedad,
                           "rep_key": None, "amount": importe})
    return salida


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
    p.add_argument("--anio", default="todos", choices=["2025", "2026", "todos"], help="qué año cargar")
    p.add_argument("--seco", action="store_true", help="leer y enseñar, sin escribir nada")
    p.add_argument("--si", action="store_true", help="no preguntar antes de pisar lo que haya")
    args = p.parse_args()

    if not Path(args.excel).is_file():
        print(f"No encuentro el Excel:\n  {args.excel}")
        return 1

    años = sorted(AÑOS) if args.anio == "todos" else [int(args.anio)]
    filas = [fila for anio in años for fila in leer(args.excel, anio)]

    for anio in años:
        print(f"Objetivos de {anio}, por sociedad:")
        suyas = [fila for fila in filas if fila["year"] == anio]
        for sociedad in sorted({fila["company_code"] for fila in suyas}):
            propias = [fila for fila in suyas if fila["company_code"] == sociedad]
            print(f"  sociedad {sociedad}: {len(propias)} meses, {euros(sum(f['amount'] for f in propias))}")
        print(f"  --------\n  total:       {euros(sum(fila['amount'] for fila in suyas))}\n")

    if args.seco:
        print("(en seco: no se ha escrito nada)")
        return 0

    env = variables_de_entorno()
    for anio in años:
        suyas = [fila for fila in filas if fila["year"] == anio]
        lista = ",".join(str(sociedad) for sociedad in sorted({fila["company_code"] for fila in suyas}))
        filtro = f"year=eq.{anio}&company_code=in.({lista})&rep_key=is.null"
        habia = pedir(env, "GET", f"sales_targets?select=month,company_code&{filtro}") or []
        if habia:
            print(f"OJO: ya hay {len(habia)} objetivos guardados de {anio} para esas sociedades.")
            print("Se van a borrar y volver a escribir, así que cualquier retoque a mano se pierde.")
            if not args.si and input("¿Seguir? (escribe «si»): ").strip().lower() not in ("si", "sí"):
                print(f"{anio} se queda como está.")
                continue
            pedir(env, "DELETE", f"sales_targets?{filtro}", prefer="return=minimal")
        pedir(env, "POST", "sales_targets", suyas, prefer="return=minimal")
        print(f"{anio}: cargado.")

    print("\nSe ven en Ventas > Objetivos y en la columna «Objetivo» del mes a mes,"
          " eligiendo el año en «Periodo».")
    return 0


if __name__ == "__main__":
    sys.exit(main())
