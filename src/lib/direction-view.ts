export type DirectionDepartment = "commercial" | "it" | "marketing";

const STORAGE_KEY = "intec-direction-view-as";
const VALID: DirectionDepartment[] = ["commercial", "it", "marketing"];

export function getDirectionViewAs(): DirectionDepartment | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(STORAGE_KEY);
  return VALID.includes(value as DirectionDepartment) ? (value as DirectionDepartment) : null;
}

export function setDirectionViewAs(value: DirectionDepartment | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(STORAGE_KEY, value);
  else window.localStorage.removeItem(STORAGE_KEY);
}
