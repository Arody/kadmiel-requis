"use client";

import type { User } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  createBrowserSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type ViewId =
  | "Dashboard"
  | "Solicitudes"
  | "Compras"
  | "Recepciones"
  | "Inventario"
  | "Traspasos"
  | "Merma"
  | "Catalogo"
  | "Produccion";

type UserRoleName = "super_admin" | "branch_admin" | "operative" | "app_user";
type RequisitionRequestType = "ordinaria" | "urgente" | "programada";
type RequisitionStatus = "pendiente" | "aprobado" | "rechazado" | "completado" | "cancelado";
type PurchaseOrderStatus = "pendiente" | "urgente" | "aprobado" | "completado" | "cancelado" | "parcial";

type UserRole = {
  role: UserRoleName;
  sucursal: string;
  department: string | null;
  area: string | null;
};

type LocationRow = {
  id: string;
  name: string;
  address: string | null;
};

type ProductRow = {
  id: string;
  product: string;
  unit: string | null;
  unit_price: number | string | null;
  total_price: number | string | null;
  brand: string | null;
  presentation: string | null;
  image_url: string | null;
  almacen: string | null;
  location_id: string | null;
};

type RequisitionDraftItem = {
  clientId: string;
  itemId?: string | null;
  productId: string;
  quantity: string;
  notes: string;
  product: ProductRow;
};

type SupplyArea = {
  id: string;
  location_id: string;
  location_name: string;
  name: string;
  active: boolean;
};

type SupplyRequisition = {
  id: string;
  folio: string;
  location_id: string;
  location_name: string;
  area_id: string | null;
  area_name: string | null;
  request_type: RequisitionRequestType;
  status: RequisitionStatus;
  needed_by: string | null;
  notes: string | null;
  requested_by: string;
  requested_by_name: string;
  created_at: string;
  items_count: number;
  estimated_total: number | string;
};

type SupplyRequisitionItem = {
  id: string;
  product_id: string;
  product: string;
  brand: string | null;
  presentation: string | null;
  image_url: string | null;
  quantity: number | string;
  unit: string | null;
  notes: string | null;
  unit_price: number | string | null;
  total_price: number | string | null;
  line_total: number | string;
  almacen: string | null;
};

type SupplyRequisitionDetail = SupplyRequisition & {
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  updated_at: string;
  items: SupplyRequisitionItem[];
};

type PurchaseOrderRow = {
  id: string;
  folio: string;
  requisition_id: string;
  requisition_folio: string;
  location_id: string;
  location_name: string;
  request_type: RequisitionRequestType;
  requisition_status: RequisitionStatus;
  status: PurchaseOrderStatus;
  needed_by: string | null;
  notes: string | null;
  requested_by: string;
  requested_by_name: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  created_at: string;
  items_count: number;
  estimated_total: number | string;
};

type PurchaseOrderDetail = PurchaseOrderRow & {
  area_id: string | null;
  area_name: string | null;
  requisition_approved_at: string | null;
  updated_at: string;
  items: SupplyRequisitionItem[];
};

type SampleRecord = Record<string, string | number | boolean>;

