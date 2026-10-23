import { Fragment, type ReactNode } from "react";

/*
  La respuesta del chat, con sus tablas y sus negritas puestas.

  El modelo contesta en Markdown y lo que más importa —la tabla de opciones
  con su precio— llegaba como un montón de barras verticales:

    | Modelo | Referencia | Precio |
    |---|---|---|
    | SILTEK 20 | 8216060NUA | 598 € |

  Esto la convierte en una tabla de verdad. No hay librería de Markdown en el
  proyecto y no merece añadir uno entero: aquí solo hace falta lo que el chat
  usa —tablas, negritas, listas y párrafos— y está acotado por sus propias
  instrucciones.

  Todo se construye como nodos de React, nunca inyectando HTML: lo que
  devuelve un modelo es texto de fuera, y en esta aplicación no hay un solo
  dangerouslySetInnerHTML. No va a empezar por aquí.
*/

/** Las **negritas**, que el modelo usa para el dato que importa. */
function conNegritas(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((trozo, i) =>
    trozo.startsWith("**") && trozo.endsWith("**") && trozo.length > 4
      ? <strong key={i}>{trozo.slice(2, -2)}</strong>
      : <Fragment key={i}>{trozo}</Fragment>);
}

const esSeparadora = (linea: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(linea) && linea.includes("-");
const esFila = (linea: string) => linea.trim().startsWith("|") && linea.trim().endsWith("|");

function celdasDe(linea: string): string[] {
  return linea.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

export function RespuestaFormateada({ texto }: { texto: string }) {
  const lineas = texto.split("\n");
  const bloques: ReactNode[] = [];
  let parrafo: string[] = [];
  let lista: string[] = [];

  const cerrarParrafo = () => {
    if (parrafo.length === 0) return;
    bloques.push(<p key={`p${bloques.length}`}>{conNegritas(parrafo.join(" "))}</p>);
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista.length === 0) return;
    bloques.push(
      <ul key={`u${bloques.length}`}>
        {lista.map((item, i) => <li key={i}>{conNegritas(item)}</li>)}
      </ul>);
    lista = [];
  };

  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];

    // Una tabla: la cabecera, la separadora y las filas que vengan detrás.
    if (esFila(linea) && i + 1 < lineas.length && esSeparadora(lineas[i + 1])) {
      cerrarParrafo();
      cerrarLista();
      const cabecera = celdasDe(linea);
      const filas: string[][] = [];
      i += 2;
      while (i < lineas.length && esFila(lineas[i])) {
        filas.push(celdasDe(lineas[i]));
        i += 1;
      }
      i -= 1;
      bloques.push(
        <div className="table-scroll" key={`t${bloques.length}`}>
          <table className="catalogos-tabla">
            <thead><tr>{cabecera.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>
              {filas.map((fila, j) => (
                <tr key={j}>{cabecera.map((_, k) => <td key={k}>{conNegritas(fila[k] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>);
      continue;
    }

    const punto = linea.match(/^\s*[-*]\s+(.*)$/);
    if (punto) {
      cerrarParrafo();
      lista.push(punto[1]);
      continue;
    }

    if (!linea.trim()) {
      cerrarParrafo();
      cerrarLista();
      continue;
    }

    cerrarLista();
    parrafo.push(linea.trim());
  }
  cerrarParrafo();
  cerrarLista();

  return <div className="catalogos-texto">{bloques}</div>;
}
