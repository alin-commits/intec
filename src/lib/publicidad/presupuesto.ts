/**
 * Qué presupuesto enseñar cuando una campaña de la aplicación está atada a
 * varias de la plataforma.
 *
 * Casi nunca corren a la vez: se para una y se lanza otra con el creativo
 * nuevo. La de PREVENTA tenía dos de 20 €/día —una del 28/09 ya parada y otra
 * del 14/10 viva— y sumarlas decía 40 €/día, un presupuesto que no ha existido
 * nunca.
 *
 * Los dos tipos no se tratan igual, porque al lado del gasto acumulado que
 * enseña la tarjeta no significan lo mismo:
 *
 *  · El diario es un ritmo: vale el de las que están corriendo. Si ya no corre
 *    ninguna, el de la última tanda, que es lo que gastaba al final.
 *  · El total es un tope de toda la campaña: ahí sí se suman las tandas,
 *    porque el gasto con el que se compara también las suma.
 */

export type CampanaDePlataforma = {
  status: unknown;
  started_at: unknown;
  daily_budget: unknown;
  lifetime_budget: unknown;
};

export type PresupuestoPlataforma = { diario: number | null; total: number | null };

const esViva = (estado: unknown) => String(estado ?? "").toUpperCase() === "ACTIVE";
const aNumero = (valor: unknown) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
};

function suma(campanas: CampanaDePlataforma[], campo: "daily_budget" | "lifetime_budget"): number | null {
  return campanas.reduce<number | null>((total, campana) => {
    const valor = aNumero(campana[campo]);
    return valor === null ? total : (total ?? 0) + valor;
  }, null);
}

export function presupuestoDeCampana(metas: CampanaDePlataforma[]): PresupuestoPlataforma {
  if (metas.length === 0) return { diario: null, total: null };

  const vivas = metas.filter((meta) => esViva(meta.status));
  let paraElDiario = vivas;
  if (paraElDiario.length === 0) {
    // La última tanda: las que arrancaron el día más reciente. Si varias
    // arrancaron juntas, sí se suman: esas sí corrían a la vez.
    const ultimoArranque = metas.reduce((masReciente, meta) => {
      const cuando = String(meta.started_at ?? "");
      return cuando > masReciente ? cuando : masReciente;
    }, "");
    paraElDiario = metas.filter((meta) => String(meta.started_at ?? "") === ultimoArranque);
  }

  return { diario: suma(paraElDiario, "daily_budget"), total: suma(metas, "lifetime_budget") };
}
