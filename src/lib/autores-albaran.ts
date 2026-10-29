import type { RepIdentity } from "@/lib/sales-model";

/*
  Quién hace cada albarán frente a quién se lo apunta.

  Un albarán lo hace una persona y la venta se le cuenta al comercial que
  lleva el cliente. Aquí se cruzan las dos cosas para ver cuántos albaranes
  hace un comercial que acaban contando para otro.

  El autor llega como lo resuelve la base ("u:25", el usuario 25 de Sage, o
  "t:1:150", un operador de TPV sin usuario) y en el Hub se apunta qué
  usuarios son de cada comercial: el número de usuario de Sage no es el de
  comercial, así que no se puede deducir.

  Solo se apuntan los comerciales. Todo usuario que no es de ninguno es otro
  empleado —administración, almacén, tienda—, sin tener que decirlo uno a uno:
  en Sage hay decenas de usuarios y comerciales son unos pocos.
*/

/** Lo que devuelve sage_authors_summary: albaranes por mes, autor y comercial asignado. */
export type FilaDeAutor = {
  month: string;
  company_code: number;
  author: string;
  author_name: string;
  rep_code: number | null;
  documents: number;
  net_amount: number;
};

/**
 * De qué comercial es un usuario de Sage (su clave en el panel). Lo que no
 * tiene comercial es de otro empleado; `is_office` es de cuando había que
 * marcarlo, y cuenta igual que no tener comercial.
 */
export type QuienEs = { author: string; rep_key: string | null; is_office: boolean };

/** Un comercial del panel, ya juntadas sus fichas de las distintas sociedades. */
export type Persona = { key: string; label: string };

export type Cuenta = { documentos: number; neto: number };

export type Destino = Cuenta & { key: string; label: string };

/**
 * Un comercial, por las dos caras: lo que hace y lo que entra en su
 * facturación. No coinciden porque muchos clientes ya tienen comercial: un
 * albarán que hace uno para un cliente de otro cuenta en la facturación del
 * otro.
 */
export type FilaDeComercial = {
  key: string;
  label: string;
  /** Los albaranes que hace él. */
  hechos: Cuenta;
  /** De los que hace, los que van a su facturación. */
  propios: Cuenta;
  /** De los que hace, los que se facturan a otro comercial. Es lo que se quiere ver. */
  paraOtros: Cuenta;
  /** De los que hace, los de clientes sin comercial o con un código comodín de Sage. */
  sinComercial: Cuenta;
  /** A qué otros comerciales, de más a menos albaranes. */
  aQuien: Destino[];
  /** Todo lo que entra en su facturación, lo haya hecho quien sea. */
  enSuFacturacion: Cuenta;
  /**
   * De lo que entra en su facturación, lo que hizo otro: otro comercial u
   * oficina. Lo de usuarios sin decir quiénes son no cuenta aquí: no se sabe
   * si fue él.
   */
  hechosPorOtros: Cuenta;
  /** Quién le hizo esos, de más a menos. */
  deQuien: Destino[];
};

export type RepartoDeAutores = {
  comerciales: FilaDeComercial[];
  /** Lo que hacen los demás empleados (los usuarios que no son de ningún comercial), y a quién se le apunta. */
  otros: { hechos: Cuenta; aComerciales: Cuenta; sinComercial: Cuenta; aQuien: Destino[] };
  /** Albaranes que Sage guardó sin usuario ni operador. */
  sinAutor: Cuenta;
  total: Cuenta;
};

/** Cada autor que se ha visto, con su nombre en Sage y cuántos albaranes hizo. */
export type AutorVisto = Cuenta & { author: string; nombre: string };

const SIN_AUTOR = "desconocido";
/** Los demás empleados, entre los que hacen albaranes para un comercial. */
const OTROS = { key: "otros", label: "Otros empleados" };

const vacia = (): Cuenta => ({ documentos: 0, neto: 0 });

function sumar(cuenta: Cuenta, fila: FilaDeAutor) {
  cuenta.documentos += Number(fila.documents);
  cuenta.neto += Number(fila.net_amount);
}

function sumarA(destinos: Map<string, Destino>, quien: { key: string; label: string }, fila: FilaDeAutor) {
  const destino = destinos.get(quien.key) ?? { key: quien.key, label: quien.label, ...vacia() };
  sumar(destino, fila);
  destinos.set(quien.key, destino);
}

