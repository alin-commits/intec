#!/usr/bin/env python
"""
AUDITA LA VENTA POR COMERCIAL
=============================

Comprueba que lo que el panel enseña de cada comercial sale bien de Sage y
cuadra consigo mismo. Solo lee: no escribe nada en ninguna tabla.

Qué comprueba, y por qué cada cosa:

  A) Que al agrupar por comercial no se pierda ni se duplique un euro. La suma
     de todos los comerciales más lo que no tiene comercial asignado tiene que
     dar el total del año, exacto.

  B) Qué fichas de Sage junta el panel en una sola persona. Sage tiene la
     misma persona repetida —con y sin acentos, con el nombre a medias, y con
     ficha en varias sociedades— y el panel las une por nombre. Si uniera dos
     personas distintas, la venta de una aparecería dentro de la otra, así que
     esto saca los grupos a la vista y avisa si en uno hay nombres de pila
     distintos.

  C) Que Clientes y Productos, filtrados por un comercial, sumen lo mismo que
     su venta. Son tres caminos distintos a la misma cifra: si uno se desvía,
     el panel se contradice a sí mismo según la pestaña que mires.

  D) Cuánta venta no tiene comercial asignado, y de qué series. No es un fallo
     del panel —así viene de Sage— pero explica por qué los comerciales nunca
     suman el total del grupo, y dice dónde habría que asignarlo si se quiere.

Ojo con una trampa al medir esto: PostgREST corta cualquier respuesta a 1.000
filas y el parámetro p_limit de las funciones NO lo cambia. Pedir la lista de
artículos de un comercial y sumarla da una cifra corta y parece un descuadre
que no existe. Por eso Productos se compara agrupado por familia, que son
cientos de filas y no decenas de miles, y el resto se pide por páginas.

Uso (desde la raíz del proyecto, con .env.local puesto):
    python scripts/ventas/auditar-comerciales.py 2026
    python scripts/ventas/auditar-comerciales.py 2025 2026
"""
import json
import sys
import unicodedata
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

# Lo que PostgREST devuelve como máximo por respuesta, sin que p_limit mande.
PAGINA = 1000
# A partir de qué desvío se considera que algo no cuadra: por debajo son
# redondeos de céntimos repartidos entre miles de líneas.
TOLERANCIA = 0.001


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


ENV = variables_de_entorno()
BASE = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
CABECERAS = {
    "apikey": ENV["SUPABASE_SERVICE_ROLE_KEY"],
    "Authorization": f"Bearer {ENV['SUPABASE_SERVICE_ROLE_KEY']}",
    "Content-Type": "application/json",
}


def leer(ruta):
    peticion = urllib.request.Request(f"{BASE}/rest/v1/{ruta}", headers=CABECERAS)
    with urllib.request.urlopen(peticion, timeout=120) as respuesta:
        return json.load(respuesta)


def llamar(nombre, args, paginando=False):
    """Una función de la base. Con `paginando`, hasta que no venga una página llena."""
    fuera, inicio = [], 0
    while True:
        cabeceras = dict(CABECERAS)
        if paginando:
            cabeceras["Range-Unit"] = "items"
            cabeceras["Range"] = f"{inicio}-{inicio + PAGINA - 1}"
        peticion = urllib.request.Request(f"{BASE}/rest/v1/rpc/{nombre}",
                                          data=json.dumps(args).encode("utf-8"),
                                          method="POST", headers=cabeceras)
        try:
            with urllib.request.urlopen(peticion, timeout=300) as respuesta:
                trozo = json.load(respuesta)
        except urllib.error.HTTPError as fallo:
            print(f"  no se pudo llamar a {nombre} ({fallo.code}): "
                  f"{fallo.read().decode('utf-8', 'replace')[:200]}")
            return fuera
        fuera += trozo
        if not paginando or len(trozo) < PAGINA:
            return fuera
        inicio += PAGINA


def llano(nombre):
    """Sin acentos, en mayúsculas y con un espacio entre palabras."""
    descompuesto = unicodedata.normalize("NFD", nombre)
    sin_tildes = "".join(c for c in descompuesto if unicodedata.category(c) != "Mn")
    return " ".join(sin_tildes.upper().split())


def identidades(fichas):
    """
    Lo mismo que buildRepIdentities en el panel, para auditar lo que hace él y
    no otra cosa: cada nombre se queda con la versión más completa que empiece
    por él. Con nombres inventados: «Ana Soler» cae dentro de «Ana Solér Quino»
    porque una es el principio de la otra, y «Ana Soler» no cae dentro de «Ana
    Beltrán Soler», porque ahí el principio no coincide — son dos personas.
    """
    nombres = sorted({f["name"] for f in fichas}, key=lambda n: -len(llano(n)))
    return {n: llano(next((otro for otro in nombres if llano(otro).startswith(llano(n) + " ")), n))
            for n in nombres}


