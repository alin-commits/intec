import type { RepIdentity } from "@/lib/sales-model";

/*
  Quién hace cada albarán frente a quién se lo apunta.

  Un albarán lo hace una persona y la venta se le cuenta al comercial que
  lleva el cliente. Aquí se cruzan las dos cosas para ver cuántos albaranes
  hace un comercial que acaban contando para otro.

  El autor llega como lo resuelve la base ("u:25", el usuario 25 de Sage, o
  "t:1:150", un operador de TPV sin usuario) y quién es cada uno lo apunta
  alguien en el Hub: el número de usuario de Sage no es el de comercial, así
  que no se puede deducir.
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

/** Quién es un autor: un comercial (su clave en el panel) o la oficina. */
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

export type AutorSinDecir = Cuenta & { author: string; nombre: string };

export type RepartoDeAutores = {
  comerciales: FilaDeComercial[];
  /** Lo que hacen oficina y tienda, y a quién se le apunta. */
  oficina: { hechos: Cuenta; aComerciales: Cuenta; sinComercial: Cuenta; aQuien: Destino[] };
  /** Autores que nadie ha dicho todavía quiénes son. */
  sinDecir: AutorSinDecir[];
  /** Albaranes que Sage guardó sin usuario ni operador. */
  sinAutor: Cuenta;
  total: Cuenta;
};

/** Cada autor que se ha visto, con su nombre en Sage y cuántos albaranes hizo. */
export type AutorVisto = Cuenta & { author: string; nombre: string };

const SIN_AUTOR = "desconocido";
/** La clave de la oficina entre los que hacen albaranes para un comercial. */
const OFICINA = "oficina";

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
  const oficina = { hechos: vacia(), aComerciales: vacia(), sinComercial: vacia(), destinos: new Map<string, Destino>() };
  const sinDecir = new Map<string, AutorSinDecir>();
  const sinAutor = vacia();
  const total = vacia();

  for (const fila of filas) {
    sumar(total, fila);
    const credito = repOf(fila.company_code, fila.rep_code);
    const deUnComercial = credito.assigned && credito.isPerson;
    const quien = fila.author === SIN_AUTOR ? undefined : asignados.get(fila.author);

    // La cara de la facturación: a quién cuenta, y si se lo hizo otro.
    if (deUnComercial) {
      const suya = filaDe(credito.key);
      sumar(suya.enSuFacturacion, fila);
      const autor = quien?.is_office ? { key: OFICINA, label: "Oficina y tienda" } : quien?.rep_key ? { key: quien.rep_key, label: nombreDe(quien.rep_key) } : null;
      if (autor && autor.key !== credito.key) {
        sumar(suya.hechosPorOtros, fila);
        sumarA(suya.origenes, autor, fila);
      }
    }

    // La cara de quién lo hizo.
    if (fila.author === SIN_AUTOR) {
      sumar(sinAutor, fila);
      continue;
    }

    if (quien?.is_office) {
      sumar(oficina.hechos, fila);
      if (deUnComercial) {
        sumar(oficina.aComerciales, fila);
        sumarA(oficina.destinos, credito, fila);
      } else sumar(oficina.sinComercial, fila);
      continue;
    }
    if (!quien?.rep_key) {
      const autor = sinDecir.get(fila.author) ?? { author: fila.author, nombre: fila.author_name, ...vacia() };
      sumar(autor, fila);
      sinDecir.set(fila.author, autor);
      continue;
    }

    const key = quien.rep_key;
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
    oficina: { hechos: oficina.hechos, aComerciales: oficina.aComerciales, sinComercial: oficina.sinComercial, aQuien: deMasAMenos(oficina.destinos) },
    sinDecir: [...sinDecir.values()].sort((a, b) => b.documentos - a.documentos),
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