const NAV_ITEMS: Array<{ id: ViewId; label: string; icon: string; tag?: string }> = [
  { id: "Dashboard", label: "Inicio", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { id: "Solicitudes", label: "Requisiciones", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { id: "Compras", label: "Compras", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" },
  { id: "Recepciones", label: "Recepciones", icon: "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" },
  { id: "Inventario", label: "Inventario", icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" },
  { id: "Traspasos", label: "Traspasos", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" },
  { id: "Merma", label: "Merma", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
  { id: "Catalogo", label: "Catálogo", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
  { id: "Produccion", label: "Producción", icon: "M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2", tag: "Operaciones Terán" },
];

const STATUS: Record<string, { label: string; className: string }> = {
  pendiente: { label: "Pendiente", className: "bg-amber-100 text-amber-700" },
  aprobado: { label: "Aprobado", className: "bg-emerald-100 text-emerald-700" },
  recibido: { label: "Recibido", className: "bg-blue-100 text-blue-700" },
  completado: { label: "Completado", className: "bg-emerald-100 text-emerald-700" },
  parcial: { label: "Parcial", className: "bg-violet-100 text-violet-700" },
  urgente: { label: "Urgente", className: "bg-red-100 text-red-700" },
  en_transito: { label: "En tránsito", className: "bg-blue-100 text-blue-700" },
  rechazado: { label: "Rechazado", className: "bg-red-100 text-red-700" },
  cancelado: { label: "Cancelado", className: "bg-stone-200 text-stone-600" },
  ordinaria: { label: "Ordinaria", className: "bg-stone-100 text-stone-600" },
  programada: { label: "Programada", className: "bg-sky-100 text-sky-700" },
  caducidad: { label: "Caducidad", className: "bg-amber-100 text-amber-700" },
  merma: { label: "Merma", className: "bg-red-100 text-red-700" },
};

const REQUEST_TYPE_OPTIONS: Array<[RequisitionRequestType, string]> = [
  ["ordinaria", "Ordinaria"],
  ["urgente", "Urgente"],
  ["programada", "Programada"],
];

const REQUISITION_STATUS_OPTIONS: Array<[RequisitionStatus, string]> = [
  ["pendiente", "Pendiente"],
  ["aprobado", "Aprobado"],
  ["rechazado", "Rechazado"],
  ["completado", "Completado"],
  ["cancelado", "Cancelado"],
];

const PURCHASE_ORDER_STATUS_OPTIONS: Array<[PurchaseOrderStatus, string]> = [
  ["pendiente", "Pendiente"],
  ["urgente", "Urgente"],
  ["aprobado", "Aprobada"],
  ["completado", "Completada"],
  ["cancelado", "Cancelada"],
];

const APP_LOCALE = "es-MX";
const APP_TIME_ZONE = "America/Mexico_City";

const SAMPLE_RECEPCIONES: SampleRecord[] = [
  { folio: "REC-001", proveedor: "Lácteos San Juan", sucursal: "San Cristobal", estado: "recibido", diferencias: false },
  { folio: "REC-002", proveedor: "Harinera del Bajío", sucursal: "Teran", estado: "parcial", diferencias: true },
  { folio: "REC-003", proveedor: "Café Origen MX", sucursal: "Aeropuerto", estado: "recibido", diferencias: false },
];

const SAMPLE_TRASPASOS: SampleRecord[] = [
  { folio: "TRP-001", origen: "Teran", destino: "Aeropuerto", insumo: "Pan artesanal", cantidad: "40 pzas", estado: "en_transito" },
  { folio: "TRP-002", origen: "Teran", destino: "San Cristobal", insumo: "Repostería surtida", cantidad: "25 pzas", estado: "completado" },
  { folio: "TRP-003", origen: "San Cristobal", destino: "Aeropuerto", insumo: "Café espresso", cantidad: "2 kg", estado: "completado" },
];

const SAMPLE_MERMA: SampleRecord[] = [
  { folio: "MRM-001", sucursal: "San Cristobal", insumo: "Leche entera", cantidad: "3 lt", tipo: "caducidad", valor: 66 },
  { folio: "MRM-002", sucursal: "Teran", insumo: "Levadura fresca", cantidad: "1.5 kg", tipo: "merma", valor: 67.5 },
  { folio: "MRM-003", sucursal: "Aeropuerto", insumo: "Pan artesanal", cantidad: "8 pzas", tipo: "caducidad", valor: 120 },
];

export default function SupplyOsApp() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [areas, setAreas] = useState<SupplyArea[]>([]);
  const [requisitions, setRequisitions] = useState<SupplyRequisition[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [view, setView] = useState<ViewId>("Dashboard");
  const [selectedLocation, setSelectedLocation] = useState("Todas");
  const [loading, setLoading] = useState(Boolean(supabase));
  const [dataError, setDataError] = useState<string | null>(null);

  const loadWorkspace = useCallback(
    async (activeUserId: string) => {
      if (!supabase) return;
      setDataError(null);

      const [roleRes, locationRes, productRes, areaRes, reqRes, purchaseRes] = await Promise.all([
        supabase.from("user_roles").select("role,sucursal,department,area").eq("user_id", activeUserId).limit(1),
        supabase.from("locations").select("id,name,address").in("name", ["Teran", "San Cristobal", "Aeropuerto"]).order("name"),
        supabase.from("inventory").select("id,product,unit,unit_price,total_price,brand,presentation,image_url,almacen,location_id").order("product", { ascending: true }).limit(1000),
        supabase.rpc("list_abastecimiento_areas"),
        supabase.rpc("list_abastecimiento_requisitions"),
        supabase.rpc("list_abastecimiento_purchase_orders"),
      ]);

      const firstError = roleRes.error ?? locationRes.error ?? productRes.error ?? areaRes.error ?? reqRes.error ?? purchaseRes.error;
      if (firstError) setDataError(firstError.message);

      setRole((roleRes.data?.[0] as UserRole | undefined) ?? null);
      setLocations((locationRes.data as LocationRow[] | null) ?? []);
      setProducts((productRes.data as ProductRow[] | null) ?? []);
      setAreas((areaRes.data as SupplyArea[] | null) ?? []);
      setRequisitions((reqRes.data as SupplyRequisition[] | null) ?? []);
      setPurchaseOrders((purchaseRes.data as PurchaseOrderRow[] | null) ?? []);
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) await loadWorkspace(sessionUser.id);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) void loadWorkspace(sessionUser.id);
      if (!sessionUser) {
        setRole(null);
        setRequisitions([]);
        setPurchaseOrders([]);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadWorkspace, supabase]);

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen supabase={supabase} onSignedIn={setUser} />;

  const pendingCount = requisitions.filter((req) => req.status === "pendiente").length;

  return (
    <div className="flex h-dvh overflow-hidden bg-[#F7F3EE] text-stone-950">
      <aside className="hidden w-[220px] shrink-0 flex-col overflow-hidden border-r border-[#2D2926] bg-[#1C1917] lg:flex">
        <SidebarLogo />
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {NAV_ITEMS.map((item, index) => (
            <div key={item.id}>
              {item.tag && NAV_ITEMS[index - 1]?.tag !== item.tag ? (
                <div className="mx-1 mb-2 mt-3 border-t border-[#2D2926] pt-3">
                  <p className="px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#9B8F84]">{item.tag}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setView(item.id)}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition ${
                  view === item.id ? "bg-white/10 font-bold text-white" : "font-medium text-[#C9BFB8] hover:bg-white/[0.04]"
                }`}
              >
                <Icon path={item.icon} active={view === item.id} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.id === "Solicitudes" && pendingCount > 0 ? (
                  <span className="rounded-full bg-[#B45309] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingCount}</span>
                ) : null}
              </button>
            </div>
          ))}
        </nav>
        <UserPanel user={user} role={role} onSignOut={() => supabase?.auth.signOut()} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          view={view}
          locations={locations}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          setView={setView}
          pendingCount={pendingCount}
        />
        {dataError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 md:px-7">{dataError}</div>
        ) : null}
        <main className="flex-1 overflow-y-auto p-4 md:p-7">
          {view === "Dashboard" && (
            <Dashboard
              products={products}
              locations={locations}
              requisitions={requisitions}
              selectedLocation={selectedLocation}
              onNav={setView}
            />
          )}
          {view === "Solicitudes" && (
            <RequisitionsView
              supabase={supabase}
              areas={areas}
              products={products}
              locations={locations}
              requisitions={filterByLocation(requisitions, selectedLocation)}
              role={role}
              selectedLocation={selectedLocation}
              reload={() => loadWorkspace(user.id)}
            />
          )}
          {view === "Inventario" && <InventoryView products={products} selectedLocation={selectedLocation} />}
          {view === "Catalogo" && <CatalogView products={products} />}
          {view === "Compras" && (
            <PurchasesView
              supabase={supabase}
              purchaseOrders={filterByLocation(purchaseOrders, selectedLocation)}
              role={role}
              reload={() => loadWorkspace(user.id)}
              selectedLocation={selectedLocation}
            />
          )}
          {view === "Recepciones" && (
            <SimpleOpsView title="Recepción de mercancía" subtitle="Validación física y documental de entregas" records={filterSample(SAMPLE_RECEPCIONES, selectedLocation, "sucursal")} columns={["folio", "proveedor", "sucursal", "diferencias", "estado"]} />
          )}
          {view === "Traspasos" && (
            <SimpleOpsView
              title="Traspasos entre sucursales"
              subtitle="Distribución interna entre sedes y áreas"
              records={SAMPLE_TRASPASOS.filter((item) => selectedLocation === "Todas" || item.origen === selectedLocation || item.destino === selectedLocation)}
              columns={["folio", "origen", "destino", "insumo", "cantidad", "estado"]}
            />
          )}
          {view === "Merma" && (
            <SimpleOpsView title="Merma y caducidad" subtitle="Registro y análisis de pérdidas operativas" records={filterSample(SAMPLE_MERMA, selectedLocation, "sucursal")} columns={["folio", "sucursal", "insumo", "cantidad", "tipo", "valor"]} />
          )}
          {view === "Produccion" && <ProductionView areas={areas.filter((area) => normalize(area.location_name) === "teran")} />}
        </main>
      </section>
    </div>
  );
}

function LoginScreen({
  supabase,
  onSignedIn,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  onSignedIn: (user: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    if (data.user) onSignedIn(data.user);
  }

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-[#F7F3EE] text-stone-950 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="hidden min-h-dvh flex-col justify-between bg-[#1C1917] p-10 text-white lg:flex">
        <SidebarLogo large />
        <div className="max-w-md">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-[#D1C9BE]">Abastecimiento operativo</p>
          <h1 className="text-5xl font-extrabold leading-[1.02] tracking-normal">Kadmiel Supply OS</h1>
          <p className="mt-5 text-base leading-7 text-[#C9BFB8]">Requisiciones, compras, recepción, inventario y producción en un solo flujo para Teran, San Cristobal y Aeropuerto.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm text-[#C9BFB8]">
          {["Teran", "San Cristobal", "Aeropuerto"].map((location) => (
            <div key={location} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <div className="mb-2 h-1.5 w-8 rounded-full bg-[#B45309]" />
              {location}
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-5 py-10">
        <form onSubmit={handleSubmit} className="w-full max-w-[420px] rounded-2xl border border-[#E5DED7] bg-white p-7 shadow-[0_18px_60px_rgba(28,25,23,0.08)]">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#B45309] text-white">
              <Icon path={NAV_ITEMS[4].icon} active />
            </div>
            <div>
              <p className="text-base font-extrabold">Kadmiel</p>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">Supply OS</p>
            </div>
          </div>

          <h2 className="text-2xl font-extrabold tracking-normal text-stone-950">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-stone-500">Acceso con correo y contraseña.</p>

          <div className="mt-7 space-y-4">
            <Field label="Correo">
              <input value={email} onChange={(event) => setEmail(event.target.value)} className="field-input" type="email" autoComplete="email" placeholder="correo@kadmiel.mx" required />
            </Field>
            <Field label="Contraseña">
              <div className="relative">
                <input value={password} onChange={(event) => setPassword(event.target.value)} className="field-input pr-11" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" required />
                <button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"} onClick={() => setShowPassword((current) => !current)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-100 hover:text-stone-900">
                  <EyeIcon crossed={!showPassword} />
                </button>
              </div>
            </Field>
          </div>

          {!isSupabaseConfigured ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para conectar el login.</p> : null}
          {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
          <button type="submit" disabled={!supabase || submitting} className="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-[#B45309] text-sm font-bold text-white transition hover:bg-[#963f08] disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({
  products,
  locations,
  requisitions,
  selectedLocation,
  onNav,
}: {
  products: ProductRow[];
  locations: LocationRow[];
  requisitions: SupplyRequisition[];
  selectedLocation: string;
  onNav: (view: ViewId) => void;
}) {
  const visibleReqs = filterByLocation(requisitions, selectedLocation);
  const pending = visibleReqs.filter((req) => req.status === "pendiente");
  const urgent = visibleReqs.filter((req) => req.request_type === "urgente");
  const now = new Date();

  return (
    <div>
      <PageHeader title="Inicio" subtitle={`Resumen operativo · ${formatDashboardDate(now)}`} />
      <div className="mb-6 mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Productos maestros" value={products.length} sub="public.inventory" />
        <KpiCard label="Sucursales" value={locations.length} sub="public.locations" />
        <KpiCard label="Requis pendientes" value={pending.length} sub="sin aprobar" alert={pending.length > 0} />
        <KpiCard label="Urgentes" value={urgent.length} sub="prioridad operativa" accent />
        <KpiCard label="Schema" value="15" sub="tablas en abastecimiento" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <SectionHeader title="Requisiciones recientes" actionLabel="Ver requisiciones" onAction={() => onNav("Solicitudes")} />
          {visibleReqs.length > 0 ? (
            <div className="divide-y divide-[#F3EEE9]">
              {visibleReqs.slice(0, 6).map((req) => (
                <div key={req.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-stone-950">{req.folio}</p>
                    <p className="truncate text-xs text-stone-500">{req.location_name} · {req.area_name ?? "Sin área"} · {req.requested_by_name}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {req.request_type === "urgente" ? <Badge status="urgente" /> : null}
                    <Badge status={req.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Sin requisiciones registradas" />
          )}
        </Card>
        <Card>
          <SectionHeader title="Alertas operativas" actionLabel="Ver inventario" onAction={() => onNav("Inventario")} />
          <div className="space-y-2">
            <AlertRow tone="red" message={`${pending.length} requisiciones pendientes de revisión`} />
            <AlertRow tone="amber" message={`${products.filter((item) => Number(item.unit_price ?? 0) === 0).length} productos maestros sin precio unitario`} />
            <AlertRow tone="amber" message={`${products.filter((item) => !item.location_id).length} productos sin sucursal asignada`} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function RequisitionsView({
  supabase,
  areas,
  products,
  locations,
  requisitions,
  role,
  selectedLocation,
  reload,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  areas: SupplyArea[];
  products: ProductRow[];
  locations: LocationRow[];
  requisitions: SupplyRequisition[];
  role: UserRole | null;
  selectedLocation: string;
  reload: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("todas");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SupplyRequisitionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [generalPdfLoading, setGeneralPdfLoading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const canManageStatus = role?.role === "super_admin" || role?.role === "branch_admin";
  const filtered = requisitions.filter((req) => filter === "todas" || req.status === filter || req.request_type === filter);
  const allFilteredSelected = filtered.length > 0 && filtered.every((req) => selectedIds.includes(req.id));

  async function fetchDetail(requisitionId: string) {
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { data, error } = await supabase.rpc("get_abastecimiento_requisition", { p_requisition_id: requisitionId });
    if (error) throw error;
    return data as SupplyRequisitionDetail;
  }

  async function openDetail(requisitionId: string) {
    setDetailLoadingId(requisitionId);
    setDetailError(null);
    try {
      setDetail(await fetchDetail(requisitionId));
    } catch (loadError) {
      setDetailError(getErrorMessage(loadError));
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function generatePdf(requisitionId: string) {
    setPdfLoadingId(requisitionId);
    setDetailError(null);
    try {
      const pdfDetail = detail?.id === requisitionId ? detail : await fetchDetail(requisitionId);
      await downloadRequisitionPdf(pdfDetail);
    } catch (pdfError) {
      setDetailError(getErrorMessage(pdfError));
    } finally {
      setPdfLoadingId(null);
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => {
      if (current) setSelectedIds([]);
      return !current;
    });
  }

  function toggleRequisitionSelection(requisitionId: string) {
    setSelectedIds((current) =>
      current.includes(requisitionId) ? current.filter((id) => id !== requisitionId) : [...current, requisitionId],
    );
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((current) => {
      if (allFilteredSelected) {
        return current.filter((id) => !filtered.some((req) => req.id === id));
      }

      const next = new Set(current);
      filtered.forEach((req) => next.add(req.id));
      return Array.from(next);
    });
  }

  async function generateGeneralPdf() {
    if (selectedIds.length === 0) {
      setDetailError("Selecciona al menos una requisición para generar el PDF general.");
      return;
    }

    setGeneralPdfLoading(true);
    setDetailError(null);
    try {
      const details = await Promise.all(
        selectedIds.map((requisitionId) => (detail?.id === requisitionId ? Promise.resolve(detail) : fetchDetail(requisitionId))),
      );
      await downloadGeneralRequisitionPdf(details);
    } catch (pdfError) {
      setDetailError(getErrorMessage(pdfError));
    } finally {
      setGeneralPdfLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Solicitudes internas" subtitle="Peticiones de insumos por área y sucursal" />
        <div className="flex flex-wrap gap-2">
          {canManageStatus ? (
            <>
              <Button variant={selectionMode ? "secondary" : "primary"} onClick={toggleSelectionMode}>
                {selectionMode ? "Cancelar selección" : "Requi general"}
              </Button>
              {selectionMode ? (
                <Button disabled={selectedIds.length === 0 || generalPdfLoading} onClick={() => void generateGeneralPdf()}>
                  {generalPdfLoading ? "Generando..." : `PDF general (${selectedIds.length})`}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button onClick={() => setOpen(true)}>+ Nueva Requi</Button>
        </div>
      </div>
      <Segmented value={filter} onChange={setFilter} options={[["todas", "Todas"], ["pendiente", "Pendientes"], ["urgente", "Urgentes"], ["aprobado", "Aprobadas"], ["completado", "Completadas"], ["cancelado", "Canceladas"]]} />
      {detailError ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{detailError}</p> : null}
      <Card className="mt-5 p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#EDE8E3]">
                {selectionMode ? (
                  <th className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAllFiltered} className="h-4 w-4 rounded border-[#DDD7D1] text-[#B45309] focus:ring-[#B45309]" />
                  </th>
                ) : null}
                {["ID", "Fecha", "Solicitó", "Sucursal", "Área", "Tipo", "Items", "Estado", "Acciones"].map((label) => (
                  <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => (
                <tr key={req.id} onClick={() => { if (!selectionMode) void openDetail(req.id); }} className={`border-b border-[#F5F1EE] transition hover:bg-[#FAFAF7] ${selectionMode ? "" : "cursor-pointer"}`}>
                  {selectionMode ? (
                    <td className="whitespace-nowrap px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(req.id)}
                        onChange={() => toggleRequisitionSelection(req.id)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4 rounded border-[#DDD7D1] text-[#B45309] focus:ring-[#B45309]"
                      />
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-bold text-[#B45309]">{req.folio}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{formatDate(req.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{req.requested_by_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{req.location_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{req.area_name ?? "Sin área"}</td>
                  <td className="whitespace-nowrap px-4 py-3"><Badge status={req.request_type} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{req.items_count}</td>
                  <td className="whitespace-nowrap px-4 py-3"><Badge status={req.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={(event) => { event.stopPropagation(); void openDetail(req.id); }} className="rounded-lg border border-[#DDD7D1] px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-[#F5F1EE]">
                        {detailLoadingId === req.id ? "Abriendo..." : "Ver"}
                      </button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); void generatePdf(req.id); }} className="rounded-lg bg-[#1C1917] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#2D2926]">
                        {pdfLoadingId === req.id ? "Generando..." : "PDF"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? <EmptyState message="No hay solicitudes con este filtro" /> : null}
      </Card>
      {open ? <NewRequisitionModal supabase={supabase} selectedLocation={selectedLocation} locations={locations} areas={areas} products={products} onClose={() => setOpen(false)} onCreated={async () => { setOpen(false); await reload(); }} /> : null}
      {detail ? (
        <RequisitionDetailModal
          key={`${detail.id}-${detail.updated_at}-${detail.status}`}
          supabase={supabase}
          detail={detail}
          areas={areas}
          products={products}
          locations={locations}
          canManageStatus={canManageStatus}
          onClose={() => setDetail(null)}
          onUpdated={async (updatedDetail) => {
            setDetail(updatedDetail);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RequisitionDetailModal({
  supabase,
  detail,
  areas,
  products,
  locations,
  canManageStatus,
  onClose,
  onUpdated,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  detail: SupplyRequisitionDetail;
  areas: SupplyArea[];
  products: ProductRow[];
  locations: LocationRow[];
  canManageStatus: boolean;
  onClose: () => void;
  onUpdated: (detail: SupplyRequisitionDetail) => Promise<void>;
}) {
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const [locationId, setLocationId] = useState(detail.location_id);
  const [areaId, setAreaId] = useState(detail.area_id ?? "");
  const [requestType, setRequestType] = useState<RequisitionRequestType>(detail.request_type);
  const [neededBy, setNeededBy] = useState(detail.needed_by ?? "");
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [statusDraft, setStatusDraft] = useState<RequisitionStatus>(detail.status);
  const [items, setItems] = useState<RequisitionDraftItem[]>(() => detail.items.map((item) => detailItemToDraftItem(item, productMap.get(item.product_id))));
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedDraftProduct = products.find((product) => product.id === draftProductId);
  const locationAreas = areas.filter((area) => area.location_id === locationId);
  const canEditContent = detail.status === "pendiente";
  const statusLocked = detail.status === "cancelado";
  const canAddItem = Boolean(canEditContent && selectedDraftProduct && Number(draftQuantity) > 0);

  function updateItem(clientId: string, changes: Partial<Pick<RequisitionDraftItem, "quantity" | "notes">>) {
    setItems((current) => current.map((item) => (item.clientId === clientId ? { ...item, ...changes } : item)));
  }

  function updateItemProduct(clientId: string, productId: string) {
    const product = productMap.get(productId);
    if (!product) return;
    setItems((current) => current.map((item) => (item.clientId === clientId ? { ...item, productId, product } : item)));
  }

  function addItem() {
    if (!selectedDraftProduct || Number(draftQuantity) <= 0) return;
    const clientId = globalThis.crypto?.randomUUID?.() ?? `${selectedDraftProduct.id}-${Date.now()}`;
    setItems((current) => [
      ...current,
      {
        clientId,
        productId: selectedDraftProduct.id,
        quantity: draftQuantity,
        notes: draftNotes.trim(),
        product: selectedDraftProduct,
      },
    ]);
    setDraftProductId("");
    setDraftQuantity("");
    setDraftNotes("");
    setError(null);
  }

  function removeItem(clientId: string) {
    setItems((current) => current.filter((item) => item.clientId !== clientId));
  }

  async function saveContent() {
    if (!supabase || !canEditContent) return;
    if (items.length === 0 || items.some((item) => Number(item.quantity) <= 0)) {
      setError("Cada requisición necesita al menos un producto con cantidad válida.");
      return;
    }

    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc("update_abastecimiento_requisition", {
      p_area_id: areaId || null,
      p_items: items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit: item.product.unit ?? "",
        notes: item.notes,
      })),
      p_location_id: locationId,
      p_needed_by: neededBy || null,
      p_notes: notes,
      p_request_type: requestType,
      p_requisition_id: detail.id,
    });
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    await onUpdated(data as SupplyRequisitionDetail);
  }

  async function saveStatus() {
    if (!supabase || !canManageStatus || statusLocked || statusDraft === detail.status) return;
    setStatusSaving(true);
    setError(null);
    const { data, error: statusError } = await supabase.rpc("update_abastecimiento_requisition_status", {
      p_requisition_id: detail.id,
      p_status: statusDraft,
    });
    setStatusSaving(false);

    if (statusError) {
      setError(statusError.message);
      return;
    }

    await onUpdated(data as SupplyRequisitionDetail);
  }

  return (
    <Modal title={`Requisición ${detail.folio}`} onClose={onClose} maxWidthClass="max-w-6xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={detail.status} />
            <Badge status={detail.request_type} />
          </div>
          <p className="mt-2 text-sm font-semibold text-stone-500">{detail.location_name} · {detail.area_name ?? "Sin área"} · {formatDateTime(detail.created_at)}</p>
        </div>
        <div className="flex flex-wrap justify-start gap-2 md:justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              void downloadRequisitionPdf(detail).catch((pdfError) => {
                setError(getErrorMessage(pdfError));
              });
            }}
          >
            Generar PDF
          </Button>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl bg-[#FAFAF8] p-4 md:grid-cols-4">
        <KpiMini label="Partidas" value={items.length} />
        <KpiMini label="Unidades" value={items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} />
        <KpiMini label="Necesario para" value={neededBy ? formatDate(neededBy) : "Sin fecha"} />
        <KpiMini label="Última edición" value={formatDateTime(detail.updated_at)} />
      </div>

      {canManageStatus ? (
        <div className="mt-4 grid items-end gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[1fr_auto]">
          <Field label="Estado">
            <select disabled={statusLocked} value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as RequisitionStatus)} className="field-input disabled:opacity-70">
              {REQUISITION_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Button disabled={statusLocked || statusDraft === detail.status || statusSaving} onClick={saveStatus}>{statusSaving ? "Actualizando..." : "Actualizar estado"}</Button>
        </div>
      ) : null}

      {statusLocked ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">La requisición cancelada queda bloqueada por completo.</p>
      ) : null}

      {!canEditContent ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">La requisición ya no está pendiente de aprobación; el contenido queda bloqueado.</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <Field label="Sucursal">
          <select disabled={!canEditContent} value={locationId} onChange={(event) => { setLocationId(event.target.value); setAreaId(""); }} className="field-input disabled:opacity-70">
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Área">
          <select disabled={!canEditContent} value={areaId} onChange={(event) => setAreaId(event.target.value)} className="field-input disabled:opacity-70">
            <option value="">Sin área</option>
            {locationAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo">
          <select disabled={!canEditContent} value={requestType} onChange={(event) => setRequestType(event.target.value as RequisitionRequestType)} className="field-input disabled:opacity-70">
            {REQUEST_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Necesario para">
          <input disabled={!canEditContent} value={neededBy} onChange={(event) => setNeededBy(event.target.value)} type="date" className="field-input disabled:opacity-70" />
        </Field>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-2">
        <KpiMini label="Solicitó" value={detail.requested_by_name} />
        <KpiMini label="Aprobó" value={detail.approved_by_name ?? "Pendiente"} />
      </div>

      <div className="mt-2 rounded-xl border border-[#EDE8E3] bg-white">
        <div className="flex items-center justify-between border-b border-[#EDE8E3] px-4 py-3">
          <p className="text-sm font-extrabold text-stone-950">Detalle de productos</p>
          <span className="rounded-full bg-[#F5F1EE] px-2.5 py-1 text-xs font-bold text-stone-600">{items.length}</span>
        </div>
        <div className="divide-y divide-[#EDE8E3]">
          {items.map((item) => (
            <div key={item.clientId} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_120px_minmax(180px,0.8fr)_40px] lg:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <ProductThumb product={item.product} />
                <div className="min-w-0 flex-1">
                  {canEditContent ? (
                    <select value={item.productId} onChange={(event) => updateItemProduct(item.clientId, event.target.value)} className="field-input bg-white">
                      {products.map((product) => <option key={product.id} value={product.id}>{product.product} {product.presentation ? `· ${product.presentation}` : ""}</option>)}
                    </select>
                  ) : (
                    <p className="truncate text-sm font-bold text-stone-950">{item.product.product}</p>
                  )}
                  <p className="mt-1 truncate text-xs font-semibold text-stone-500">{item.product.presentation ?? "Sin presentación"}</p>
                </div>
              </div>
              <Field label="Cantidad">
                <input disabled={!canEditContent} value={item.quantity} onChange={(event) => updateItem(item.clientId, { quantity: event.target.value })} type="number" min="0" step="0.001" className="field-input disabled:opacity-70" />
              </Field>
              <Field label="Notas">
                <input disabled={!canEditContent} value={item.notes} onChange={(event) => updateItem(item.clientId, { notes: event.target.value })} className="field-input disabled:opacity-70" placeholder="Opcional" />
              </Field>
              <button type="button" disabled={!canEditContent || items.length === 1} aria-label={`Quitar ${item.product.product}`} onClick={() => removeItem(item.clientId)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#EDE8E3] text-xl leading-none text-stone-400 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {canEditContent ? (
        <div className="mt-4 rounded-xl border border-[#EDE8E3] bg-[#FAFAF8] p-4">
          <div className="grid items-end gap-4 lg:grid-cols-[1fr_140px_1fr_auto]">
            <Field label="Agregar producto">
              <select value={draftProductId} onChange={(event) => setDraftProductId(event.target.value)} className="field-input bg-white">
                <option value="">Seleccionar...</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.product} {product.presentation ? `· ${product.presentation}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Cantidad">
              <input value={draftQuantity} onChange={(event) => setDraftQuantity(event.target.value)} type="number" min="0" step="0.001" className="field-input bg-white" />
            </Field>
            <Field label="Notas de producto">
              <input value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} className="field-input bg-white" placeholder="Opcional" />
            </Field>
            <Button disabled={!canAddItem} onClick={addItem}>Agregar</Button>
          </div>
        </div>
      ) : null}

      <Field label="Notas generales">
        <textarea disabled={!canEditContent} value={notes} onChange={(event) => setNotes(event.target.value)} className="field-input min-h-20 resize-y disabled:opacity-70" placeholder="Opcional" />
      </Field>

      {error ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {canEditContent ? <Button disabled={saving} onClick={saveContent}>{saving ? "Guardando..." : "Guardar cambios"}</Button> : null}
      </div>
    </Modal>
  );
}

function NewRequisitionModal({
  supabase,
  selectedLocation,
  locations,
  areas,
  products,
  onClose,
  onCreated,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  selectedLocation: string;
  locations: LocationRow[];
  areas: SupplyArea[];
  products: ProductRow[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const defaultLocation = locations.find((location) => location.name === selectedLocation)?.id ?? locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(defaultLocation);
  const [areaId, setAreaId] = useState("");
  const [requestType, setRequestType] = useState("ordinaria");
  const [productSearch, setProductSearch] = useState("");
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [items, setItems] = useState<RequisitionDraftItem[]>([]);
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deferredProductSearch = useDeferredValue(productSearch);
  const selectedProduct = products.find((product) => product.id === draftProductId);
  const locationAreas = areas.filter((area) => area.location_id === locationId);
  const filteredProducts = products.filter((product) =>
    `${product.product} ${product.brand ?? ""} ${product.presentation ?? ""}`.toLowerCase().includes(deferredProductSearch.trim().toLowerCase()),
  );
  const canAddItem = Boolean(selectedProduct && Number(draftQuantity) > 0);

  function addItem() {
    if (!selectedProduct || Number(draftQuantity) <= 0) return;
    const clientId = globalThis.crypto?.randomUUID?.() ?? `${selectedProduct.id}-${Date.now()}`;
    setItems((current) => [
      ...current,
      {
        clientId,
        productId: selectedProduct.id,
        quantity: draftQuantity,
        notes: draftNotes.trim(),
        product: selectedProduct,
      },
    ]);
    setProductSearch("");
    setDraftProductId("");
    setDraftQuantity("");
    setDraftNotes("");
    setError(null);
  }

  function removeItem(clientId: string) {
    setItems((current) => current.filter((item) => item.clientId !== clientId));
  }

  async function submit() {
    if (!supabase || items.length === 0) return;
    setSaving(true);
    setError(null);
    const { error: createError } = await supabase.rpc("create_abastecimiento_requisition", {
      p_area_id: areaId || null,
      p_items: items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit: item.product.unit ?? "",
        notes: item.notes,
      })),
      p_location_id: locationId,
      p_needed_by: neededBy || null,
      p_notes: notes,
      p_request_type: requestType,
    });
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    await onCreated();
  }

  return (
    <Modal title="Nueva Requisición" onClose={onClose} maxWidthClass="max-w-5xl">
      <div className="grid gap-4 lg:grid-cols-4">
        <Field label="Sucursal">
          <select value={locationId} onChange={(event) => { setLocationId(event.target.value); setAreaId(""); }} className="field-input">
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Área">
          <select value={areaId} onChange={(event) => setAreaId(event.target.value)} className="field-input">
            <option value="">Sin área</option>
            {locationAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </Field>
        <Field label="Tipo">
          <select value={requestType} onChange={(event) => setRequestType(event.target.value)} className="field-input">
            <option value="ordinaria">Ordinaria</option>
            <option value="urgente">Urgente</option>
            <option value="programada">Programada</option>
          </select>
        </Field>
        <Field label="Necesario para">
          <input value={neededBy} onChange={(event) => setNeededBy(event.target.value)} type="date" className="field-input" />
        </Field>
      </div>

      <div className="mt-2 rounded-xl border border-[#EDE8E3] bg-[#FAFAF8] p-4">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
              <Field label="Buscar producto">
                <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} className="field-input bg-white" placeholder="Nombre, marca o presentación..." />
              </Field>
              <Field label="Producto">
                <select value={draftProductId} onChange={(event) => setDraftProductId(event.target.value)} className="field-input bg-white">
                  <option value="">Seleccionar...</option>
                  {filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.product} {product.presentation ? `· ${product.presentation}` : ""}{product.brand ? ` · ${product.brand}` : ""}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid items-end gap-4 md:grid-cols-[160px_1fr_auto]">
              <Field label="Cantidad">
                <input value={draftQuantity} onChange={(event) => setDraftQuantity(event.target.value)} type="number" min="0" step="0.001" className="field-input bg-white" />
              </Field>
              <Field label="Notas de producto">
                <input value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} className="field-input bg-white" placeholder="Opcional" />
              </Field>
              <Button disabled={!canAddItem} onClick={addItem}>Agregar</Button>
            </div>
          </div>
          <ProductPreview product={selectedProduct} />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#EDE8E3] bg-white">
        <div className="flex items-center justify-between border-b border-[#EDE8E3] px-4 py-3">
          <p className="text-sm font-extrabold text-stone-950">Productos agregados</p>
          <span className="rounded-full bg-[#F5F1EE] px-2.5 py-1 text-xs font-bold text-stone-600">{items.length}</span>
        </div>
        <div className="max-h-[260px] overflow-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm font-medium text-stone-400">Sin productos agregados</div>
          ) : (
            <div className="divide-y divide-[#EDE8E3]">
              {items.map((item) => (
                <div key={item.clientId} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_130px_40px] md:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProductThumb product={item.product} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-stone-950">{item.product.product}</p>
                      <p className="truncate text-xs font-semibold text-stone-500">{item.product.presentation ?? "Sin presentación"}</p>
                      {item.notes ? <p className="mt-1 truncate text-xs text-stone-500">{item.notes}</p> : null}
                    </div>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-sm font-extrabold text-[#B45309]">{formatNumber(item.quantity)}</p>
                    <p className="text-xs font-semibold text-stone-500">{item.product.unit ?? "unidad"}</p>
                  </div>
                  <button type="button" aria-label={`Quitar ${item.product.product}`} onClick={() => removeItem(item.clientId)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#EDE8E3] text-xl leading-none text-stone-400 transition hover:bg-red-50 hover:text-red-700">
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Field label="Notas generales">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="field-input min-h-20 resize-y" placeholder="Opcional" />
      </Field>

      <div className="mt-4 grid gap-3 rounded-xl bg-[#FAFAF8] p-4 md:grid-cols-3">
        <KpiMini label="Partidas" value={items.length} />
        <KpiMini label="Unidades solicitadas" value={items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} />
        <KpiMini label="Sucursal" value={locations.find((location) => location.id === locationId)?.name ?? "Sin sucursal"} />
      </div>
      {error ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button disabled={!locationId || items.length === 0 || saving} onClick={submit}>{saving ? "Creando..." : "Crear solicitud"}</Button>
      </div>
    </Modal>
  );
}

function ProductPreview({ product }: { product: ProductRow | undefined }) {
  if (!product) {
    return (
      <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-[#DDD7D1] bg-white px-4 text-center text-sm font-semibold text-stone-400">
        Vista del producto
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#EDE8E3] bg-white">
      <ProductThumb product={product} size="lg" />
      <div className="space-y-1.5 p-4">
        <p className="line-clamp-2 text-sm font-extrabold text-stone-950">{product.product}</p>
        <p className="text-xs font-semibold text-stone-500">{product.presentation ?? "Sin presentación"}</p>
        <div className="flex flex-wrap gap-2 pt-2 text-[11px] font-bold text-stone-500">
          {product.brand ? <span className="rounded-full bg-[#F5F1EE] px-2.5 py-1">{product.brand}</span> : null}
          {product.unit ? <span className="rounded-full bg-[#F5F1EE] px-2.5 py-1">{product.unit}</span> : null}
        </div>
      </div>
    </div>
  );
}

function ProductThumb({ product, size = "sm" }: { product: ProductRow; size?: "sm" | "lg" }) {
  const sizeClass = size === "lg" ? "h-28 w-full rounded-none" : "h-14 w-14 rounded-lg";
  if (product.image_url) {
    return (
      <div
        aria-label={`Imagen de ${product.product}`}
        role="img"
        className={`${sizeClass} shrink-0 border border-[#EDE8E3] bg-[#F5F1EE] bg-cover bg-center`}
        style={{ backgroundImage: `url(${product.image_url})` }}
      />
    );
  }

  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center border border-[#EDE8E3] bg-[#F5F1EE] text-xs font-extrabold text-[#B45309]`}>
      {getInitials(product.product)}
    </div>
  );
}

function KpiMini({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</p>
      <p className="mt-1 truncate text-sm font-extrabold text-stone-950">{typeof value === "number" ? formatNumber(value) : value}</p>
    </div>
  );
}

function detailItemToDraftItem(item: SupplyRequisitionItem, product?: ProductRow): RequisitionDraftItem {
  return {
    clientId: item.id,
    itemId: item.id,
    productId: item.product_id,
    quantity: String(item.quantity ?? ""),
    notes: item.notes ?? "",
    product: product ?? {
      id: item.product_id,
      product: item.product,
      unit: item.unit,
      unit_price: item.unit_price,
      total_price: item.total_price,
      brand: item.brand,
      presentation: item.presentation,
      image_url: item.image_url,
      almacen: item.almacen,
      location_id: null,
    },
  };
}

const PDF_PALETTE = {
  border: [237, 232, 227] as const,
  dark: [28, 25, 23] as const,
  ink: [68, 64, 60] as const,
  muted: [120, 113, 108] as const,
  paper: [245, 241, 238] as const,
  white: [255, 255, 255] as const,
  accent: [180, 83, 9] as const,
};

const PDF_LAYOUT = {
  footerHeight: 26,
  margin: 36,
  pageHeight: 792,
  pageWidth: 612,
};

type PdfColumn = {
  key: string;
  label: string;
  x: number;
  width: number;
  align: "left" | "center" | "right";
};

async function downloadRequisitionPdf(detail: SupplyRequisitionDetail) {
  const doc = createLetterPdf();
  const cursorY = renderPdfDocumentHeader(doc, detail.folio, `Sucursal ${detail.location_name}`);
  await renderRequisitionPdfSection(doc, detail, cursorY, false);
  renderPdfFooter(doc);
  doc.save(`${sanitizeFilename(detail.folio)}.pdf`);
}

async function downloadGeneralRequisitionPdf(details: SupplyRequisitionDetail[]) {
  const doc = createLetterPdf();
  let cursorY = renderPdfDocumentHeader(doc, "Requisiciones Generales", `${details.length} requisiciones seleccionadas`, `${groupByLocation(details).length} sucursales`);
  let currentLocation = "";

  for (const detail of sortRequisitionsForPdf(details)) {
    if (detail.location_name !== currentLocation) {
      currentLocation = detail.location_name;
      cursorY = ensurePdfSpace(doc, cursorY, 34);
      doc.setFillColor(...PDF_PALETTE.dark);
      doc.roundedRect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 22, 6, 6, "F");
      doc.setTextColor(...PDF_PALETTE.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(currentLocation, PDF_LAYOUT.margin + 12, cursorY + 14);
      cursorY += 30;
    }

    cursorY = await renderRequisitionPdfSection(doc, detail, cursorY, true);
  }

  renderPdfFooter(doc);
  doc.save(`requisiciones-generales-${formatTodayForFilename()}.pdf`);
}

async function downloadPurchaseOrderPdf(detail: PurchaseOrderDetail) {
  const doc = createLetterPdf();
  let cursorY = renderPdfDocumentHeader(doc, `Orden de Compra ${detail.folio}`, `Requisición ${detail.requisition_folio} · ${detail.location_name}`, formatCurrency(getRequisitionTotal(detail)));
  cursorY = renderPurchaseOrderSummary(doc, detail, cursorY);
  cursorY = renderPurchaseOrderItemsHeader(doc, cursorY + 8);
  const imageMap = await buildItemImageMap(detail.items);

  for (const [index, item] of detail.items.entries()) {
    cursorY = renderPurchaseOrderItemRow(doc, item, imageMap.get(item.id) ?? null, index + 1, cursorY);
  }

  cursorY = renderPurchaseOrderTotals(doc, detail, cursorY + 12);
  renderPdfNotes(doc, detail.notes ?? "Sin notas", cursorY + 10);
  renderPdfFooter(doc);
  doc.save(`orden-compra-${sanitizeFilename(detail.folio)}.pdf`);
}

function createLetterPdf() {
  return new jsPDF({
    format: "letter",
    orientation: "portrait",
    unit: "pt",
  });
}

function renderPurchaseOrderSummary(doc: jsPDF, detail: PurchaseOrderDetail, cursorY: number) {
  const entries = [
    ["Sucursal", detail.location_name],
    ["Solicito", detail.requested_by_name],
    ["Estado", STATUS[detail.status]?.label ?? humanize(detail.status)],
    ["Aprobacion", detail.approved_at ? formatDateTime(detail.approved_at) : "Pendiente"],
  ] as const;

  cursorY = renderPdfMetaBoxes(doc, entries, cursorY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.muted);
  doc.text("Evaluación financiera: confirmar disponibilidad de fondos antes de completar la compra.", PDF_LAYOUT.margin, cursorY + 8);
  return cursorY + 18;
}

function renderPurchaseOrderItemsHeader(doc: jsPDF, cursorY: number) {
  cursorY = ensurePdfSpace(doc, cursorY, 26);
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.rect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_PALETTE.muted);

  getPurchaseOrderColumns().forEach((column) => {
    const x = PDF_LAYOUT.margin + column.x;
    doc.text(column.label, x + (column.align === "right" ? column.width - 4 : 4), cursorY + 14, {
      align: column.align,
      maxWidth: column.width - 8,
    });
  });

  return cursorY + 22;
}

function renderPurchaseOrderItemRow(doc: jsPDF, item: SupplyRequisitionItem, imageDataUrl: string | null, index: number, cursorY: number) {
  const columns = getPurchaseOrderColumns();
  const productText = [item.product, item.brand ? `Marca: ${item.brand}` : null].filter(Boolean).join("\n");
  const productLines = doc.splitTextToSize(productText, getPurchaseOrderColumn(columns, "product").width - 8);
  const presentationLines = doc.splitTextToSize(item.presentation ?? "Sin presentación", getPurchaseOrderColumn(columns, "presentation").width - 8);
  const rowHeight = Math.max(54, productLines.length * 11 + 16, presentationLines.length * 11 + 16);

  cursorY = ensurePdfSpace(doc, cursorY, rowHeight + 12);
  if (cursorY === PDF_LAYOUT.margin) {
    cursorY = renderPurchaseOrderItemsHeader(doc, cursorY);
  }

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.line(PDF_LAYOUT.margin, cursorY + rowHeight, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, cursorY + rowHeight);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.ink);

  drawPurchaseOrderCellText(doc, String(index), columns, "index", cursorY, rowHeight, "center");
  drawPdfImageCell(doc, imageDataUrl, item.product, columns, cursorY, rowHeight);
  drawPurchaseOrderCellText(doc, productLines, columns, "product", cursorY, rowHeight);
  drawPurchaseOrderCellText(doc, presentationLines, columns, "presentation", cursorY, rowHeight);
  drawPurchaseOrderCellText(doc, formatNumber(item.quantity), columns, "quantity", cursorY, rowHeight, "right");
  drawPurchaseOrderCellText(doc, item.unit ?? "unidad", columns, "unit", cursorY, rowHeight);
  drawPurchaseOrderCellText(doc, formatCurrency(getItemPurchasePrice(item)), columns, "price", cursorY, rowHeight, "right");
  drawPurchaseOrderCellText(doc, formatCurrency(getItemLineTotal(item)), columns, "lineTotal", cursorY, rowHeight, "right");

  return cursorY + rowHeight;
}

function renderPurchaseOrderTotals(doc: jsPDF, detail: { estimated_total?: number | string | null; items: SupplyRequisitionItem[] }, cursorY: number) {
  cursorY = ensurePdfSpace(doc, cursorY, 48);
  const width = 210;
  const x = PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin - width;
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.setDrawColor(...PDF_PALETTE.border);
  doc.roundedRect(x, cursorY, width, 42, 8, 8, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_PALETTE.muted);
  doc.text("TOTAL ORDEN", x + 12, cursorY + 15);
  doc.setFontSize(15);
  doc.setTextColor(...PDF_PALETTE.dark);
  doc.text(formatCurrency(getRequisitionTotal(detail)), x + width - 12, cursorY + 30, { align: "right" });
  return cursorY + 42;
}

function renderPdfDocumentHeader(doc: jsPDF, title: string, subtitle: string, meta?: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_PALETTE.accent);
  doc.text("KADMIEL SUPPLY OS", PDF_LAYOUT.margin, PDF_LAYOUT.margin);

  doc.setFontSize(22);
  doc.setTextColor(...PDF_PALETTE.dark);
  doc.text(title, PDF_LAYOUT.margin, PDF_LAYOUT.margin + 24);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_PALETTE.ink);
  doc.text(subtitle, PDF_LAYOUT.margin, PDF_LAYOUT.margin + 42);

  if (meta) {
    doc.setTextColor(...PDF_PALETTE.muted);
    doc.text(meta, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, PDF_LAYOUT.margin + 42, { align: "right" });
  }

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.line(PDF_LAYOUT.margin, PDF_LAYOUT.margin + 54, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, PDF_LAYOUT.margin + 54);

  return PDF_LAYOUT.margin + 72;
}

async function renderRequisitionPdfSection(doc: jsPDF, detail: SupplyRequisitionDetail, startY: number, compact: boolean) {
  let cursorY = ensurePdfSpace(doc, startY, compact ? 120 : 132);
  const imageMap = await buildItemImageMap(detail.items);

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.setFillColor(...PDF_PALETTE.white);
  doc.roundedRect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 74, 10, 10, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...PDF_PALETTE.accent);
  doc.text(detail.folio, PDF_LAYOUT.margin + 14, cursorY + 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_PALETTE.ink);
  doc.text(`${detail.requested_by_name} · ${detail.area_name ?? "Sin área"} · ${formatDateTime(detail.created_at)}`, PDF_LAYOUT.margin + 14, cursorY + 38);
  doc.text(`Tipo ${STATUS[detail.request_type]?.label ?? detail.request_type} · Necesario para ${detail.needed_by ? formatDate(detail.needed_by) : "Sin fecha"}`, PDF_LAYOUT.margin + 14, cursorY + 52);

  drawPdfStatusPill(doc, detail.status, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin - 96, cursorY + 12, 82);

  const metaEntries = [
    ["Sucursal", detail.location_name],
    ["Solicito", detail.requested_by_name],
    ["Aprobo", detail.approved_by_name ?? "Pendiente"],
    ["Aprobacion", detail.approved_at ? formatDateTime(detail.approved_at) : "Pendiente"],
  ] as const;

  cursorY += 88;
  cursorY = renderPdfMetaBoxes(doc, metaEntries, cursorY);
  cursorY += 10;
  cursorY = renderPdfItemsTableHeader(doc, cursorY);

  for (const [index, item] of detail.items.entries()) {
    cursorY = await renderPdfItemRow(doc, item, imageMap.get(item.id) ?? null, index + 1, cursorY);
  }

  cursorY += 8;
  cursorY = renderPdfNotes(doc, detail.notes ?? "Sin notas", cursorY);

  return cursorY + (compact ? 12 : 18);
}

function renderPdfMetaBoxes(doc: jsPDF, entries: ReadonlyArray<readonly [string, string]>, cursorY: number) {
  const gap = 8;
  const width = (getPdfContentWidth() - gap * 3) / 4;
  let x = PDF_LAYOUT.margin;

  for (const [label, value] of entries) {
    doc.setFillColor(...PDF_PALETTE.paper);
    doc.setDrawColor(...PDF_PALETTE.border);
    doc.roundedRect(x, cursorY, width, 38, 6, 6, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_PALETTE.muted);
    doc.text(label.toUpperCase(), x + 8, cursorY + 12);
    doc.setFontSize(10);
    doc.setTextColor(...PDF_PALETTE.dark);
    doc.text(doc.splitTextToSize(value, width - 16), x + 8, cursorY + 26);
    x += width + gap;
  }

  return cursorY + 46;
}

function renderPdfItemsTableHeader(doc: jsPDF, cursorY: number) {
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.rect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_PALETTE.muted);
  const columns = getPdfColumns();

  columns.forEach((column) => {
    const x = PDF_LAYOUT.margin + column.x;
    doc.text(column.label, x + (column.align === "right" ? column.width - 4 : 4), cursorY + 14, {
      align: column.align,
      maxWidth: column.width - 8,
    });
  });

  return cursorY + 22;
}

async function renderPdfItemRow(doc: jsPDF, item: SupplyRequisitionItem, imageDataUrl: string | null, index: number, cursorY: number) {
  const columns = getPdfColumns();
  const productText = [item.product, item.brand ? `Marca: ${item.brand}` : null].filter(Boolean).join("\n");
  const presentationLines = doc.splitTextToSize(item.presentation ?? "Sin presentación", getColumn(columns, "presentation").width - 8);
  const productLines = doc.splitTextToSize(productText, getColumn(columns, "product").width - 8);
  const notesLines = doc.splitTextToSize(item.notes ?? "", getColumn(columns, "notes").width - 8);
  const rowHeight = Math.max(54, productLines.length * 11 + 16, presentationLines.length * 11 + 16, Math.max(notesLines.length, 1) * 11 + 16);

  cursorY = ensurePdfSpace(doc, cursorY, rowHeight + 12);
  if (cursorY === PDF_LAYOUT.margin) {
    cursorY = renderPdfItemsTableHeader(doc, cursorY);
  }

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.line(PDF_LAYOUT.margin, cursorY + rowHeight, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, cursorY + rowHeight);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.ink);

  drawPdfCellText(doc, String(index), columns, "index", cursorY, rowHeight, "center");
  drawPdfImageCell(doc, imageDataUrl, item.product, columns, cursorY, rowHeight);
  drawPdfCellText(doc, productLines, columns, "product", cursorY, rowHeight);
  drawPdfCellText(doc, presentationLines, columns, "presentation", cursorY, rowHeight);
  drawPdfCellText(doc, formatNumber(item.quantity), columns, "quantity", cursorY, rowHeight, "right");
  drawPdfCellText(doc, item.unit ?? "unidad", columns, "unit", cursorY, rowHeight);
  drawPdfCellText(doc, notesLines.length > 0 ? notesLines : " ", columns, "notes", cursorY, rowHeight);

  return cursorY + rowHeight;
}

function renderPdfNotes(doc: jsPDF, notes: string, cursorY: number) {
  const lines = doc.splitTextToSize(notes, getPdfContentWidth() - 24);
  const height = Math.max(48, lines.length * 11 + 22);
  cursorY = ensurePdfSpace(doc, cursorY, height + 8);

  doc.setFillColor(...PDF_PALETTE.paper);
  doc.setDrawColor(...PDF_PALETTE.border);
  doc.roundedRect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), height, 8, 8, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_PALETTE.muted);
  doc.text("NOTAS GENERALES", PDF_LAYOUT.margin + 12, cursorY + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.ink);
  doc.text(lines, PDF_LAYOUT.margin + 12, cursorY + 30);

  return cursorY + height;
}

function ensurePdfSpace(doc: jsPDF, cursorY: number, neededHeight: number) {
  const limit = PDF_LAYOUT.pageHeight - PDF_LAYOUT.margin - PDF_LAYOUT.footerHeight;
  if (cursorY + neededHeight <= limit) return cursorY;

  doc.addPage("letter", "portrait");
  return PDF_LAYOUT.margin;
}

function renderPdfFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages();
  const generatedAt = `Generado ${formatDateTime(new Date().toISOString())}`;

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
    doc.setPage(pageIndex);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_PALETTE.muted);
    doc.text(generatedAt, PDF_LAYOUT.margin, PDF_LAYOUT.pageHeight - 14);
    doc.text(`Página ${pageIndex} de ${pageCount}`, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, PDF_LAYOUT.pageHeight - 14, { align: "right" });
  }
}

function getPdfContentWidth() {
  return PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin * 2;
}

function getPdfColumns() {
  return [
    { key: "index", label: "#", x: 0, width: 22, align: "center" as const },
    { key: "image", label: "Imagen", x: 26, width: 44, align: "left" as const },
    { key: "product", label: "Producto", x: 74, width: 158, align: "left" as const },
    { key: "presentation", label: "Presentacion", x: 236, width: 92, align: "left" as const },
    { key: "quantity", label: "Cantidad", x: 332, width: 46, align: "right" as const },
    { key: "unit", label: "Unidad", x: 382, width: 52, align: "left" as const },
    { key: "notes", label: "Notas", x: 438, width: 98, align: "left" as const },
  ];
}

function getPurchaseOrderColumns(): PdfColumn[] {
  return [
    { key: "index", label: "#", x: 0, width: 20, align: "center" },
    { key: "image", label: "Imagen", x: 24, width: 42, align: "left" },
    { key: "product", label: "Producto", x: 70, width: 124, align: "left" },
    { key: "presentation", label: "Presentacion", x: 198, width: 74, align: "left" },
    { key: "quantity", label: "Cant.", x: 276, width: 42, align: "right" },
    { key: "unit", label: "Unidad", x: 322, width: 44, align: "left" },
    { key: "price", label: "Precio", x: 370, width: 76, align: "right" },
    { key: "lineTotal", label: "Importe", x: 450, width: 86, align: "right" },
  ];
}

function getColumn(columns: PdfColumn[], key: string) {
  const column = columns.find((entry) => entry.key === key);
  if (!column) throw new Error(`No se encontró la columna ${key}`);
  return column;
}

function getPurchaseOrderColumn(columns: PdfColumn[], key: string) {
  return getColumn(columns, key);
}

function drawPdfCellText(
  doc: jsPDF,
  value: string | string[],
  columns: PdfColumn[],
  key: string,
  cursorY: number,
  rowHeight: number,
  align: "left" | "center" | "right" = "left",
) {
  const column = getColumn(columns, key);
  const x = PDF_LAYOUT.margin + column.x;
  const lines = Array.isArray(value) ? value : [value];
  const top = cursorY + 14;
  const anchorX = align === "right" ? x + column.width - 4 : align === "center" ? x + column.width / 2 : x + 4;
  doc.text(lines, anchorX, top, { align, baseline: "top", maxWidth: column.width - 8 });
}

function drawPurchaseOrderCellText(
  doc: jsPDF,
  value: string | string[],
  columns: PdfColumn[],
  key: string,
  cursorY: number,
  rowHeight: number,
  align: "left" | "center" | "right" = "left",
) {
  drawPdfCellText(doc, value, columns, key, cursorY, rowHeight, align);
}

function drawPdfImageCell(
  doc: jsPDF,
  imageDataUrl: string | null,
  productName: string,
  columns: PdfColumn[],
  cursorY: number,
  rowHeight: number,
) {
  const column = getColumn(columns, "image");
  const boxSize = 32;
  const x = PDF_LAYOUT.margin + column.x + 6;
  const y = cursorY + Math.max(8, (rowHeight - boxSize) / 2);

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.roundedRect(x, y, boxSize, boxSize, 5, 5, "FD");

  if (imageDataUrl) {
    doc.addImage(imageDataUrl, inferPdfImageFormat(imageDataUrl), x, y, boxSize, boxSize);
    return;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.accent);
  doc.text(getInitials(productName), x + boxSize / 2, y + 20, { align: "center" });
}

function drawPdfStatusPill(doc: jsPDF, status: string, x: number, y: number, width: number) {
  const style = STATUS[status] ?? { label: humanize(status), className: "" };
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.roundedRect(x, y, width, 22, 11, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.dark);
  doc.text(style.label, x + width / 2, y + 14, { align: "center" });
}

function getItemPurchasePrice(item: SupplyRequisitionItem) {
  return Number(item.total_price ?? item.unit_price ?? 0);
}

function getItemLineTotal(item: SupplyRequisitionItem) {
  const explicit = Number(item.line_total ?? 0);
  if (explicit > 0) return explicit;
  return Number(item.quantity ?? 0) * getItemPurchasePrice(item);
}

function getRequisitionTotal(detail: { estimated_total?: number | string | null; items: SupplyRequisitionItem[] }) {
  const explicit = Number(detail.estimated_total ?? 0);
  if (explicit > 0) return explicit;
  return detail.items.reduce((sum, item) => sum + getItemLineTotal(item), 0);
}

async function buildItemImageMap(items: SupplyRequisitionItem[]) {
  const entries = await Promise.all(
    items.map(async (item) => [item.id, await loadImageDataUrl(item.image_url)] as const),
  );
  return new Map(entries);
}

async function loadImageDataUrl(imageUrl: string | null) {
  if (!imageUrl) return null;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("No se pudo convertir la imagen."));
    };
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

function inferPdfImageFormat(dataUrl: string) {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function sortRequisitionsForPdf(details: SupplyRequisitionDetail[]) {
  return details.toSorted(
    (left, right) => left.location_name.localeCompare(right.location_name, APP_LOCALE) || left.folio.localeCompare(right.folio, APP_LOCALE),
  );
}

function groupByLocation(details: SupplyRequisitionDetail[]) {
  return Array.from(new Set(details.map((detail) => detail.location_name)));
}

function sanitizeFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function formatTodayForFilename() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function CatalogView({ products }: { products: ProductRow[] }) {
  const [search, setSearch] = useState("");
  const filtered = products.filter((product) => `${product.product} ${product.brand ?? ""} ${product.presentation ?? ""} ${product.almacen ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader title="Catálogo de insumos" subtitle="Maestro de productos, unidades y costos" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumo, marca o presentación..." className="field-input mb-5 mt-6 max-w-sm" />
      <Card className="p-0">
        <DataTable
          columns={[["product", "Producto"], ["unit", "Unidad"], ["unit_price", "Precio"], ["brand", "Marca"], ["presentation", "Presentación"], ["almacen", "Almacén"]]}
          rows={filtered}
          renderCell={(key, product) => {
            if (key === "product") return <span className="font-semibold text-stone-950">{product.product}</span>;
            if (key === "unit_price") return formatCurrency(product.unit_price);
            return String((product as unknown as Record<string, unknown>)[key] ?? "—");
          }}
        />
      </Card>
    </div>
  );
}

function InventoryView({ products, selectedLocation }: { products: ProductRow[]; selectedLocation: string }) {
  const scoped = products.filter((product) => selectedLocation === "Todas" || product.location_id);
  const noPrice = scoped.filter((product) => Number(product.unit_price ?? 0) === 0);
  const frio = scoped.filter((product) => normalize(product.almacen ?? "") === "frio");

  return (
    <div>
      <PageHeader title="Inventario y existencias" subtitle="Lectura inicial desde productos maestros" />
      <div className="mb-6 mt-6 grid gap-3 md:grid-cols-3">
        <KpiCard label="Productos visibles" value={scoped.length} />
        <KpiCard label="Sin precio" value={noPrice.length} alert={noPrice.length > 0} />
        <KpiCard label="Almacén frío" value={frio.length} accent />
      </div>
      <Card className="p-0">
        <DataTable
          columns={[["product", "Producto"], ["unit", "Unidad"], ["unit_price", "Precio"], ["almacen", "Almacén"], ["presentation", "Presentación"]]}
          rows={scoped.slice(0, 40)}
          renderCell={(key, product) => {
            if (key === "product") return <span className="font-semibold text-stone-950">{product.product}</span>;
            if (key === "unit_price") return formatCurrency(product.unit_price);
            return String((product as unknown as Record<string, unknown>)[key] ?? "—");
          }}
        />
      </Card>
    </div>
  );
}

function PurchasesView({
  supabase,
  purchaseOrders,
  role,
  reload,
  selectedLocation,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  purchaseOrders: PurchaseOrderRow[];
  role: UserRole | null;
  reload: () => Promise<void>;
  selectedLocation: string;
}) {
  const [filter, setFilter] = useState<PurchaseOrderStatus | "todas">("pendiente");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null);
  const [statusDrafts, setStatusDrafts] = useState<Record<string, PurchaseOrderStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const canManagePurchases = role?.role === "super_admin" || role?.role === "branch_admin" || normalize(role?.department ?? "") === "contabilidad";
  const visible = purchaseOrders.filter((order) => {
    if (order.status === "cancelado") return false;
    if (filter === "todas") return true;
    return order.status === filter;
  });
  const pending = purchaseOrders.filter((order) => order.status === "pendiente");
  const urgent = purchaseOrders.filter((order) => order.status === "urgente");
  const approved = purchaseOrders.filter((order) => order.status === "aprobado");
  const completed = purchaseOrders.filter((order) => order.status === "completado");
  const visibleTotal = visible.reduce((sum, order) => sum + Number(order.estimated_total ?? 0), 0);

  function getDraftStatus(order: PurchaseOrderRow) {
    return statusDrafts[order.id] ?? order.status;
  }

  async function fetchDetail(purchaseOrderId: string) {
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { data, error: detailError } = await supabase.rpc("get_abastecimiento_purchase_order", { p_purchase_order_id: purchaseOrderId });
    if (detailError) throw detailError;
    return data as PurchaseOrderDetail;
  }

  async function updateStatus(order: PurchaseOrderRow) {
    const nextStatus = getDraftStatus(order);
    if (!supabase || !canManagePurchases || nextStatus === order.status) return;
    setStatusLoadingId(order.id);
    setError(null);
    try {
      const { error: statusError } = await supabase.rpc("update_abastecimiento_purchase_order_status", {
        p_purchase_order_id: order.id,
        p_status: nextStatus,
      });
      if (statusError) throw statusError;
      setStatusDrafts((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      await reload();
    } catch (purchaseError) {
      setError(getErrorMessage(purchaseError));
    } finally {
      setStatusLoadingId(null);
    }
  }

  async function generatePurchaseOrder(purchaseOrderId: string) {
    setLoadingId(purchaseOrderId);
    setError(null);
    try {
      const detail = await fetchDetail(purchaseOrderId);
      if (detail.status !== "aprobado" && detail.status !== "completado") {
        throw new Error("Solo las compras aprobadas o completadas pueden generar orden de compra.");
      }
      await downloadPurchaseOrderPdf(detail);
    } catch (purchaseError) {
      setError(getErrorMessage(purchaseError));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Compras y órdenes" subtitle={`Evaluación financiera · ${selectedLocation}`} />
      <div className="mb-6 mt-6 grid gap-3 md:grid-cols-5">
        <KpiCard label="Pendientes" value={pending.length} sub="por evaluar" accent />
        <KpiCard label="Urgentes" value={urgent.length} sub="prioridad de compra" alert={urgent.length > 0} />
        <KpiCard label="Aprobadas" value={approved.length} sub="con fondos" />
        <KpiCard label="Completadas" value={completed.length} sub="cerradas" />
        <KpiCard label="Valor filtrado" value={formatCurrency(visibleTotal)} sub="cantidad x precio total" />
      </div>
      <Segmented value={filter} onChange={(value) => setFilter(value as PurchaseOrderStatus | "todas")} options={[["pendiente", "Pendientes"], ["urgente", "Urgentes"], ["aprobado", "Aprobadas"], ["completado", "Completadas"], ["todas", "Todas"]]} />
      {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <Card className="mt-5 p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#EDE8E3]">
                {["Orden", "Requi", "Fecha", "Sucursal", "Solicitó", "Items", "Valor", "Estado", "Acciones"].map((label) => (
                  <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => {
                const draftStatus = getDraftStatus(order);
                const canDownload = order.status === "aprobado" || order.status === "completado";
                return (
                <tr key={order.id} className="border-b border-[#F5F1EE] transition hover:bg-[#FAFAF7]">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-[#B45309]">{order.folio}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-stone-700">{order.requisition_folio}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{formatDate(order.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{order.location_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{order.requested_by_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{order.items_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-stone-950">{formatCurrency(order.estimated_total)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><Badge status={order.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {canManagePurchases ? (
                        <>
                          <select
                            value={draftStatus}
                            onChange={(event) => setStatusDrafts((current) => ({ ...current, [order.id]: event.target.value as PurchaseOrderStatus }))}
                            disabled={statusLoadingId === order.id}
                            className="field-input h-9 min-w-[130px] bg-white text-xs disabled:opacity-70"
                          >
                            {PURCHASE_ORDER_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          <button
                            type="button"
                            disabled={draftStatus === order.status || statusLoadingId === order.id}
                            onClick={() => void updateStatus(order)}
                            className="rounded-lg border border-[#DDD7D1] px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-[#F5F1EE] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {statusLoadingId === order.id ? "Guardando..." : "Guardar"}
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        disabled={!canDownload || loadingId === order.id}
                        title={canDownload ? "Descargar orden de compra" : "Aprueba la compra para generar la orden"}
                        onClick={() => void generatePurchaseOrder(order.id)}
                        className="rounded-lg bg-[#1C1917] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#2D2926] disabled:cursor-not-allowed disabled:bg-stone-300"
                      >
                        {loadingId === order.id ? "Generando..." : "Orden PDF"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? <EmptyState message="No hay órdenes de compra en este filtro" /> : null}
      </Card>
    </div>
  );
}

function SimpleOpsView({ title, subtitle, records, columns }: { title: string; subtitle: string; records: SampleRecord[]; columns: string[] }) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="mt-6 p-0">
        <DataTable
          columns={columns.map((column) => [column, humanize(column)])}
          rows={records}
          renderCell={(key, row) => {
            const value = row[key];
            if (key === "estado" || key === "tipo") return <Badge status={String(value)} />;
            if (key === "monto" || key === "valor") return formatCurrency(value);
            if (typeof value === "boolean") return value ? "Sí" : "No";
            return String(value ?? "—");
          }}
        />
        {records.length === 0 ? <EmptyState message="Sin registros para esta sucursal" /> : null}
      </Card>
    </div>
  );
}

function ProductionView({ areas }: { areas: SupplyArea[] }) {
  return (
    <div>
      <PageHeader title="Producción diaria y mermas" subtitle="Teran · Panadería y Repostería" />
      <div className="mb-6 mt-6 grid gap-3 md:grid-cols-4">
        <KpiCard label="Áreas activas" value={areas.length} />
        <KpiCard label="Lotes en curso" value={2} accent />
        <KpiCard label="Merma hoy" value={5} alert />
        <KpiCard label="Eficiencia" value="94%" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {["Producción Panadería", "Producción Repostería"].map((area) => (
          <Card key={area}>
            <SectionHeader title={area.replace("Producción ", "")} />
            <div className="space-y-3">
              <ProductionRow product={area.includes("Panadería") ? "Baguette clásica" : "Pastel de chocolate"} planned={area.includes("Panadería") ? 60 : 12} done={area.includes("Panadería") ? 58 : 11} />
              <ProductionRow product={area.includes("Panadería") ? "Croissant" : "Macaron"} planned={area.includes("Panadería") ? 48 : 100} done={area.includes("Panadería") ? 45 : 0} active={area.includes("Repostería")} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProductionRow({ product, planned, done, active = false }: { product: string; planned: number; done: number; active?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-[#FAFAF8] px-4 py-3">
      <div>
        <p className="text-sm font-bold text-stone-950">{product}</p>
        <p className="text-xs text-stone-500">{planned} piezas planeadas</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge status={active ? "pendiente" : "completado"} />
        <span className="text-sm font-bold text-[#B45309]">{done}</span>
      </div>
    </div>
  );
}

function Topbar({
  view,
  locations,
  selectedLocation,
  setSelectedLocation,
  setView,
  pendingCount,
}: {
  view: ViewId;
  locations: LocationRow[];
  selectedLocation: string;
  setSelectedLocation: (value: string) => void;
  setView: (value: ViewId) => void;
  pendingCount: number;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#EDE8E3] bg-white px-4 md:px-6">
      <select value={view} onChange={(event) => setView(event.target.value as ViewId)} className="field-input h-9 max-w-[170px] lg:hidden">
        {NAV_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <div className="hidden gap-1 rounded-lg bg-[#F5F1EE] p-1 md:flex">
        {["Todas", ...locations.map((location) => location.name)].map((location) => (
          <button key={location} type="button" onClick={() => setSelectedLocation(location)} className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${selectedLocation === location ? "bg-white text-stone-950 shadow-sm" : "text-stone-500 hover:text-stone-950"}`}>{location}</button>
        ))}
      </div>
      <select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)} className="field-input h-9 max-w-[180px] md:hidden">
        {["Todas", ...locations.map((location) => location.name)].map((location) => <option key={location} value={location}>{location}</option>)}
      </select>
      <div className="flex-1" />
      <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#EDE8E3] bg-white text-stone-600">
        <Icon path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        {pendingCount > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-white bg-red-600" /> : null}
      </div>
    </header>
  );
}

function SidebarLogo({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? "" : "border-b border-[#2D2926] px-5 py-5"}>
      <div className="flex items-center gap-3">
        <div className={`${large ? "h-11 w-11" : "h-8 w-8"} flex shrink-0 items-center justify-center rounded-lg bg-[#B45309] text-white`}>
          <Icon path={NAV_ITEMS[4].icon} active />
        </div>
        <div>
          <p className={`${large ? "text-lg" : "text-sm"} font-extrabold leading-none text-white`}>Kadmiel</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C9BFB8]">Supply OS</p>
        </div>
      </div>
    </div>
  );
}

