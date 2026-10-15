// The menu each person sees, by role. Labels are also what the bot matches incoming text against.
import { canReviewInvoices } from "@/lib/orchestrator/review-card";
import { canManageInvoices, isMember, isReviewer, isSigner, isVendor, type Person } from "@/lib/orchestrator/people";

export const MENU = {
  aportar: "Aportar",
  gastos: "¿En qué se gastó?",
  misAportes: "Mis aportes",
  cargarFactura: "Cargar factura",
  pendientes: "Pagos pendientes",
  proponer: "Proponer cambio",
  revisar: "Revisar rendición",
  revisarFacturas: "Facturas para revisar",
  crearFirma: "Crear mi firma",
  misCobros: "Mis cobros",
} as const;

export type MenuAction = keyof typeof MENU;

type MenuPerson = Pick<Person, "roles" | "safeAddress">;

export function menuActions(p: MenuPerson): MenuAction[] {
  const actions: MenuAction[] = [];
  if (isMember(p)) actions.push("aportar", "gastos", "misAportes");
  if (canManageInvoices(p)) actions.push("cargarFactura", "pendientes", "proponer");
  if (isReviewer(p)) actions.push("revisar");
  if (canReviewInvoices(p)) actions.push("revisarFacturas");
  if (isSigner(p) && !p.safeAddress) actions.push("crearFirma");
  if (isVendor(p)) actions.push("misCobros");
  return actions;
}

/** Keyboard rows, two buttons per row. */
export function menuKeyboard(p: MenuPerson): { menu: string[][] } {
  const labels = menuActions(p).map((a) => MENU[a]);
  const rows: string[][] = [];
  for (let i = 0; i < labels.length; i += 2) rows.push(labels.slice(i, i + 2));
  return { menu: rows };
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.]/g, "")
    .trim()
    .toLowerCase();

const BY_LABEL = new Map(Object.entries(MENU).map(([k, v]) => [norm(v), k as MenuAction]));

/** The menu action a text corresponds to, if any (tolerant to accents and punctuation). */
export function matchMenu(text: string): MenuAction | null {
  return BY_LABEL.get(norm(text)) ?? null;
}