const deMasAMenos = (destinos: Map<string, Destino>) =>
  [...destinos.values()].sort((a, b) => b.documentos - a.documentos || b.neto - a.neto);

/**
 * Reparte los albaranes por quién los hizo y a quién se le facturan.
 *
 * Un albarán es «para otro» cuando se le apunta a otro comercial de verdad.
 * Los que van sin comercial, o a un código comodín ("GENERAL", "SAT INTEC"),
 * van aparte: no son de nadie, así que tampoco se le quitan a nadie.
 *
 * Sale una fila por cada comercial que hace albaranes o que los tiene en su
 * facturación: uno que no hace ninguno pero al que se los hacen otros también
 * tiene que verse.
 */
export function repartirAutores(
  filas: FilaDeAutor[],
  quienEs: QuienEs[],
  repOf: (companyCode: number, repCode: number | null) => RepIdentity,
  nombreDe: (key: string) => string,
): RepartoDeAutores {
  const asignados = new Map(quienEs.map((fila) => [fila.author, fila]));
  type Acumulada = FilaDeComercial & { destinos: Map<string, Destino>; origenes: Map<string, Destino> };
  const comerciales = new Map<string, Acumulada>();
  const filaDe = (key: string): Acumulada => {
    const fila = comerciales.get(key) ?? {
      key, label: nombreDe(key),
      hechos: vacia(), propios: vacia(), paraOtros: vacia(), sinComercial: vacia(), aQuien: [],
      enSuFacturacion: vacia(), hechosPorOtros: vacia(), deQuien: [],
      destinos: new Map<string, Destino>(), origenes: new Map<string, Destino>(),
    };
    comerciales.set(key, fila);
    return fila;
  };
  const otros = { hechos: vacia(), aComerciales: vacia(), sinComercial: vacia(), destinos: new Map<string, Destino>() };
  const sinAutor = vacia();
  const total = vacia();

  for (const fila of filas) {
    sumar(total, fila);
    const credito = repOf(fila.company_code, fila.rep_code);
    const deUnComercial = credito.assigned && credito.isPerson;
    const sinAutorEnSage = fila.author === SIN_AUTOR;
    // El comercial que lo hizo, si lo hizo uno; si no, nulo: otro empleado.
    const comercialAutor = sinAutorEnSage ? null : asignados.get(fila.author)?.rep_key ?? null;

    // La cara de la facturación: a quién cuenta, y si se lo hizo otro.
    if (deUnComercial) {
      const suya = filaDe(credito.key);
      sumar(suya.enSuFacturacion, fila);
      // Sin usuario en Sage no se sabe quién fue: no cuenta como hecho por otro.
      const autor = sinAutorEnSage ? null : comercialAutor ? { key: comercialAutor, label: nombreDe(comercialAutor) } : OTROS;
      if (autor && autor.key !== credito.key) {
        sumar(suya.hechosPorOtros, fila);
        sumarA(suya.origenes, autor, fila);
      }
    }

    // La cara de quién lo hizo.
    if (sinAutorEnSage) {
      sumar(sinAutor, fila);
      continue;
    }
    if (!comercialAutor) {
      sumar(otros.hechos, fila);
      if (deUnComercial) {
        sumar(otros.aComerciales, fila);
        sumarA(otros.destinos, credito, fila);
      } else sumar(otros.sinComercial, fila);
      continue;
    }

    const key = comercialAutor;
    const comercial = filaDe(key);
    sumar(comercial.hechos, fila);
    if (credito.key === key) sumar(comercial.propios, fila);
    else if (deUnComercial) {
      sumar(comercial.paraOtros, fila);
      sumarA(comercial.destinos, credito, fila);
    } else sumar(comercial.sinComercial, fila);
  }

  return {
    comerciales: [...comerciales.values()]
      .map(({ destinos, origenes, ...comercial }) => ({ ...comercial, aQuien: deMasAMenos(destinos), deQuien: deMasAMenos(origenes) }))
      .sort((a, b) => b.paraOtros.documentos - a.paraOtros.documentos || b.hechos.documentos - a.hechos.documentos || b.enSuFacturacion.documentos - a.enSuFacturacion.documentos),
    otros: { hechos: otros.hechos, aComerciales: otros.aComerciales, sinComercial: otros.sinComercial, aQuien: deMasAMenos(otros.destinos) },
    sinAutor,
    total,
  };
}