function UserPanel({ user, role, onSignOut }: { user: User; role: UserRole | null; onSignOut: () => void }) {
  const initials = user.email?.slice(0, 2).toUpperCase() ?? "US";
  return (
    <div className="border-t border-[#2D2926] px-4 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#B45309]/20 text-xs font-extrabold text-[#F59E0B]">{initials}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-white">{user.email}</p>
          <p className="truncate text-[10px] text-[#C9BFB8]">{role?.role ?? "usuario"} · {role?.sucursal ?? "sin sucursal"}</p>
        </div>
        <button type="button" onClick={onSignOut} className="rounded-md px-2 py-1 text-[11px] font-bold text-[#C9BFB8] transition hover:bg-white/10 hover:text-white">Salir</button>
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-[22px] font-extrabold tracking-normal text-stone-950">{title}</h1>
      <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
    </div>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-extrabold text-stone-950">{title}</h2>
      {onAction ? <button type="button" onClick={onAction} className="text-sm font-bold text-[#B45309]">{actionLabel ?? "Ver todo"}</button> : null}
    </div>
  );
}

function KpiCard({ label, value, sub, accent = false, alert = false }: { label: string; value: string | number; sub?: string; accent?: boolean; alert?: boolean }) {
  return (
    <Card>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</p>
      <p className={`text-3xl font-extrabold leading-none ${alert ? "text-red-600" : accent ? "text-[#B45309]" : "text-stone-950"}`}>{value}</p>
      {sub ? <p className="mt-2 text-xs text-stone-400">{sub}</p> : null}
    </Card>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-[#EDE8E3] bg-white p-5 shadow-[0_1px_4px_rgba(28,25,23,0.04)] ${className}`}>{children}</div>;
}

function Badge({ status }: { status: string }) {
  const style = STATUS[status] ?? { label: humanize(status), className: "bg-stone-100 text-stone-600" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${style.className}`}>{style.label}</span>;
}

function DataTable<T extends object>({ columns, rows, renderCell }: { columns: Array<[string, string]>; rows: T[]; renderCell: (key: string, row: T) => ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#EDE8E3]">
            {columns.map(([key, label]) => <th key={key} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowKey = (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).folio ?? index;
            return (
              <tr key={String(rowKey)} className="border-b border-[#F5F1EE] transition hover:bg-[#FAFAF7]">
                {columns.map(([key]) => <td key={key} className="whitespace-nowrap px-4 py-3 text-stone-700">{renderCell(key, row)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#F5F1EE] p-1">
      {options.map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)} className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${value === key ? "bg-white text-stone-950 shadow-sm" : "text-stone-500 hover:text-stone-950"}`}>{label}</button>
      ))}
    </div>
  );
}