def euros(valor):
    return f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def auditar(anio, fichas, clave_de, grupos):
    rango = {"p_from": f"{anio}-01-01", "p_to": f"{anio}-12-31"}
    filas = llamar("sage_sales_summary", {**rango, "p_basis": "albaran"}, paginando=True)
    if not filas:
        print(f"{anio}: Sage no devuelve ninguna venta.")
        return 0

    venta = defaultdict(float)
    sin_nadie = 0.0
    sin_serie = defaultdict(float)
    for fila in filas:
        importe = float(fila["net_amount"])
        if fila["rep_code"] is None:
            sin_nadie += importe
            sin_serie[fila["series"]] += importe
        else:
            venta[clave_de(fila["company_code"], fila["rep_code"])] += importe
    total = sum(venta.values()) + sin_nadie
    de_sage = sum(float(fila["net_amount"]) for fila in filas)

    print(f"\n=================== {anio} ===================")
    print(f"A) total de Sage            {euros(de_sage):>16}")
    print(f"   comerciales + sin asignar{euros(total):>16}")
    print(f"   diferencia               {euros(total - de_sage):>16}"
          f"   {'OK' if abs(total - de_sage) < 0.01 else 'SE PIERDE ALGO AL AGRUPAR'}")

    problemas = 0
    print(f"\nC) cada comercial por tres caminos distintos:")
    print(f"   {'comercial':30s} {'venta':>14s} {'clientes':>14s} {'productos':>14s}")
    for persona in sorted(venta, key=lambda x: -venta[x]):
        pares = sorted({f"{f['company_code']}:{f['code']}" for f in grupos.get(persona, [])})
        if not pares:
            continue
        clientes = sum(float(c["net_amount"]) for c in
                       llamar("sage_customer_list", {**rango, "p_reps": pares, "p_kind": "activos", "p_days": 30},
                              paginando=True))
        # Por familia y no por artículo: la lista de artículos la corta
        # PostgREST a 1.000 filas y el descuadre sería del medidor.
        productos = sum(float(a["net_amount"]) for a in
                        llamar("sage_article_groups", {"p_group": "familia", **rango, "p_reps": pares}))
        margen = max(1.0, abs(venta[persona]) * TOLERANCIA)
        avisos = [nombre for nombre, valor in (("clientes", clientes), ("productos", productos))
                  if abs(valor - venta[persona]) > margen]
        problemas += len(avisos)
        print(f"   {persona[:30]:30s} {euros(venta[persona]):>14} {euros(clientes):>14} {euros(productos):>14}"
              f"{'   DESCUADRA: ' + ', '.join(avisos) if avisos else ''}")

    print(f"\nD) venta sin comercial asignado: {euros(sin_nadie)} ({sin_nadie / de_sage * 100:.1f}% del año)")
    print("   por serie: " + ", ".join(f"{serie}={euros(importe)}" for serie, importe
                                       in sorted(sin_serie.items(), key=lambda x: -x[1])[:8]))
    print("   No es un fallo: así viene de Sage, y el panel lo enseña en su propia fila.")
    print("   Pero es la razón de que los comerciales no sumen el total del grupo.")
    return problemas


def main():
    años = sys.argv[1:] or [str(__import__("datetime").date.today().year)]
    if any(not a.isdigit() or len(a) != 4 for a in años):
        print("Dime los años de cuatro cifras: auditar-comerciales.py 2025 2026")
        return 1

    fichas = leer("sage_reps?select=company_code,code,name,is_person&order=company_code,code")
    ident = identidades(fichas)
    grupos = defaultdict(list)
    for f in fichas:
        grupos[ident[f["name"]]].append(f)

    def clave_de(sociedad, codigo):
        ficha = next((f for f in fichas if f["company_code"] == sociedad and f["code"] == codigo), None)
        # Un código sin ficha en Sage se queda con su pareja, igual que el panel.
        return ident[ficha["name"]] if ficha else f"{sociedad}-{codigo}"

    print(f"B) {len(fichas)} fichas de comercial en Sage -> {len(grupos)} personas.")
    print("   Las que el panel junta en una sola:")
    for persona, suyas in sorted(grupos.items()):
        if len(suyas) > 1:
            print(f"   {persona[:34]:34s} <- " + " | ".join(f"soc{f['company_code']}:{f['code']}" for f in suyas))
            if len({llano(f["name"]).split()[0] for f in suyas}) > 1:
                print("      OJO: nombres de pila distintos en el mismo grupo. Revísalo.")

    problemas = sum(auditar(anio, fichas, clave_de, grupos) for anio in años)
    print(f"\n{'Todo cuadra.' if problemas == 0 else f'{problemas} descuadres que mirar.'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
