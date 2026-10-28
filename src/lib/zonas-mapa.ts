/*
  Lo que el mapa de zonas necesita saber en el navegador.

  El contorno de cada provincia está en zonas-svg.ts, que es un fichero
  generado y no se edita a mano. Aquí van las dos cosas que sí son decisiones:
  cómo se llama cada provincia y cuánto se tiñe según lo que tenga.
*/

/** El nombre de cada provincia por su código, el mismo que empieza su código postal. */
export const NOMBRES_DE_PROVINCIA: Record<string, string> = {
  "01": "Álava", "02": "Albacete", "03": "Alicante", "04": "Almería",
  "05": "Ávila", "06": "Badajoz", "07": "Baleares", "08": "Barcelona",
  "09": "Burgos", "10": "Cáceres", "11": "Cádiz", "12": "Castellón",
  "13": "Ciudad Real", "14": "Córdoba", "15": "A Coruña", "16": "Cuenca",
  "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa",
  "21": "Huelva", "22": "Huesca", "23": "Jaén", "24": "León",
  "25": "Lleida", "26": "La Rioja", "27": "Lugo", "28": "Madrid",
  "29": "Málaga", "30": "Murcia", "31": "Navarra", "32": "Ourense",
  "33": "Asturias", "34": "Palencia", "35": "Las Palmas", "36": "Pontevedra",
  "37": "Salamanca", "38": "Santa Cruz de Tenerife", "39": "Cantabria", "40": "Segovia",
  "41": "Sevilla", "42": "Soria", "43": "Tarragona", "44": "Teruel",
  "45": "Toledo", "46": "Valencia", "47": "Valladolid", "48": "Bizkaia",
  "49": "Zamora", "50": "Zaragoza", "51": "Ceuta", "52": "Melilla",
};

/**
 * Cuánto se tiñe una provincia, de 0 a 1.
 *
 * Con raíz cuadrada y no con el valor a secas: Alicante tiene 1.208 clientes
 * y la mayoría de provincias no llegan a 20, así que en escala lineal todo lo
 * que no es Alicante sale blanco y el mapa no dice nada. Lo que se busca es
 * distinguir tener cinco clientes de no tener ninguno.
 */
export function intensidadDeColor(valor: number, maximo: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(maximo)) return 0;
  if (valor <= 0 || maximo <= 0) return 0;
  return Math.min(1, Math.sqrt(valor / maximo));
}