function Button({ children, onClick, variant = "primary", disabled = false }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary"; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`h-10 rounded-lg px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${variant === "primary" ? "bg-[#B45309] text-white hover:bg-[#963f08]" : "border border-[#DDD7D1] bg-[#F5F1EE] text-stone-700 hover:bg-[#EDE8E3]"}`}>
      {children}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
  maxWidthClass = "max-w-2xl",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  maxWidthClass?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-[2px]" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`max-h-[90dvh] w-full overflow-auto rounded-2xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.2)] ${maxWidthClass}`}>
        <div className="flex items-center justify-between border-b border-[#EDE8E3] px-6 py-5">
          <h3 className="text-lg font-extrabold text-stone-950">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 text-2xl leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-950">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.05em] text-stone-500">{label}</span>
      {children}
    </label>
  );
}

function AlertRow({ tone, message }: { tone: "red" | "amber"; message: string }) {
  const red = tone === "red";
  return (
    <div className={`flex gap-3 rounded-lg border px-3 py-2.5 ${red ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${red ? "bg-red-600" : "bg-amber-600"}`} />
      <p className="text-sm font-medium text-stone-800">{message}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-6 py-12 text-center text-sm text-stone-400">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#F5F1EE] text-[#C4B8AE]">
        <Icon path="M3 3h18v18H3zM8 9h8M8 13h5" />
      </div>
      {message}
    </div>
  );
}

