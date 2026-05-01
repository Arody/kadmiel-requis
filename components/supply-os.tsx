"use client";

import type { User } from "@supabase/supabase-js";
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
  almacen: string | null;
};

type SupplyRequisitionDetail = SupplyRequisition & {
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
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

const APP_LOCALE = "es-MX";
const APP_TIME_ZONE = "America/Mexico_City";

const SAMPLE_COMPRAS: SampleRecord[] = [
  { folio: "OC-001", proveedor: "Harinera del Bajío", sucursal: "Teran", monto: 4200, estado: "pendiente" },
  { folio: "OC-002", proveedor: "Lácteos San Juan", sucursal: "San Cristobal", monto: 8750, estado: "parcial" },
  { folio: "OC-003", proveedor: "Café Origen MX", sucursal: "Aeropuerto", monto: 2100, estado: "completado" },
];

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
  const [view, setView] = useState<ViewId>("Dashboard");
  const [selectedLocation, setSelectedLocation] = useState("Todas");
  const [loading, setLoading] = useState(Boolean(supabase));
  const [dataError, setDataError] = useState<string | null>(null);

  const loadWorkspace = useCallback(
    async (activeUserId: string) => {
      if (!supabase) return;
      setDataError(null);

      const [roleRes, locationRes, productRes, areaRes, reqRes] = await Promise.all([
        supabase.from("user_roles").select("role,sucursal,department,area").eq("user_id", activeUserId).limit(1),
        supabase.from("locations").select("id,name,address").in("name", ["Teran", "San Cristobal", "Aeropuerto"]).order("name"),
        supabase.from("inventory").select("id,product,unit,unit_price,brand,presentation,image_url,almacen,location_id").order("product", { ascending: true }).limit(1000),
        supabase.rpc("list_abastecimiento_areas"),
        supabase.rpc("list_abastecimiento_requisitions"),
      ]);

      const firstError = roleRes.error ?? locationRes.error ?? productRes.error ?? areaRes.error ?? reqRes.error;
      if (firstError) setDataError(firstError.message);

      setRole((roleRes.data?.[0] as UserRole | undefined) ?? null);
      setLocations((locationRes.data as LocationRow[] | null) ?? []);
      setProducts((productRes.data as ProductRow[] | null) ?? []);
      setAreas((areaRes.data as SupplyArea[] | null) ?? []);
      setRequisitions((reqRes.data as SupplyRequisition[] | null) ?? []);
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
            <SimpleOpsView title="Compras y órdenes" subtitle="Órdenes de compra, proveedores y seguimiento" records={filterSample(SAMPLE_COMPRAS, selectedLocation, "sucursal")} columns={["folio", "proveedor", "sucursal", "monto", "estado"]} />
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
  const [detailError, setDetailError] = useState<string | null>(null);
  const canManageStatus = role?.role === "super_admin" || role?.role === "branch_admin";
  const filtered = requisitions.filter((req) => filter === "todas" || req.status === filter || req.request_type === filter);

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
    const printWindow = openBlankPdfWindow();
    if (!printWindow) {
      setDetailError("No se pudo abrir la ventana del PDF. Revisa que el navegador permita ventanas emergentes.");
      return;
    }

    setPdfLoadingId(requisitionId);
    setDetailError(null);
    try {
      const pdfDetail = detail?.id === requisitionId ? detail : await fetchDetail(requisitionId);
      writeRequisitionPdf(printWindow, pdfDetail);
    } catch (pdfError) {
      printWindow.close();
      setDetailError(getErrorMessage(pdfError));
    } finally {
      setPdfLoadingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Solicitudes internas" subtitle="Peticiones de insumos por área y sucursal" />
        <Button onClick={() => setOpen(true)}>+ Nueva Requi</Button>
      </div>
      <Segmented value={filter} onChange={setFilter} options={[["todas", "Todas"], ["pendiente", "Pendientes"], ["urgente", "Urgentes"], ["aprobado", "Aprobadas"], ["completado", "Completadas"]]} />
      {detailError ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{detailError}</p> : null}
      <Card className="mt-5 p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#EDE8E3]">
                {["ID", "Fecha", "Solicitó", "Sucursal", "Área", "Tipo", "Items", "Estado", "Acciones"].map((label) => (
                  <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => (
                <tr key={req.id} onClick={() => void openDetail(req.id)} className="cursor-pointer border-b border-[#F5F1EE] transition hover:bg-[#FAFAF7]">
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
    if (!supabase || !canManageStatus || statusDraft === detail.status) return;
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
          <Button variant="secondary" onClick={() => openRequisitionPdf(detail)}>Generar PDF</Button>
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
            <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as RequisitionStatus)} className="field-input">
              {REQUISITION_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Button disabled={statusDraft === detail.status || statusSaving} onClick={saveStatus}>{statusSaving ? "Actualizando..." : "Actualizar estado"}</Button>
        </div>
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
      brand: item.brand,
      presentation: item.presentation,
      image_url: item.image_url,
      almacen: item.almacen,
      location_id: null,
    },
  };
}

function openRequisitionPdf(detail: SupplyRequisitionDetail) {
  const printWindow = openBlankPdfWindow();
  if (!printWindow) {
    throw new Error("No se pudo abrir la ventana del PDF. Revisa que el navegador permita ventanas emergentes.");
  }

  writeRequisitionPdf(printWindow, detail);
}

function openBlankPdfWindow() {
  return window.open("", "_blank", "width=980,height=1200");
}

function writeRequisitionPdf(printWindow: Window, detail: SupplyRequisitionDetail) {
  printWindow.document.write(buildRequisitionPdfHtml(detail));
  printWindow.document.close();
}

function buildRequisitionPdfHtml(detail: SupplyRequisitionDetail) {
  const rows = detail.items.map((item, index) => {
    const image = item.image_url
      ? `<img src="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.product)}" />`
      : `<div class="thumb-fallback">${escapeHtml(getInitials(item.product))}</div>`;

    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td class="image-cell">${image}</td>
        <td>
          <strong>${escapeHtml(item.product)}</strong>
          <small>${escapeHtml(item.brand ?? "Sin marca")}</small>
        </td>
        <td>${escapeHtml(item.presentation ?? "Sin presentación")}</td>
        <td class="right">${escapeHtml(formatNumber(item.quantity))}</td>
        <td>${escapeHtml(item.unit ?? "unidad")}</td>
        <td>${escapeHtml(item.notes ?? "")}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(detail.folio)} · Kadmiel Supply OS</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f3ee; color: #1c1917; font-family: Arial, Helvetica, sans-serif; }
    main { max-width: 960px; margin: 0 auto; padding: 32px; background: #fff; min-height: 100vh; }
    header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #1c1917; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 30px; letter-spacing: 0; }
    .brand { color: #b45309; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .status { display: inline-block; border-radius: 999px; background: #f5f1ee; padding: 6px 10px; font-size: 12px; font-weight: 800; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 22px 0; }
    .box { border: 1px solid #ede8e3; border-radius: 8px; padding: 10px; }
    .box span { display: block; color: #78716c; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .box strong { display: block; margin-top: 5px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
    th { background: #f5f1ee; color: #57534e; font-size: 10px; letter-spacing: .08em; text-align: left; text-transform: uppercase; }
    th, td { border-bottom: 1px solid #ede8e3; padding: 10px; vertical-align: middle; }
    td strong { display: block; font-size: 12px; }
    td small { display: block; color: #78716c; margin-top: 3px; }
    .center { text-align: center; }
    .right { text-align: right; }
    .image-cell { width: 76px; }
    img, .thumb-fallback { width: 56px; height: 56px; border-radius: 8px; border: 1px solid #ede8e3; object-fit: cover; }
    .thumb-fallback { display: flex; align-items: center; justify-content: center; background: #f5f1ee; color: #b45309; font-weight: 900; }
    .notes { margin-top: 22px; border: 1px solid #ede8e3; border-radius: 8px; padding: 14px; min-height: 72px; }
    .notes span { display: block; color: #78716c; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .notes p { margin: 8px 0 0; line-height: 1.5; }
    footer { margin-top: 30px; color: #78716c; font-size: 11px; text-align: right; }
    @media print {
      body { background: #fff; }
      main { padding: 0; max-width: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="brand">Kadmiel Supply OS</div>
        <h1>${escapeHtml(detail.folio)}</h1>
      </div>
      <div>
        <span class="status">${escapeHtml(STATUS[detail.status]?.label ?? detail.status)}</span>
      </div>
    </header>
    <section class="meta">
      <div class="box"><span>Sucursal</span><strong>${escapeHtml(detail.location_name)}</strong></div>
      <div class="box"><span>Área</span><strong>${escapeHtml(detail.area_name ?? "Sin área")}</strong></div>
      <div class="box"><span>Tipo</span><strong>${escapeHtml(STATUS[detail.request_type]?.label ?? detail.request_type)}</strong></div>
      <div class="box"><span>Necesario para</span><strong>${escapeHtml(detail.needed_by ? formatDate(detail.needed_by) : "Sin fecha")}</strong></div>
      <div class="box"><span>Creada</span><strong>${escapeHtml(formatDateTime(detail.created_at))}</strong></div>
      <div class="box"><span>Partidas</span><strong>${escapeHtml(String(detail.items.length))}</strong></div>
      <div class="box"><span>Solicitó</span><strong>${escapeHtml(detail.requested_by_name)}</strong></div>
      <div class="box"><span>Aprobó</span><strong>${escapeHtml(detail.approved_by_name ?? "Pendiente")}</strong></div>
      <div class="box"><span>Aprobación</span><strong>${escapeHtml(detail.approved_at ? formatDateTime(detail.approved_at) : "Pendiente")}</strong></div>
    </section>
    <table>
      <thead>
        <tr>
          <th class="center">#</th>
          <th>Imagen</th>
          <th>Producto</th>
          <th>Presentación</th>
          <th class="right">Cantidad</th>
          <th>Unidad</th>
          <th>Notas</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="notes">
      <span>Notas generales</span>
      <p>${escapeHtml(detail.notes ?? "Sin notas")}</p>
    </section>
    <footer>Generado el ${escapeHtml(formatDateTime(new Date().toISOString()))}</footer>
  </main>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 350);
    });
  </script>
</body>
</html>`;
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return "Ocurrió un error inesperado.";
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
}