/** Los autores que salen en estas filas, de más a menos albaranes. Sin «sin autor»: ese no se puede asignar. */
export function autoresVistos(filas: FilaDeAutor[]): AutorVisto[] {
  const vistos = new Map<string, AutorVisto>();
  for (const fila of filas) {
    if (fila.author === SIN_AUTOR) continue;
    const autor = vistos.get(fila.author) ?? { author: fila.author, nombre: fila.author_name, ...vacia() };
    sumar(autor, fila);
    vistos.set(fila.author, autor);
  }
  return [...vistos.values()].sort((a, b) => b.documentos - a.documentos);
}

/**
 * Los operadores del TPV que son un comisionista, enlazados solos.
 *
 * En la tienda, cada comercial tiene de operador el mismo número que de
 * comisionista: el operador 150 de la sociedad 1 es el comisionista 150. Se
 * enlaza cuando coinciden el número y también el nombre —alguna palabra de
 * cuatro letras o más—, para que un operador que reutilice el número de otro
 * no se cuele. Los usuarios de Sage no siguen esa regla (el usuario 24 no es
 * el comisionista 24) y se eligen a mano.
 *
 * Lo que se apunte a mano manda sobre esto: también quitarle el enlace.
 */
export function enlacesPorNumero(
  autores: { author: string; nombre: string }[],
  repOf: (companyCode: number, repCode: number | null) => RepIdentity,
): QuienEs[] {
  const enlaces: QuienEs[] = [];
  for (const autor of autores) {
    const tpv = /^t:(\d+):(\d+)$/.exec(autor.author);
    if (!tpv) continue;
    const comisionista = repOf(Number(tpv[1]), Number(tpv[2]));
    if (!comisionista.isPerson) continue;
    const suyas = new Set(llano(comisionista.label).split(/[^A-Z]+/).filter((palabra) => palabra.length >= 4));
    const casa = llano(autor.nombre).split(/[^A-Z]+/).some((palabra) => suyas.has(palabra));
    if (casa) enlaces.push({ author: autor.author, rep_key: comisionista.key, is_office: false });
  }
  return enlaces;
}

/** "Usuario 25 de Sage" o "TPV de la sociedad 1, operador 150": de dónde sale el autor. */
export function origenDelAutor(author: string): string {
  const usuario = /^u:(\d+)$/.exec(author);
  if (usuario) return `Usuario ${usuario[1]} de Sage`;
  const tpv = /^t:(\d+):(.+)$/.exec(author);
  if (tpv) return `TPV de la sociedad ${tpv[1]}, operador ${tpv[2]}`;
  return author;
}

const llano = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/**
 * El comercial que más se parece a un usuario de Sage, para proponerlo.
 *
 * Solo es una propuesta: hay que confirmarla, porque un nombre de usuario dice
 * poco. Cuenta las palabras del comercial que salen en el usuario —enteras, o
 * dentro de uno del estilo "JPEREZ" si son largas— y propone al que más tenga.
 * Si dos empatan no propone a ninguno: entre dos Juanes no hay forma de saber.
 */
export function sugerirComercial(nombreDelAutor: string, personas: Persona[]): Persona | null {
  const palabras = llano(nombreDelAutor).split(/[^A-Z]+/).filter((palabra) => palabra.length >= 3);
  if (palabras.length === 0) return null;
  const junto = palabras.join("");
  let mejor: Persona | null = null;
  let mejorNota = 0;
  let empate = false;
  for (const persona of personas) {
    const suyas = llano(persona.label).split(/[^A-Z]+/).filter((palabra) => palabra.length >= 3);
    const nota = suyas.filter((suya) => palabras.includes(suya) || (suya.length >= 5 && junto.includes(suya))).length;
    if (nota === 0) continue;
    if (nota > mejorNota) {
      mejor = persona;
      mejorNota = nota;
      empate = false;
    } else if (nota === mejorNota) empate = true;
  }
  return empate ? null : mejor;
}