function LoadingScreen() {
  return <div className="flex min-h-dvh items-center justify-center bg-[#F7F3EE] text-sm font-bold text-stone-500">Cargando Kadmiel Supply OS...</div>;
}

function Icon({ path, active = false }: { path: string; active?: boolean }) {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "currentColor"} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function formatCurrency(value: unknown) {
  return Number(value ?? 0).toLocaleString(APP_LOCALE, { currency: "MXN", maximumFractionDigits: 2, style: "currency" });
}

function formatNumber(value: unknown) {
  return Number(value ?? 0).toLocaleString(APP_LOCALE, { maximumFractionDigits: 3 });
}

function formatDate(value: string) {
  if (isIsoDateOnly(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(APP_LOCALE, {
      day: "2-digit",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
  }

  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "2-digit",
    month: "short",
    timeZone: APP_TIME_ZONE,
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: APP_TIME_ZONE,
    year: "numeric",
  }).format(new Date(value));
}

function formatDashboardDate(value: Date) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    day: "numeric",
    month: "long",
    timeZone: APP_TIME_ZONE,
    weekday: "long",
  }).format(value);
}

function filterByLocation<T extends { location_name: string }>(rows: T[], selectedLocation: string) {
  return selectedLocation === "Todas" ? rows : rows.filter((row) => row.location_name === selectedLocation);
}

function filterSample(rows: SampleRecord[], selectedLocation: string, key: string) {
  return selectedLocation === "Todas" ? rows : rows.filter((row) => row[key] === selectedLocation);
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return "Ocurrió un error inesperado.";
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
}
