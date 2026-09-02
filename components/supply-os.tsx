"use client";

import type { User } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  createBrowserSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  type AbastecimientoDomainEvent,
  useAbastecimientoRealtime,
} from "@/lib/supabase/use-abastecimiento-realtime";

type ViewId =
  | "Dashboard"
  | "Solicitudes"
  | "Compras"
  | "Recepciones"
  | "Inventario"
  | "Traspasos"
  | "Merma"
  | "Catalogo"
  | "Produccion"
  | "Calidad"
  | "MermaPV"
  | "Ajustes";

type UserRoleName = "super_admin" | "branch_admin" | "operative" | "app_user";
type RequisitionRequestType = "ordinaria" | "urgente" | "programada";
type RequisitionWorkflowStatus = "pendiente" | "revisando_compras" | "aprobada_compras" | "cancelada_compras" | "completado";
type RequisitionStatus = RequisitionWorkflowStatus | "urgente" | "revisada" | "aprobada" | "cancelada" | "completado" | "completada";
type PurchaseOrderWorkflowStatus = "revisando_gerencia" | "aprobado" | "rechazado" | "cancelado" | "completado";
type PurchaseOrderStatus = PurchaseOrderWorkflowStatus | "pendiente" | "urgente" | "completado" | "parcial";
type PurchaseOrderAction = "aprobar_contabilidad" | "aprobar_gerencia" | "rechazar" | "reenviar" | "cancelar";
type ReceivingStatus = "pendiente" | "recibida" | "en_almacen";

type UserRole = {
  role: UserRoleName;
  sucursal: string | null;
  department: string | null;
  area: string | null;
  location_id: string | null;
  area_id: string | null;
  department_id: string | null;
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
  category_id: string | null;
  warehouse_id: string | null;
  rack_id: string | null;
  delicate_management: boolean | null;
  location_ids: string[];
};

type InventoryLocationLink = {
  inventory_id: string;
  location_id: string;
};

type InventoryAreaLink = {
  inventory_id: string;
  area_id: string;
};

type InventoryDepartmentLink = {
  inventory_id: string;
  department_id: string;
};

type RequisitionDraftItem = {
  clientId: string;
  itemId?: string | null;
  productId: string;
  quantity: string;
  notes: string;
  product: ProductRow;
  selected?: boolean;
  revision_note?: string;
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
  revision_note?: string | null;
  requested_by: string;
  requested_by_name: string;
  created_at: string;
  items_count: number;
  estimated_total: number | string;
  version?: number;
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
  selected: boolean;
  revision_note: string | null;
  unit_price: number | string | null;
  unit_cost?: number | string | null;
  total_price: number | string | null;
  line_total: number | string;
  almacen: string | null;
  supplier_name?: string | null;
};

type SupplyRequisitionDetail = SupplyRequisition & {
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  cancelled_reason?: string | null;
  updated_at: string;
  items: SupplyRequisitionItem[];
};

type PurchaseOrderRow = {
  id: string;
  folio: string;
  requisition_id: string;
  requisition_folio: string;
  location_id: string | null;
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
  version?: number;
  review_cycle?: number;
  accounting_approved_by?: string | null;
  accounting_approved_by_name?: string | null;
  accounting_approved_at?: string | null;
  management_approved_by?: string | null;
  management_approved_by_name?: string | null;
  management_approved_at?: string | null;
  rejected_reason?: string | null;
  cancelled_reason?: string | null;
};

type PurchaseOrderDetail = PurchaseOrderRow & {
  area_id: string | null;
  area_name: string | null;
  requisition_approved_at: string | null;
  updated_at: string;
  items: SupplyRequisitionItem[];
};

type ReceivingOrderRow = {
  receipt_id: string | null;
  receipt_folio: string | null;
  purchase_order_id: string;
  purchase_folio: string;
  requisition_id: string;
  requisition_folio: string;
  location_id: string;
  location_name: string;
  requested_by_name: string;
  completed_at: string;
  received_at: string | null;
  stored_at?: string | null;
  status: ReceivingStatus;
  items_count: number;
  differences_count: number;
  total_ordered: number | string;
  total_received: number | string;
  version?: number;
};

type ReceivingItem = {
  receipt_item_id: string | null;
  purchase_order_item_id: string;
  product_id: string;
  product: string;
  brand: string | null;
  presentation: string | null;
  image_url: string | null;
  unit: string | null;
  requisition_quantity: number | string;
  purchased_quantity: number | string;
  received_quantity: number | string;
  quantity_difference: number | string;
  lot_code: string | null;
  expires_at: string | null;
  unit_cost: number | string | null;
  almacen: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_address: string | null;
  rack_id: string | null;
  rack_name: string | null;
  rack_position: string | null;
  storage_type: string | null;
  category_id: string | null;
  category_name: string | null;
  delicate_management: boolean;
  product_note: string | null;
  description: string | null;
};

type ReceivingOrderDetail = ReceivingOrderRow & {
  area_name: string | null;
  notes: string | null;
  items: ReceivingItem[];
};

type ReceivingDraftItem = Omit<ReceivingItem, "received_quantity" | "lot_code" | "expires_at"> & {
  received_quantity: string;
  lot_code: string;
  expires_at: string;
};

type InventoryStoredRow = {
  receipt_id: string;
  receipt_item_id: string;
  receipt_folio: string;
  purchase_order_id: string;
  purchase_folio: string;
  requisition_id: string;
  requisition_folio: string;
  location_id: string;
  location_name: string;
  stored_at: string;
  received_at: string;
  product_id: string;
  product: string;
  brand: string | null;
  presentation: string | null;
  image_url: string | null;
  unit: string | null;
  received_quantity: number | string;
  unit_cost: number | string | null;
  total_cost: number | string;
  lot_code: string | null;
  expires_at: string | null;
  almacen: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_address: string | null;
  rack_id: string | null;
  rack_name: string | null;
  rack_position: string | null;
  storage_type: string | null;
  category_id: string | null;
  category_name: string | null;
  delicate_management: boolean;
  product_note: string | null;
  base_unit: "g" | "ml" | "pieza" | null;
  received_base_quantity: number | string | null;
  consumed_base_quantity: number | string | null;
  available_base_quantity: number | string | null;
  base_unit_cost: number | string | null;
  available_value: number | string | null;
  normalization_source: "deterministic" | "minimax" | "manual" | null;
};

type InventoryReportFilters = {
  categoryLabel: string;
  dateFrom: string;
  dateTo: string;
  locationLabel: string;
  rackLabel: string;
  totalGrams: number;
  totalMilliliters: number;
  totalPieces: number;
  totalValue: number;
  warehouseLabel: string;
};

type MinimaxInventoryStatus = {
  model: "MiniMax-M3";
  configured: boolean;
  total_count: number;
  normalized_count: number;
  pending_count: number;
  recipe_output_total_count: number;
  recipe_output_normalized_count: number;
  recipe_output_pending_count: number;
};

type ProductionStockProduct = {
  stock_lot_id: string | null;
  finished_product_id: number;
  product: string;
  description: string | null;
  packaging: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  price: number | string;
  location_id: string;
  location_name: string;
  production_date: string;
  produced_quantity: number | string;
  is_custom?: boolean;
};

const LOT_UNITS = ["pieza", "L", "ml", "Kg", "g"] as const;
type LotUnit = (typeof LOT_UNITS)[number];

type ProductionBufferItem = {
  product: ProductionStockProduct;
  quantity: number;
  unit: string;
  is_custom?: boolean;
  custom_name?: string;
};

type ProductionLotSummary = {
  lot_id: string;
  version: number;
  folio: string;
  location_id: string;
  location_name: string;
  production_date: string;
  notes: string | null;
  created_by_name: string;
  created_at: string;
  items_count: number | string;
  total_quantity: number | string;
  is_verified?: boolean;
  verification_folio?: string | null;
};

type ProductionLotDetailItem = {
  finished_product_id: number;
  product: string;
  description: string | null;
  packaging: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  price: number | string;
  quantity: number | string;
  unit?: string;
};

type ProductionLotDetail = {
  lot_id: string;
  version: number;
  folio: string;
  location_id: string;
  location_name: string;
  production_date: string;
  notes: string | null;
  created_at: string;
  items: ProductionLotDetailItem[];
};

type LotConsumptionSummary = {
  lot_id: string;
  folio: string;
  location_id: string;
  location_name: string;
  production_date: string;
  notes: string | null;
  created_at: string;
  total_products_count: number;
  total_produced_pieces: number;
  total_ingredients_count: number;
  total_ingredient_cost: number;
  products_summary: string;
  top_ingredients_summary: string;
};

type LotConsumptionIngredientDetail = {
  id: string;
  ingredient_id: string | null;
  ingredient_name: string;
  quantity_consumed: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
  is_subrecipe: boolean;
  subrecipe_id: string | null;
  subrecipe_name: string | null;
};

type LotConsumptionProductDetail = {
  lot_item_id: string;
  finished_product_id: number;
  product_name: string;
  quantity: number;
  unit: string;
  has_recipe: boolean;
  recipe_name: string | null;
  recipe_yield_pieces: number | null;
  recipe_portions: number | null;
  ingredients: LotConsumptionIngredientDetail[];
};

type LotConsumptionDetail = {
  lot_id: string;
  folio: string;
  location_id: string;
  location_name: string;
  production_date: string;
  notes: string | null;
  created_at: string;
  products: LotConsumptionProductDetail[];
  totals: {
    total_ingredients_count: number;
    total_cost: number;
    total_direct_ingredients: number;
    total_subrecipe_ingredients: number;
  };
};

type QualityVerificationSummary = {
  verification_id: string;
  folio: string;
  lot_id: string | null;
  lot_folio: string | null;
  location_id: string;
  location_name: string;
  verification_date: string;
  status: string;
  has_discrepancies: boolean;
  total_declared: number | string;
  total_point_of_sale: number | string;
  total_stored_elsewhere: number | string;
  general_notes: string | null;
  verified_by_name: string;
  items_count: number | string;
  is_merma_declared?: boolean;
  merma_folio?: string | null;
  created_at: string;
};

type QualityVerificationItemDetail = {
  id?: string;
  lot_item_id?: string | null;
  finished_product_id: number;
  product_name: string;
  description: string | null;
  packaging: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  declared_quantity: number;
  point_of_sale_quantity: number;
  difference_quantity: number;
  unit?: string;
  storage_location: string | null;
  storage_notes: string | null;
  is_matched?: boolean;
};

type QualityVerificationDetail = {
  verification_id: string;
  folio: string;
  lot_id: string | null;
  lot_folio: string | null;
  location_id: string;
  location_name: string;
  verification_date: string;
  status: string;
  has_discrepancies: boolean;
  total_declared: number;
  total_point_of_sale: number;
  total_stored_elsewhere: number;
  general_notes: string | null;
  verified_by_name: string;
  created_at: string;
  items: QualityVerificationItemDetail[];
};

type QualityDraftItem = {
  finished_product_id: number;
  product_name: string;
  description: string | null;
  packaging: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  declared_quantity: number;
  point_of_sale_quantity: number;
  unit: string;
  storage_location: string;
  storage_notes: string;
  lot_item_id: string | null;
};

const QUALITY_STORAGE_LOCATIONS = [
  "Cámara Fría Central",
  "Bodega de Producto Terminado",
  "Almacén General (Tránsito)",
  "Congelador de Sucursal",
  "Merma / Dañado en Transporte",
  "Re-empaque / En Proceso",
  "Otra ubicación",
];

const MERMA_PV_REASONS = [
  "No vendido / Fin de día o turno",
  "Caducado / Fecha de consumo vencida",
  "Dañado en vitrina / mostrador",
  "Muestra / Degustación a clientes",
  "Manipulación / Caída accidental",
  "Defecto de horneo / presentación",
  "Otro motivo",
] as const;

type MermaPvReason = (typeof MERMA_PV_REASONS)[number];

const MERMA_PV_DESTINATIONS = [
  { id: "desecho", label: "🗑️ Desecho / Basura", desc: "Pérdida total" },
  { id: "recuperacion", label: "♻️ Recuperación", desc: "Reproceso / Reutilizable" },
] as const;

type MermaPvDestination = "desecho" | "recuperacion";

const RECOVERY_ACTIONS = [
  "Pan molido / Rallado",
  "Budín / Repostería secundaria",
  "Tostadas / Croutons",
  "Degustación / Muestreo",
  "Donación / Banco de alimentos",
  "Alimento de animales / Composta",
  "Otro reproceso",
] as const;

type MermaPvSummary = {
  merma_record_id: string;
  folio: string;
  verification_id: string | null;
  verification_folio: string | null;
  location_id: string;
  location_name: string;
  merma_date: string;
  total_received_pdv: number | string;
  total_merma: number | string;
  total_sold: number | string;
  total_desecho: number | string;
  total_recuperacion: number | string;
  total_desecho_value?: number | string;
  total_recuperacion_value?: number | string;
  total_merma_value?: number | string;
  merma_percentage: number | string;
  general_notes: string | null;
  registered_by_name: string;
  items_count: number | string;
  created_at: string;
};

type MermaPvItemDetail = {
  id?: string;
  quality_item_id?: string | null;
  finished_product_id: number;
  product_name: string;
  description: string | null;
  packaging: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  unit_price?: number;
  total_price?: number;
  pdv_received_quantity: number;
  merma_quantity: number;
  sold_quantity: number;
  unit: string;
  destination: string;
  recovery_action?: string | null;
  reason: string;
  notes: string | null;
};

type MermaPvDetail = {
  merma_record_id: string;
  folio: string;
  verification_id: string | null;
  verification_folio: string | null;
  location_id: string;
  location_name: string;
  merma_date: string;
  total_received_pdv: number;
  total_merma: number;
  total_sold: number;
  total_desecho: number;
  total_recuperacion: number;
  total_desecho_value?: number;
  total_recuperacion_value?: number;
  total_merma_value?: number;
  merma_percentage: number;
  general_notes: string | null;
  registered_by_name: string;
  created_at: string;
  items: MermaPvItemDetail[];
};

type MermaPvDraftItem = {
  quality_item_id: string | null;
  verification_id?: string | null;
  verification_folio?: string | null;
  finished_product_id: number;
  product_name: string;
  description: string | null;
  packaging: string | null;
  category: string | null;
  subcategory: string | null;
  image_url: string | null;
  unit_price: number;
  pdv_received_quantity: number;
  merma_quantity: number;
  unit: string;
  destination: MermaPvDestination;
  recovery_action: string;
  reason: string;
  notes: string;
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
  { id: "Produccion", label: "Producción", icon: "M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2", tag: "Sucursal" },
  { id: "Calidad", label: "Calidad", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", tag: "Sucursal" },
  { id: "MermaPV", label: "Merma PV", icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16", tag: "Sucursal" },
  { id: "Ajustes", label: "Ajustes", icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281zM15 12a3 3 0 11-6 0 3 3 0 016 0z", tag: "Administración" },
];

const STATUS: Record<string, { label: string; className: string }> = {
  pendiente: { label: "Pendiente", className: "bg-amber-100 text-amber-700" },
  revisando_compras: { label: "Revisando compras", className: "bg-blue-100 text-blue-700" },
  aprobada_compras: { label: "Aprobada por compras", className: "bg-emerald-100 text-emerald-700" },
  cancelada_compras: { label: "Cancelada por compras", className: "bg-stone-200 text-stone-600" },
  revisando_gerencia: { label: "Revisando gerencia", className: "bg-blue-100 text-blue-700" },
  aprobado: { label: "Aprobado", className: "bg-emerald-100 text-emerald-700" },
  aprobada: { label: "Aprobada", className: "bg-emerald-100 text-emerald-700" },
  recibido: { label: "Recibido", className: "bg-blue-100 text-blue-700" },
  completado: { label: "Completado", className: "bg-emerald-100 text-emerald-700" },
  parcial: { label: "Parcial", className: "bg-violet-100 text-violet-700" },
  urgente: { label: "Urgente", className: "bg-red-100 text-red-700" },
  revisada: { label: "Revisada", className: "bg-blue-100 text-blue-700" },
  en_transito: { label: "En tránsito", className: "bg-blue-100 text-blue-700" },
  rechazado: { label: "Rechazado", className: "bg-red-100 text-red-700" },
  cancelado: { label: "Cancelado", className: "bg-stone-200 text-stone-600" },
  cancelada: { label: "Cancelada", className: "bg-stone-200 text-stone-600" },
  recibida: { label: "Recibida", className: "bg-blue-100 text-blue-700" },
  en_almacen: { label: "En almacén", className: "bg-emerald-100 text-emerald-700" },
  diferencia: { label: "Con diferencia", className: "bg-red-100 text-red-700" },
  coincide: { label: "Coincide 100%", className: "bg-emerald-100 text-emerald-700" },
  con_diferencia: { label: "Con diferencia", className: "bg-amber-100 text-amber-700" },
  cuidado_especial: { label: "Cuidado especial", className: "bg-amber-100 text-amber-700" },
  ordinaria: { label: "Ordinaria", className: "bg-stone-100 text-stone-600" },
  programada: { label: "Programada", className: "bg-sky-100 text-sky-700" },
  caducidad: { label: "Caducidad", className: "bg-amber-100 text-amber-700" },
  merma: { label: "Merma", className: "bg-red-100 text-red-700" },
  sin_merma: { label: "100% Vendido (0 Merma)", className: "bg-emerald-100 text-emerald-700" },
  merma_parcial: { label: "Merma Parcial", className: "bg-amber-100 text-amber-700" },
  merma_alta: { label: "Merma Alta", className: "bg-red-100 text-red-700" },
};

const REQUEST_TYPE_OPTIONS: Array<[RequisitionRequestType, string]> = [
  ["ordinaria", "Ordinaria"],
  ["urgente", "Urgente"],
  ["programada", "Programada"],
];

const REQUISITION_STATUS_OPTIONS: Array<[RequisitionWorkflowStatus, string]> = [
  ["pendiente", "Pendiente"],
  ["revisando_compras", "Revisando compras"],
  ["aprobada_compras", "Aprobada por compras"],
  ["cancelada_compras", "Cancelada por compras"],
  ["completado", "Completada"],
];

const PURCHASE_ORDER_STATUS_OPTIONS: Array<[PurchaseOrderWorkflowStatus, string]> = [
  ["revisando_gerencia", "Revisando gerencia"],
  ["aprobado", "Aprobadas"],
  ["rechazado", "Rechazadas"],
  ["cancelado", "Canceladas"],
  ["completado", "Completadas"],
];

const APP_LOCALE = "es-MX";
const APP_TIME_ZONE = "America/Mexico_City";

const RECEIVING_STATUS_OPTIONS: Array<[ReceivingStatus, string]> = [
  ["pendiente", "Pendiente"],
  ["recibida", "Recibida"],
  ["en_almacen", "En almacén"],
];

type RealtimeDomain = "workspace" | "requisitions" | "purchases" | "receipts" | "inventory" | "production" | "quality" | "mermaPv";
type RealtimeInvalidations = Record<RealtimeDomain, number>;
type RealtimeBatch = { revision: number; events: AbastecimientoDomainEvent[] };

const INITIAL_REALTIME_INVALIDATIONS: RealtimeInvalidations = {
  workspace: 0,
  requisitions: 0,
  purchases: 0,
  receipts: 0,
  inventory: 0,
  production: 0,
  quality: 0,
  mermaPv: 0,
};

export default function SupplyOsApp() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [areas, setAreas] = useState<SupplyArea[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [requisitions, setRequisitions] = useState<SupplyRequisition[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderRow[]>([]);
  const [inventoryAreas, setInventoryAreas] = useState<InventoryAreaLink[]>([]);
  const [inventoryDepts, setInventoryDepts] = useState<InventoryDepartmentLink[]>([]);
  const [profile, setProfile] = useState<{ full_name: string | null; email: string } | null>(null);
  const [view, setView] = useState<ViewId>("Dashboard");
  const [selectedLocation, setSelectedLocation] = useState("Todas");
  const [loading, setLoading] = useState(Boolean(supabase));
  const [dataError, setDataError] = useState<string | null>(null);
  const [realtimeInvalidations, setRealtimeInvalidations] = useState<RealtimeInvalidations>(INITIAL_REALTIME_INVALIDATIONS);
  const [realtimeBatch, setRealtimeBatch] = useState<RealtimeBatch>({ revision: 0, events: [] });

  const loadWorkspace = useCallback(
    async (activeUserId: string) => {
      if (!supabase) return false;
      setDataError(null);

      const [
        roleRes,
        locationRes,
        productRes,
        inventoryLocationRes,
        areaRes,
        reqRes,
        purchaseRes,
        categoriesRes,
        deptRes,
        areaLinkRes,
        invAreasRes,
        invDeptsRes,
        profileRes
      ] = await Promise.all([
        supabase.from("user_roles").select("role,sucursal,department,area,location_id,area_id,department_id").eq("user_id", activeUserId).limit(1),
        supabase.from("locations").select("id,name,address").in("name", ["Teran", "San Cristobal", "Aeropuerto"]).order("name"),
        supabase.from("inventory").select("id,product,unit_price,total_price,brand,presentation,image_url,almacen,location_id,category_id,warehouse_id,rack_id,delicate_management").order("product", { ascending: true }).limit(1000),
        supabase.from("inventory_locations").select("inventory_id,location_id").limit(5000),
        supabase.rpc("list_abastecimiento_areas"),
        listAbastecimientoRequisitions(supabase),
        listAbastecimientoPurchaseOrders(supabase),
        supabase.from("inventory_categories").select("id,name"),
        supabase.from("location_departaments").select("id,name"),
        supabase.from("location_areas").select("id,name"),
        supabase.from("inventory_areas").select("inventory_id,area_id").limit(10000),
        supabase.from("inventory_departments").select("inventory_id,department_id").limit(10000),
        supabase.from("profiles").select("full_name,email").eq("id", activeUserId).limit(1),
      ]);

      const firstError = roleRes.error ?? locationRes.error ?? productRes.error ?? inventoryLocationRes.error ?? areaRes.error ?? reqRes.error ?? purchaseRes.error ?? categoriesRes.error ?? deptRes.error ?? areaLinkRes.error ?? invAreasRes.error ?? invDeptsRes.error ?? profileRes.error;
      if (firstError) {
        setDataError(firstError.message);
        return false;
      }

      const availabilityMap = new Map<string, string[]>();
      ((inventoryLocationRes.data as InventoryLocationLink[] | null) ?? []).forEach((link) => {
        const current = availabilityMap.get(link.inventory_id) ?? [];
        availabilityMap.set(link.inventory_id, [...current, link.location_id]);
      });

      const rawUserRole = (roleRes.data?.[0] as UserRole | undefined) ?? null;
      const dbLocations = (locationRes.data as LocationRow[] | null) ?? [];
      const dbDepts = (deptRes.data as Array<{ id: string; name: string }> | null) ?? [];
      const dbAreas = (areaLinkRes.data as Array<{ id: string; name: string }> | null) ?? [];

      const userRole = (() => {
        if (!rawUserRole) return null;
        // Resolve text names dynamically from UUIDs if they are missing
        const resolvedSucursal = rawUserRole.location_id
          ? (dbLocations.find((l) => l.id === rawUserRole.location_id)?.name ?? rawUserRole.sucursal)
          : rawUserRole.sucursal;
        const resolvedDept = rawUserRole.department_id
          ? (dbDepts.find((d) => d.id === rawUserRole.department_id)?.name ?? rawUserRole.department)
          : rawUserRole.department;
        const resolvedArea = rawUserRole.area_id
          ? (dbAreas.find((a) => a.id === rawUserRole.area_id)?.name ?? rawUserRole.area)
          : rawUserRole.area;

        return {
          ...rawUserRole,
          sucursal: resolvedSucursal,
          department: resolvedDept,
          area: resolvedArea,
        };
      })();

      let initialLocation = "Todas";
      let filteredLocations = dbLocations;

      if (userRole && userRole.role !== "super_admin") {
        const matched = userRole.location_id
          ? dbLocations.find((loc) => loc.id === userRole.location_id)
          : dbLocations.find((loc) => normalize(loc.name) === normalize(userRole.sucursal ?? ""));
        if (matched) {
          initialLocation = matched.name;
          filteredLocations = [matched];
        } else if (userRole.sucursal) {
          initialLocation = userRole.sucursal;
          filteredLocations = dbLocations.filter(
            (loc) => normalize(loc.name) === normalize(userRole.sucursal ?? "")
          );
        }
      }

      setSelectedLocation(initialLocation);

      const userLocationId = filteredLocations.length === 1 ? filteredLocations[0].id : null;

      const mappedProducts = ((productRes.data as Omit<ProductRow, "location_ids">[] | null) ?? []).map((product) => ({
        ...product,
        location_ids: availabilityMap.get(product.id) ?? [],
      }));

      let finalProducts = mappedProducts;
      let finalAreas = (areaRes.data as SupplyArea[] | null) ?? [];
      let finalRequisitions = (reqRes.data as SupplyRequisition[] | null) ?? [];
      let finalPurchaseOrders = (purchaseRes.data as PurchaseOrderRow[] | null) ?? [];

      if (userRole && userRole.role !== "super_admin" && userLocationId) {
        // Filter products: keep only if related to user's location
        finalProducts = mappedProducts.filter(
          (product) =>
            product.location_ids.includes(userLocationId) ||
            product.location_id === userLocationId
        );
        // Filter areas
        finalAreas = finalAreas.filter((area) => area.location_id === userLocationId);
        // Filter requisitions
        finalRequisitions = finalRequisitions.filter((req) => req.location_id === userLocationId);
        // Filter purchase orders
        finalPurchaseOrders = finalPurchaseOrders.filter((po) => po.location_id === userLocationId);
      }

      // Operative users can only see their own requisitions
      if (userRole && userRole.role === "operative" && !["compras", "produccion"].includes(normalize(userRole.department ?? ""))) {
        finalRequisitions = finalRequisitions.filter((req) => req.requested_by === activeUserId);
      }

      setRole(userRole);
      setLocations(filteredLocations);
      setProducts(finalProducts);
      setAreas(finalAreas);
      setCategories((categoriesRes.data as Array<{ id: string; name: string }> | null) ?? []);
      setRequisitions(finalRequisitions);
      setPurchaseOrders(finalPurchaseOrders);
      setInventoryAreas((invAreasRes.data as InventoryAreaLink[] | null) ?? []);
      setInventoryDepts((invDeptsRes.data as InventoryDepartmentLink[] | null) ?? []);
      setProfile((profileRes.data?.[0] as { full_name: string | null; email: string } | undefined) ?? null);
      return true;
    },
    [supabase],
  );

  const refreshWorkflowLists = useCallback(async () => {
    if (!supabase || !user || !role) return false;

    const [requisitionResult, purchaseResult] = await Promise.all([
      listAbastecimientoRequisitions(supabase),
      listAbastecimientoPurchaseOrders(supabase),
    ]);
    const refreshError = requisitionResult.error ?? purchaseResult.error;
    if (refreshError) {
      setDataError(refreshError.message);
      return false;
    }

    const allowedLocationIds = role?.role === "super_admin"
      ? null
      : new Set(locations.map((location) => location.id));
    let nextRequisitions = (requisitionResult.data as SupplyRequisition[] | null) ?? [];
    let nextPurchaseOrders = (purchaseResult.data as PurchaseOrderRow[] | null) ?? [];

    if (allowedLocationIds) {
      nextRequisitions = nextRequisitions.filter((row) => allowedLocationIds.has(row.location_id));
      nextPurchaseOrders = nextPurchaseOrders.filter((row) => row.location_id && allowedLocationIds.has(row.location_id));
    }
    if (role?.role === "operative" && !["compras", "produccion"].includes(normalize(role.department ?? ""))) {
      nextRequisitions = nextRequisitions.filter((row) => row.requested_by === user.id);
    }

    setRequisitions(nextRequisitions);
    setPurchaseOrders(nextPurchaseOrders);
    setDataError(null);
    return true;
  }, [locations, role, supabase, user]);

  const realtimeTopics = useMemo(() => {
    if (!user) return [];
    if (!role) return [`abastecimiento:user:${user.id}`];
    const capabilities = getRealtimeLocationCapabilities(role);
    const locationIds = capabilities.length > 0
      ? role?.role === "super_admin"
        ? locations.map((location) => location.id)
        : [role?.location_id ?? locations[0]?.id].filter((id): id is string => Boolean(id))
      : [];
    return [
      "abastecimiento:global",
      `abastecimiento:user:${user.id}`,
      ...locationIds.flatMap((locationId) => capabilities.map(
        (capability) => `abastecimiento:location:${locationId}:${capability}`,
      )),
    ];
  }, [locations, role, user]);

  const handleRealtimeInvalidation = useCallback(async (events: AbastecimientoDomainEvent[], reason: "event" | "sync") => {
    const affected = getRealtimeDomains(reason === "sync" ? [] : events);
    setRealtimeBatch((current) => ({
      revision: current.revision + 1,
      events: mergeLatestRealtimeEvents(current.events, events),
    }));
    setRealtimeInvalidations((current) => incrementRealtimeInvalidations(current, affected));
    if ((reason === "sync" || affected.has("workspace")) && user) {
      if (!await loadWorkspace(user.id)) throw new Error("No se pudo sincronizar el espacio de trabajo.");
    } else if (affected.has("requisitions") || affected.has("purchases")) {
      if (!await refreshWorkflowLists()) throw new Error("No se pudieron sincronizar los flujos de abastecimiento.");
    }
  }, [loadWorkspace, refreshWorkflowLists, user]);

  const realtimeStatus = useAbastecimientoRealtime({
    client: supabase,
    topics: realtimeTopics,
    enabled: Boolean(user),
    onInvalidate: handleRealtimeInvalidation,
  });

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
        setProfile(null);
        setRequisitions([]);
        setPurchaseOrders([]);
        setSelectedLocation("Todas");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadWorkspace, supabase]);

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginScreen supabase={supabase} onSignedIn={setUser} />;

  const pendingCount = requisitions.filter((req) => canonicalRequisitionStatus(req.status) === "pendiente").length;
  const navItems = NAV_ITEMS.filter((item) => item.id !== "Ajustes" || role?.role === "super_admin");

  return (
    <div className="flex h-dvh overflow-hidden bg-[#F7F3EE] text-stone-950">
      <aside className="hidden w-[220px] shrink-0 flex-col overflow-hidden border-r border-[#2D2926] bg-[#1C1917] lg:flex">
        <SidebarLogo />
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {navItems.map((item, index) => (
            <div key={item.id}>
              {item.tag && navItems[index - 1]?.tag !== item.tag ? (
                <div className="mx-1 mb-2 mt-3 border-t border-[#2D2926] pt-3">
                  <p className="px-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#9B8F84]">{item.tag}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setView(item.id)}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition ${view === item.id ? "bg-white/10 font-bold text-white" : "font-medium text-[#C9BFB8] hover:bg-white/[0.04]"
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
          role={role}
        />
        {dataError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 md:px-7">{dataError}</div>
        ) : null}
        {realtimeStatus === "error" ? (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 md:px-7">
            Reconectando actualizaciones en tiempo real. Los datos se sincronizarán al recuperar la conexión.
          </div>
        ) : null}
        <main className="flex-1 overflow-y-auto p-4 md:p-7">
          {view === "Dashboard" && (
            <Dashboard
              products={products}
              locations={locations}
              requisitions={requisitions}
              selectedLocation={selectedLocation}
              onNav={setView}
              profile={profile}
            />
          )}
          {view === "Solicitudes" && (
            <RequisitionsView
              supabase={supabase}
              areas={areas}
              products={products}
              locations={locations}
              requisitions={filterByLocation(requisitions, selectedLocation)}
              currentUserId={user.id}
              role={role}
              selectedLocation={selectedLocation}
              reload={async () => { await loadWorkspace(user.id); }}
              categories={categories}
              inventoryAreas={inventoryAreas}
              inventoryDepts={inventoryDepts}
              realtimeBatch={realtimeBatch}
            />
          )}
          {view === "Inventario" && <InventoryView supabase={supabase} selectedLocation={selectedLocation} role={role} refreshKey={realtimeInvalidations.inventory} />}
          {view === "Catalogo" && <CatalogView products={products} />}
          {view === "Compras" && (
            <PurchasesView
              supabase={supabase}
              purchaseOrders={filterByLocation(purchaseOrders, selectedLocation)}
              currentUserId={user.id}
              role={role}
              reload={async () => { await loadWorkspace(user.id); }}
              selectedLocation={selectedLocation}
              realtimeBatch={realtimeBatch}
            />
          )}
          {view === "Recepciones" && (
            <ReceiptsView
              supabase={supabase}
              selectedLocation={selectedLocation}
              role={role}
              refreshKey={realtimeInvalidations.receipts}
              realtimeBatch={realtimeBatch}
            />
          )}
          {view === "Traspasos" && (
            <SimpleOpsView
              supabase={supabase}
              rpc="list_abastecimiento_transfers_v2"
              refreshKey={realtimeInvalidations.inventory}
              selectedLocation={selectedLocation}
              locationKeys={["origen", "destino"]}
              title="Traspasos entre sucursales"
              subtitle="Distribución interna entre sedes y áreas"
              columns={["folio", "origen", "destino", "insumo", "cantidad", "estado"]}
            />
          )}
          {view === "Merma" && (
            <SimpleOpsView
              supabase={supabase}
              rpc="list_abastecimiento_waste_entries_v2"
              refreshKey={realtimeInvalidations.inventory}
              selectedLocation={selectedLocation}
              locationKeys={["sucursal"]}
              title="Merma y caducidad"
              subtitle="Registro y análisis de pérdidas operativas"
              columns={["folio", "sucursal", "insumo", "cantidad", "tipo", "valor"]}
            />
          )}
          {view === "Produccion" && (
            <ProductionView
              supabase={supabase}
              locations={locations}
              selectedLocation={selectedLocation}
              role={role}
              refreshKey={realtimeInvalidations.production}
              realtimeBatch={realtimeBatch}
            />
          )}
          {view === "Calidad" && (
            <QualityView
              supabase={supabase}
              locations={locations}
              selectedLocation={selectedLocation}
              role={role}
              refreshKey={realtimeInvalidations.quality}
            />
          )}
          {view === "MermaPV" && (
            <MermaPvView
              supabase={supabase}
              locations={locations}
              selectedLocation={selectedLocation}
              role={role}
              refreshKey={realtimeInvalidations.mermaPv}
            />
          )}
          {view === "Ajustes" && role?.role === "super_admin" && (
            <SettingsView supabase={supabase} refreshKey={realtimeInvalidations.workspace} />
          )}
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
        <div className="max-w-md my-auto">
          <h1 className="text-5xl font-extrabold leading-[1.02] tracking-normal">Sistema de abastecimiento Kadmiel</h1>
        </div>
        <div /> {/* Spacer */}
      </section>

      <section className="flex min-h-dvh flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[420px] flex flex-col items-center gap-6">
          <img
            src="/logo.png"
            alt="Logo Kadmiel"
            className="h-80 max-w-full w-auto object-contain shrink-0"
          />
          <form onSubmit={handleSubmit} className="w-full rounded-2xl border border-[#E5DED7] bg-white p-7 shadow-[0_18px_60px_rgba(28,25,23,0.08)]">
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
        </div>
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
  profile,
}: {
  products: ProductRow[];
  locations: LocationRow[];
  requisitions: SupplyRequisition[];
  selectedLocation: string;
  onNav: (view: ViewId) => void;
  profile: { full_name: string | null; email: string } | null;
}) {
  const visibleReqs = filterByLocation(requisitions, selectedLocation);
  const pending = visibleReqs.filter((req) => canonicalRequisitionStatus(req.status) === "pendiente");
  const urgent = visibleReqs.filter((req) => req.request_type === "urgente");
  const now = new Date();

  const hours = now.getHours();
  let greeting = "Buen día";
  if (hours >= 12 && hours < 19) {
    greeting = "Buena tarde";
  } else if (hours >= 19 || hours < 5) {
    greeting = "Buena noche";
  }
  const displayName = profile?.full_name || profile?.email || "Usuario";

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-[#EDE8E3] bg-gradient-to-r from-[#FAFAF8] to-[#F5EFEA] p-5 shadow-sm">
        <p className="text-xl font-extrabold text-stone-950">¡{greeting}, {displayName}!</p>
      </div>

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
            <AlertRow tone="amber" message={`${products.filter((item) => Number(item.unit_price ?? 0) === 0).length} productos maestros sin precio`} />
            <AlertRow tone="amber" message={`${products.filter((item) => item.location_ids.length === 0).length} productos sin sucursal asignada`} />
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
  currentUserId,
  role,
  selectedLocation,
  reload,
  categories,
  inventoryAreas,
  inventoryDepts,
  realtimeBatch,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  areas: SupplyArea[];
  products: ProductRow[];
  locations: LocationRow[];
  requisitions: SupplyRequisition[];
  currentUserId: string;
  role: UserRole | null;
  selectedLocation: string;
  reload: () => Promise<void>;
  categories: Array<{ id: string; name: string }>;
  inventoryAreas: InventoryAreaLink[];
  inventoryDepts: InventoryDepartmentLink[];
  realtimeBatch: RealtimeBatch;
}) {
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat) => {
      map.set(cat.id, cat.name);
    });
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    return getFilteredProductsForUser(products, role, categoryMap, inventoryAreas, inventoryDepts);
  }, [products, role, categoryMap, inventoryAreas, inventoryDepts]);
  const [filter, setFilter] = useState("todas");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SupplyRequisitionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [generalPdfLoading, setGeneralPdfLoading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const canManageStatus = role?.role === "super_admin" || role?.role === "branch_admin" || normalize(role?.department ?? "") === "compras";
  const filtered = requisitions.filter((req) => filter === "todas" || canonicalRequisitionStatus(req.status) === filter || req.request_type === filter);
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
      <Segmented value={filter} onChange={setFilter} options={[["todas", "Todas"], ["pendiente", "Pendientes"], ["urgente", "Urgentes"], ["revisando_compras", "En revisión"], ["aprobada_compras", "Aprobadas"], ["cancelada_compras", "Canceladas"], ["completado", "Completadas"]]} />
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
      {open ? <NewRequisitionModal supabase={supabase} selectedLocation={selectedLocation} locations={locations} areas={areas} products={filteredProducts} role={role} onClose={() => setOpen(false)} onCreated={async () => { setOpen(false); await reload(); }} /> : null}
      {detail ? (
        <RequisitionDetailModal
          key={`${detail.id}-${detail.version ?? detail.updated_at}-${detail.status}`}
          supabase={supabase}
          detail={detail}
          currentUserId={currentUserId}
          areas={areas}
          products={filteredProducts}
          locations={locations}
          role={role}
          canManageStatus={canManageStatus}
          externalChange={
            hasNewerAggregateEvent(realtimeBatch, ["requisition"], [detail.id], detail.version) ||
            hasNewerVersion(requisitions.find((row) => row.id === detail.id)?.version, detail.version)
          }
          onReload={async () => setDetail(await fetchDetail(detail.id))}
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
  currentUserId,
  areas,
  products,
  locations,
  role,
  canManageStatus,
  externalChange,
  onReload,
  onClose,
  onUpdated,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  detail: SupplyRequisitionDetail;
  currentUserId: string;
  areas: SupplyArea[];
  products: ProductRow[];
  locations: LocationRow[];
  role: UserRole | null;
  canManageStatus: boolean;
  externalChange: boolean;
  onReload: () => Promise<void>;
  onClose: () => void;
  onUpdated: (detail: SupplyRequisitionDetail) => Promise<void>;
}) {
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const [locationId, setLocationId] = useState(detail.location_id);
  const [areaId, setAreaId] = useState(detail.area_id ?? "");
  const [requestType, setRequestType] = useState<RequisitionRequestType>(detail.request_type);
  const [neededBy, setNeededBy] = useState(detail.needed_by ?? "");
  const [notes, setNotes] = useState(detail.notes ?? "");
  const revisionNote = detail.revision_note ?? "";
  const [statusDraft, setStatusDraft] = useState<RequisitionWorkflowStatus>(canonicalRequisitionStatus(detail.status));
  const [items, setItems] = useState<RequisitionDraftItem[]>(() => detail.items.map((item) => detailItemToDraftItem(item, productMap.get(item.product_id))));
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextClientId = useRef(0);
  const commandIds = useRef(new Map<string, string>());
  const availableProducts = products.filter((product) => productIsAvailableForLocation(product, locationId));
  const selectedDraftProduct = availableProducts.find((product) => product.id === draftProductId);
  const locationAreas = areas.filter((area) => area.location_id === locationId);
  const workflowStatus = canonicalRequisitionStatus(detail.status);
  const canEditContent = workflowStatus === "pendiente" && !externalChange && (
    detail.requested_by === currentUserId ||
    role?.role === "super_admin" ||
    role?.role === "branch_admin" ||
    normalize(role?.department ?? "") === "produccion"
  );
  const statusLocked = workflowStatus === "aprobada_compras" || workflowStatus === "cancelada_compras" || workflowStatus === "completado" || externalChange;
  const isBranchOrSuperAdmin = role?.role === "branch_admin" || role?.role === "super_admin";
  const canEditSelections = canManageStatus && workflowStatus === "revisando_compras" && !externalChange;
  const reviewDirty = canEditSelections && items.some((item) => {
    const persisted = detail.items.find((savedItem) => savedItem.id === item.itemId);
    return !persisted
      || (item.selected !== false) !== persisted.selected
      || (item.revision_note?.trim() || "") !== (persisted.revision_note?.trim() || "");
  });
  const canAddItem = Boolean(canEditContent && selectedDraftProduct && Number(draftQuantity) > 0);
  const statusOptions = getRequisitionStatusOptions(workflowStatus);

  const selectedTotalMoney = useMemo(() => {
    return items.reduce((sum, item) => {
      if (item.selected === false) return sum;
      const price = Number(item.product.total_price ?? item.product.unit_price ?? 0);
      return sum + (Number(item.quantity) * price);
    }, 0);
  }, [items]);

  function updateItem(clientId: string, changes: Partial<RequisitionDraftItem>) {
    setItems((current) => current.map((item) => (item.clientId === clientId ? { ...item, ...changes } : item)));
  }

  function updateItemProduct(clientId: string, productId: string) {
    const product = availableProducts.find((availableProduct) => availableProduct.id === productId) ?? productMap.get(productId);
    if (!product) return;
    setItems((current) => current.map((item) => (item.clientId === clientId ? { ...item, productId, product } : item)));
  }

  function handleLocationChange(nextLocationId: string) {
    setLocationId(nextLocationId);
    setAreaId("");
    setDraftProductId("");
    setItems((current) => current.filter((item) => productIsAvailableForLocation(item.product, nextLocationId)));
  }

  function addItem() {
    if (!selectedDraftProduct || Number(draftQuantity) <= 0) return;
    nextClientId.current += 1;
    const clientId = globalThis.crypto?.randomUUID?.() ?? `${selectedDraftProduct.id}-${nextClientId.current}`;
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
    if (!supabase || !canEditContent || saving || statusSaving) return;
    if (items.length === 0 || items.some((item) => Number(item.quantity) <= 0)) {
      setError("Cada requisición necesita al menos un producto con cantidad válida.");
      return;
    }

    setSaving(true);
    setError(null);
    const commandKey = `${detail.id}:${detail.version ?? 1}:edit-content`;
    const commandId = getCommandId(commandIds.current, commandKey);
    const payload = {
      p_area_id: areaId || null,
      p_items: items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit: "",
        notes: item.notes,
        selected: item.selected !== false,
        revision_note: item.revision_note || "",
      })),
      p_location_id: locationId,
      p_needed_by: neededBy || null,
      p_notes: notes,
      p_request_type: requestType,
      p_requisition_id: detail.id,
      p_revision_note: revisionNote || null,
    };
    const result = await supabase.rpc("update_abastecimiento_requisition_v2", {
      ...payload,
      p_command_id: commandId,
      p_expected_version: detail.version ?? 1,
    });
    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    commandIds.current.delete(commandKey);
    await onUpdated(result.data as SupplyRequisitionDetail);
  }

  async function saveReview() {
    if (!supabase || !canEditSelections || saving || statusSaving) return;
    if (items.some((item) => !item.itemId) || !items.some((item) => item.selected !== false)) {
      setError("La revisión debe incluir todas las partidas y conservar al menos una seleccionada.");
      return;
    }

    setSaving(true);
    setError(null);
    const commandKey = `${detail.id}:${detail.version ?? 1}:review-items`;
    const commandId = getCommandId(commandIds.current, commandKey);
    const result = await supabase.rpc("review_abastecimiento_requisition_items_v2", {
      p_command_id: commandId,
      p_expected_version: detail.version ?? 1,
      p_items: items.map((item) => ({
        item_id: item.itemId,
        revision_note: item.revision_note?.trim() || null,
        selected: item.selected !== false,
      })),
      p_requisition_id: detail.id,
    });
    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    commandIds.current.delete(commandKey);
    await onUpdated(result.data as SupplyRequisitionDetail);
  }

  async function saveStatus() {
    if (!supabase || !canManageStatus || statusLocked || saving || statusSaving || statusDraft === workflowStatus) return;
    if (statusDraft === "aprobada_compras" && reviewDirty) {
      setError("Guarda la revisión de partidas antes de aprobar la requisición.");
      return;
    }
    const reason = statusDraft === "cancelada_compras"
      ? globalThis.prompt("Motivo de cancelación de la requisición:")?.trim()
      : "";
    if (statusDraft === "cancelada_compras" && !reason) {
      setError("La cancelación requiere un motivo.");
      return;
    }
    setStatusSaving(true);
    setError(null);
    const commandKey = `${detail.id}:${detail.version ?? 1}:${statusDraft}`;
    const commandId = getCommandId(commandIds.current, commandKey);
    const result = await supabase.rpc("update_abastecimiento_requisition_status_v2", {
      p_command_id: commandId,
      p_expected_version: detail.version ?? 1,
      p_reason: reason || null,
      p_requisition_id: detail.id,
      p_status: statusDraft,
    });
    setStatusSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    commandIds.current.delete(commandKey);
    await onUpdated(result.data as SupplyRequisitionDetail);
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

      <div className="mt-5 grid gap-3 rounded-xl bg-[#FAFAF8] p-4 md:grid-cols-5">
        <KpiMini label="Partidas" value={items.length} />
        <KpiMini label="Cantidad total" value={items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} />
        <KpiMini label="Total Seleccionado" value={formatCurrency(selectedTotalMoney)} />
        <KpiMini label="Necesario para" value={neededBy ? formatDate(neededBy) : "Sin fecha"} />
        <KpiMini label="Última edición" value={formatDateTime(detail.updated_at)} />
      </div>

      {canManageStatus ? (
        <div className="mt-4 grid items-end gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[1fr_auto]">
          <Field label="Estado">
            <select disabled={statusLocked || saving || statusSaving} value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as RequisitionWorkflowStatus)} className="field-input disabled:opacity-70">
              {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Button disabled={statusLocked || saving || statusDraft === workflowStatus || statusSaving || (statusDraft === "aprobada_compras" && reviewDirty)} onClick={saveStatus}>{statusSaving ? "Actualizando..." : "Actualizar estado"}</Button>
        </div>
      ) : null}

      {statusDraft === "aprobada_compras" && reviewDirty ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">Guarda la revisión de partidas antes de aprobar.</p>
      ) : null}

      {externalChange ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
          <span>Esta requisición cambió en otra sesión. Recarga antes de guardar.</span>
          <Button variant="secondary" onClick={() => void onReload()}>Recargar datos</Button>
        </div>
      ) : null}

      {workflowStatus === "cancelada_compras" ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">La requisición cancelada queda bloqueada por completo.{detail.cancelled_reason ? ` Motivo: ${detail.cancelled_reason}` : ""}</p>
      ) : workflowStatus === "aprobada_compras" ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">La requisición aprobada por Compras queda bloqueada y continúa al flujo de autorización.</p>
      ) : workflowStatus === "completado" ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">La requisición se completó al ingresar la mercancía al almacén.</p>
      ) : null}

      {!canEditContent && !externalChange ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">La requisición sólo se puede editar mientras está pendiente.</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <Field label="Sucursal">
          <select disabled={!canEditContent || role?.role !== "super_admin"} value={locationId} onChange={(event) => handleLocationChange(event.target.value)} className="field-input disabled:opacity-70">
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Área">
          <select disabled={!canEditContent || role?.role !== "super_admin"} value={areaId} onChange={(event) => setAreaId(event.target.value)} className="field-input disabled:opacity-70">
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
          {items.map((item) => {
            const price = Number(item.product.total_price ?? item.product.unit_price ?? 0);
            return (
              <div key={item.clientId} className="grid gap-3 px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)_120px_minmax(180px,0.8fr)_40px] lg:items-center">
                {/* Checkbox for item selection */}
                <div className="flex items-center justify-center pt-2 lg:pt-0">
                  <input
                    type="checkbox"
                    disabled={!canEditSelections}
                    checked={item.selected !== false}
                    onChange={(event) => {
                      updateItem(item.clientId, { selected: event.target.checked });
                    }}
                    className="h-5 w-5 rounded border-[#DDD7D1] text-[#B45309] focus:ring-[#B45309] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <ProductThumb product={item.product} />
                  <div className="min-w-0 flex-1">
                    {canEditContent ? (
                      <select value={item.productId} onChange={(event) => updateItemProduct(item.clientId, event.target.value)} className="field-input bg-white">
                        {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.product} {product.presentation ? `· ${product.presentation}` : ""}</option>)}
                      </select>
                    ) : (
                      <p className="truncate text-sm font-bold text-stone-950">{item.product.product}</p>
                    )}
                    <p className="mt-1 truncate text-xs font-semibold text-stone-500">
                      {item.product.presentation ?? "Sin presentación"}
                      {price > 0 ? ` · ${formatCurrency(price)} c/u (Subtotal: ${formatCurrency(Number(item.quantity) * price)})` : ""}
                    </p>
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

                {item.selected === false ? (
                  <div className="col-span-full mt-1 border-t border-[#F5F1EE] pt-2 lg:col-start-2 lg:col-span-3">
                    <Field label="Motivo por el cual no se selecciona esta partida:">
                      <input
                        disabled={!canEditSelections}
                        value={item.revision_note ?? ""}
                        onChange={(event) => updateItem(item.clientId, { revision_note: event.target.value })}
                        className="field-input border-amber-300 bg-amber-50/20 focus:border-amber-500 focus:ring-amber-500"
                        placeholder="Ej. Hay inventario disponible, muy costoso, etc."
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {canEditContent ? (
        <div className="mt-4 rounded-xl border border-[#EDE8E3] bg-[#FAFAF8] p-4">
          <div className="grid items-end gap-4 lg:grid-cols-[1fr_140px_1fr_auto]">
            <Field label="Agregar producto">
              <select value={draftProductId} onChange={(event) => setDraftProductId(event.target.value)} className="field-input bg-white">
                <option value="">Seleccionar...</option>
                {availableProducts.map((product) => <option key={product.id} value={product.id}>{product.product} {product.presentation ? `· ${product.presentation}` : ""}</option>)}
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

      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <Field label="Notas generales">
          <textarea disabled={!canEditContent} value={notes} onChange={(event) => setNotes(event.target.value)} className="field-input min-h-20 resize-y disabled:opacity-70" placeholder="Opcional" />
        </Field>
        {isBranchOrSuperAdmin && revisionNote ? (
          <Field label="Nota de revisión general">
            <textarea
              disabled
              value={revisionNote}
              className="field-input min-h-20 resize-y border-amber-300 bg-amber-50/20 focus:border-amber-500 focus:ring-amber-500 disabled:opacity-75"
            />
          </Field>
        ) : null}
      </div>

      {error ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        {canEditContent ? <Button disabled={saving || statusSaving} onClick={saveContent}>{saving ? "Guardando..." : "Guardar cambios"}</Button> : null}
        {canEditSelections ? <Button disabled={saving || statusSaving} onClick={saveReview}>{saving ? "Guardando..." : "Guardar revisión"}</Button> : null}
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
  role,
  onClose,
  onCreated,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  selectedLocation: string;
  locations: LocationRow[];
  areas: SupplyArea[];
  products: ProductRow[];
  role: UserRole | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const defaultLocation = locations.find((location) => location.name === selectedLocation)?.id ?? locations[0]?.id ?? "";
  const [locationId, setLocationId] = useState(defaultLocation);

  const initialLocationAreas = useMemo(() => areas.filter((area) => area.location_id === defaultLocation), [areas, defaultLocation]);
  const initialAreaId = useMemo(() => {
    if (!role?.area) return "";
    const normRoleArea = normalize(role.area);
    // Try exact match first
    let matched = initialLocationAreas.find((area) => {
      return normalize(area.name) === normRoleArea;
    });
    // Fall back to substring match if no exact match is found
    if (!matched) {
      matched = initialLocationAreas.find((area) => {
        const normAreaName = normalize(area.name);
        return normAreaName.includes(normRoleArea) || normRoleArea.includes(normAreaName);
      });
    }
    return matched?.id ?? "";
  }, [initialLocationAreas, role]);

  const [areaId, setAreaId] = useState(initialAreaId);
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
  const nextClientId = useRef(0);
  const commandId = useRef(globalThis.crypto.randomUUID());
  const deferredProductSearch = useDeferredValue(productSearch);
  const availableProducts = products.filter((product) => productIsAvailableForLocation(product, locationId));
  const selectedProduct = availableProducts.find((product) => product.id === draftProductId);
  const locationAreas = areas.filter((area) => area.location_id === locationId);
  const filteredProducts = availableProducts.filter((product) =>
    `${product.product} ${product.brand ?? ""} ${product.presentation ?? ""}`.toLowerCase().includes(deferredProductSearch.trim().toLowerCase()),
  );
  const canAddItem = Boolean(selectedProduct && Number(draftQuantity) > 0);

  function handleLocationChange(nextLocationId: string) {
    setLocationId(nextLocationId);
    setAreaId("");
    setProductSearch("");
    setDraftProductId("");
    setItems((current) => current.filter((item) => productIsAvailableForLocation(item.product, nextLocationId)));
  }

  function addItem() {
    if (!selectedProduct || Number(draftQuantity) <= 0) return;
    nextClientId.current += 1;
    const clientId = globalThis.crypto?.randomUUID?.() ?? `${selectedProduct.id}-${nextClientId.current}`;
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
    const payload = {
      p_area_id: areaId || null,
      p_items: items.map((item) => ({
        product_id: item.productId,
        quantity: Number(item.quantity),
        unit: "",
        notes: item.notes,
      })),
      p_location_id: locationId,
      p_needed_by: neededBy || null,
      p_notes: notes,
      p_request_type: requestType,
    };
    const result = await supabase.rpc("create_abastecimiento_requisition_v2", {
      ...payload,
      p_command_id: commandId.current,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    await onCreated();
  }

  return (
    <Modal title="Nueva Requisición" onClose={onClose} maxWidthClass="max-w-5xl">
      <div className="grid gap-4 lg:grid-cols-4">
        <Field label="Sucursal">
          <select disabled={role?.role !== "super_admin"} value={locationId} onChange={(event) => handleLocationChange(event.target.value)} className="field-input disabled:opacity-75">
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Área">
          <select disabled={role?.role !== "super_admin"} value={areaId} onChange={(event) => setAreaId(event.target.value)} className="field-input disabled:opacity-75">
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
          <span className="rounded-full bg-[#F5F1EE] px-2.5 py-1 text-xs font-bold text-stone-600">{items.length} · {availableProducts.length} disponibles</span>
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
        <KpiMini label="Cantidad solicitada" value={items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} />
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
        </div>
      </div>
    </div>
  );
}

function ProductThumb({ product, size = "sm" }: { product: { product: string; image_url: string | null }; size?: "sm" | "lg" }) {
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

function productIsAvailableForLocation(product: ProductRow, locationId: string) {
  return product.location_ids.includes(locationId);
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
    selected: item.selected ?? true,
    revision_note: item.revision_note ?? "",
    product: product ?? {
      id: item.product_id,
      product: item.product,
      unit: null,
      unit_price: item.unit_price,
      total_price: item.total_price,
      brand: item.brand,
      presentation: item.presentation,
      image_url: item.image_url,
      almacen: item.almacen,
      location_id: null,
      category_id: null,
      warehouse_id: null,
      rack_id: null,
      delicate_management: null,
      location_ids: [],
    },
  };
}

function receivingItemToDraft(item: ReceivingItem): ReceivingDraftItem {
  return {
    ...item,
    expires_at: item.expires_at ?? "",
    lot_code: item.lot_code ?? "",
    received_quantity: String(item.received_quantity ?? ""),
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
  const cursorY = renderPdfDocumentHeader(doc, detail.folio, `Sucursal ${detail.location_name}`, formatCurrency(getRequisitionTotal(detail)));
  await renderRequisitionPdfSection(doc, detail, cursorY, false);
  renderPdfFooter(doc);
  doc.save(`${sanitizeFilename(detail.folio)}.pdf`);
}

async function downloadGeneralRequisitionPdf(details: SupplyRequisitionDetail[]) {
  const doc = createLetterPdf();
  const grandTotal = details.reduce((sum, d) => sum + getRequisitionTotal(d), 0);
  let cursorY = renderPdfDocumentHeader(doc, "Requisiciones Generales", `${details.length} requisiciones seleccionadas · ${groupByLocation(details).length} sucursales`, formatCurrency(grandTotal));
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

  const groupedItems = detail.items.reduce((acc, item) => {
    const supplierName = item.supplier_name || "Sin Proveedor";
    if (!acc[supplierName]) {
      acc[supplierName] = [];
    }
    acc[supplierName].push(item);
    return acc;
  }, {} as Record<string, SupplyRequisitionItem[]>);

  let globalIndex = 1;
  const suppliers = Object.keys(groupedItems).sort();

  for (const supplierName of suppliers) {
    const items = groupedItems[supplierName];

    cursorY = ensurePdfSpace(doc, cursorY, 28);
    if (cursorY === PDF_LAYOUT.margin) {
      cursorY = renderPurchaseOrderItemsHeader(doc, cursorY);
    }

    doc.setFillColor(...PDF_PALETTE.paper);
    doc.roundedRect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 20, 4, 4, "F");

    doc.setTextColor(...PDF_PALETTE.accent);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Proveedor: ${supplierName}`, PDF_LAYOUT.margin + 8, cursorY + 13);
    cursorY += 24;

    for (const item of items) {
      cursorY = renderPurchaseOrderItemRow(doc, item, imageMap.get(item.id) ?? null, globalIndex, cursorY);
      globalIndex++;
    }
    cursorY += 6;
  }

  cursorY = renderPurchaseOrderTotals(doc, detail, cursorY + 12);
  renderPdfNotes(doc, detail.notes ?? "Sin notas", cursorY + 10);
  renderPdfFooter(doc);
  doc.save(`orden-compra-${sanitizeFilename(detail.folio)}.pdf`);
}

async function downloadStorageOrderPdf(detail: ReceivingOrderDetail) {
  if (detail.status !== "recibida") {
    throw new Error("Solo las recepciones en estado recibida pueden generar orden de almacenamiento.");
  }

  const doc = createLetterPdf();
  const receiptLabel = detail.receipt_folio ?? detail.requisition_folio;
  let cursorY = renderPdfDocumentHeader(doc, `Orden de Almacenamiento ${receiptLabel}`, `Requisición ${detail.requisition_folio} · OC ${detail.purchase_folio}`, detail.location_name);
  cursorY = renderStorageOrderSummary(doc, detail, cursorY);
  cursorY = renderStorageOrderItemsHeader(doc, cursorY + 8);
  const imageMap = await buildReceivingItemImageMap(detail.items);

  for (const [index, item] of detail.items.entries()) {
    cursorY = renderStorageOrderItemRow(doc, item, imageMap.get(item.purchase_order_item_id) ?? null, index + 1, cursorY);
  }

  const notes = detail.notes?.trim() ? detail.notes : "Validar ubicación física, lote y caducidad antes de mover la recepción a En almacén.";
  renderPdfNotes(doc, notes, cursorY + 10);
  renderPdfFooter(doc);
  doc.save(`orden-almacenamiento-${sanitizeFilename(receiptLabel)}.pdf`);
}

function downloadInventoryReportPdf(rows: InventoryStoredRow[], filters: InventoryReportFilters) {
  const doc = createLetterPdf();
  let cursorY = renderPdfDocumentHeader(doc, "Reporte de Inventario", `${filters.locationLabel} · ${rows.length} partidas`, formatCurrency(filters.totalValue));
  cursorY = renderInventoryReportSummary(doc, filters, cursorY);
  cursorY = renderInventoryReportHeader(doc, cursorY + 8);

  for (const [index, row] of rows.entries()) {
    cursorY = renderInventoryReportRow(doc, row, index + 1, cursorY);
  }

  renderPdfFooter(doc);
  doc.save(`reporte-inventario-${sanitizeFilename(filters.locationLabel)}-${formatTodayForFilename()}.pdf`);
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

function renderStorageOrderSummary(doc: jsPDF, detail: ReceivingOrderDetail, cursorY: number) {
  const entries = [
    ["Sucursal", detail.location_name],
    ["Solicito", detail.requested_by_name],
    ["Recepcion", detail.received_at ? formatDateTime(detail.received_at) : "Pendiente"],
    ["Estado", STATUS[detail.status]?.label ?? humanize(detail.status)],
  ] as const;

  cursorY = renderPdfMetaBoxes(doc, entries, cursorY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.muted);
  doc.text("Instrucción: ubicar cada insumo en el almacén y rack definidos en el maestro de inventario.", PDF_LAYOUT.margin, cursorY + 8);
  return cursorY + 18;
}

function renderInventoryReportSummary(doc: jsPDF, filters: InventoryReportFilters, cursorY: number) {
  const entries = [
    ["Periodo", `${filters.dateFrom || "Inicio"} a ${filters.dateTo || "Hoy"}`],
    ["Almacen", filters.warehouseLabel],
    ["Rack", filters.rackLabel],
    ["Categoria", filters.categoryLabel],
  ] as const;

  cursorY = renderPdfMetaBoxes(doc, entries, cursorY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.muted);
  doc.text(
    `Disponible: ${formatNumber(filters.totalGrams)} g · ${formatNumber(filters.totalMilliliters)} ml · ${formatNumber(filters.totalPieces)} pzas · ${formatCurrency(filters.totalValue)}`,
    PDF_LAYOUT.margin,
    cursorY + 8,
  );
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

function renderStorageOrderItemsHeader(doc: jsPDF, cursorY: number) {
  cursorY = ensurePdfSpace(doc, cursorY, 26);
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.rect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_PALETTE.muted);

  getStorageOrderColumns().forEach((column) => {
    const x = PDF_LAYOUT.margin + column.x;
    doc.text(column.label, x + (column.align === "right" ? column.width - 4 : 4), cursorY + 14, {
      align: column.align,
      maxWidth: column.width - 8,
    });
  });

  return cursorY + 22;
}

function renderInventoryReportHeader(doc: jsPDF, cursorY: number) {
  cursorY = ensurePdfSpace(doc, cursorY, 26);
  doc.setFillColor(...PDF_PALETTE.paper);
  doc.rect(PDF_LAYOUT.margin, cursorY, getPdfContentWidth(), 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_PALETTE.muted);

  getInventoryReportColumns().forEach((column) => {
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
  drawPurchaseOrderCellText(doc, formatCurrency(getItemPurchasePrice(item)), columns, "price", cursorY, rowHeight, "right");
  drawPurchaseOrderCellText(doc, formatCurrency(getItemLineTotal(item)), columns, "lineTotal", cursorY, rowHeight, "right");

  return cursorY + rowHeight;
}

function renderStorageOrderItemRow(doc: jsPDF, item: ReceivingItem, imageDataUrl: string | null, index: number, cursorY: number) {
  const columns = getStorageOrderColumns();
  const productText = [item.product, item.brand ? `Marca: ${item.brand}` : null, item.presentation ?? "Sin presentacion"].filter(Boolean).join("\n");
  const destinationText = [
    item.warehouse_name ?? item.almacen ?? "Sin almacen",
    item.rack_name ? `Rack: ${item.rack_name}` : "Sin rack",
    item.rack_position ?? item.storage_type ?? null,
  ].filter(Boolean).join("\n");
  const careText = item.delicate_management
    ? ["Cuidado especial", item.product_note ?? item.description ?? null].filter(Boolean).join("\n")
    : "Normal";
  const productLines = doc.splitTextToSize(productText, getColumn(columns, "product").width - 8);
  const destinationLines = doc.splitTextToSize(destinationText, getColumn(columns, "destination").width - 8);
  const careLines = doc.splitTextToSize(careText, getColumn(columns, "care").width - 8);
  const rowHeight = Math.max(60, productLines.length * 11 + 16, destinationLines.length * 11 + 16, careLines.length * 11 + 16);

  cursorY = ensurePdfSpace(doc, cursorY, rowHeight + 12);
  if (cursorY === PDF_LAYOUT.margin) {
    cursorY = renderStorageOrderItemsHeader(doc, cursorY);
  }

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.line(PDF_LAYOUT.margin, cursorY + rowHeight, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, cursorY + rowHeight);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_PALETTE.ink);

  drawPdfCellText(doc, String(index), columns, "index", cursorY, rowHeight, "center");
  drawPdfImageCell(doc, imageDataUrl, item.product, columns, cursorY, rowHeight);
  drawPdfCellText(doc, productLines, columns, "product", cursorY, rowHeight);
  drawPdfCellText(doc, destinationLines, columns, "destination", cursorY, rowHeight);
  drawPdfCellText(doc, formatNumber(item.received_quantity), columns, "quantity", cursorY, rowHeight, "right");
  drawPdfCellText(doc, careLines, columns, "care", cursorY, rowHeight);

  return cursorY + rowHeight;
}

function renderInventoryReportRow(doc: jsPDF, row: InventoryStoredRow, index: number, cursorY: number) {
  const columns = getInventoryReportColumns();
  const productText = [
    row.product,
    row.presentation ?? null,
    row.category_name ? `Categoria: ${row.category_name}` : null,
    row.delicate_management ? "Cuidado especial" : null,
  ].filter(Boolean).join("\n");
  const destinationText = [
    row.warehouse_name ?? row.almacen ?? "Sin almacen",
    row.rack_name ? `Rack: ${row.rack_name}` : "Sin rack",
    row.rack_position ?? row.storage_type ?? null,
    row.almacen ? `Tipo: ${row.almacen}` : null,
  ].filter(Boolean).join("\n");
  const trackingText = [
    row.lot_code ? `Lote: ${row.lot_code}` : "Sin lote",
    row.expires_at ? `Cad: ${formatDate(row.expires_at)}` : "Sin cad.",
  ].join("\n");
  const productLines = doc.splitTextToSize(productText, getColumn(columns, "product").width - 8);
  const destinationLines = doc.splitTextToSize(destinationText, getColumn(columns, "destination").width - 8);
  const trackingLines = doc.splitTextToSize(trackingText, getColumn(columns, "tracking").width - 8);
  const rowHeight = Math.max(50, productLines.length * 10 + 14, destinationLines.length * 10 + 14, trackingLines.length * 10 + 14);

  cursorY = ensurePdfSpace(doc, cursorY, rowHeight + 12);
  if (cursorY === PDF_LAYOUT.margin) {
    cursorY = renderInventoryReportHeader(doc, cursorY);
  }

  doc.setDrawColor(...PDF_PALETTE.border);
  doc.line(PDF_LAYOUT.margin, cursorY + rowHeight, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, cursorY + rowHeight);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_PALETTE.ink);

  drawPdfCellText(doc, String(index), columns, "index", cursorY, rowHeight, "center");
  drawPdfCellText(doc, productLines, columns, "product", cursorY, rowHeight);
  drawPdfCellText(doc, destinationLines, columns, "destination", cursorY, rowHeight);
  drawPdfCellText(
    doc,
    row.base_unit ? `${formatNumber(row.available_base_quantity)} ${row.base_unit}` : "Pendiente",
    columns,
    "quantity",
    cursorY,
    rowHeight,
    "right",
  );
  drawPdfCellText(doc, trackingLines, columns, "tracking", cursorY, rowHeight);
  drawPdfCellText(doc, formatCurrency(row.available_value), columns, "value", cursorY, rowHeight, "right");

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

  const requisitionTotal = getRequisitionTotal(detail);
  cursorY = ensurePdfSpace(doc, cursorY, 28);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PDF_PALETTE.dark);
  doc.text(`Total Requisición: ${formatCurrency(requisitionTotal)}`, PDF_LAYOUT.pageWidth - PDF_LAYOUT.margin, cursorY + 12, { align: "right" });
  cursorY += 20;

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
  const isSelected = item.selected !== false;
  const productPrefix = isSelected ? "" : "[NO SELECCIONADO] ";
  const productText = [productPrefix + item.product, item.brand ? `Marca: ${item.brand}` : null].filter(Boolean).join("\n");
  const presentationLines = doc.splitTextToSize(item.presentation ?? "Sin presentación", getColumn(columns, "presentation").width - 8);
  const productLines = doc.splitTextToSize(productText, getColumn(columns, "product").width - 8);
  
  const combinedNotes = [
    item.notes,
    !isSelected && item.revision_note ? `Revisión: ${item.revision_note}` : null
  ].filter(Boolean).join("\n");
  const notesLines = doc.splitTextToSize(combinedNotes, getColumn(columns, "notes").width - 8);
  
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

  const price = isSelected ? Number(item.unit_price ?? item.total_price ?? 0) : 0;
  const lineTotal = isSelected ? Number(item.quantity ?? 0) * price : 0;

  drawPdfCellText(doc, String(index), columns, "index", cursorY, rowHeight, "center");
  drawPdfImageCell(doc, imageDataUrl, item.product, columns, cursorY, rowHeight);
  drawPdfCellText(doc, productLines, columns, "product", cursorY, rowHeight);
  drawPdfCellText(doc, presentationLines, columns, "presentation", cursorY, rowHeight);
  drawPdfCellText(doc, formatNumber(item.quantity), columns, "quantity", cursorY, rowHeight, "right");
  drawPdfCellText(doc, formatCurrency(price), columns, "price", cursorY, rowHeight, "right");
  drawPdfCellText(doc, formatCurrency(lineTotal), columns, "lineTotal", cursorY, rowHeight, "right");
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
    { key: "index", label: "#", x: 0, width: 20, align: "center" as const },
    { key: "image", label: "Imagen", x: 24, width: 42, align: "left" as const },
    { key: "product", label: "Producto", x: 70, width: 120, align: "left" as const },
    { key: "presentation", label: "Presentacion", x: 194, width: 76, align: "left" as const },
    { key: "quantity", label: "Cant.", x: 274, width: 40, align: "right" as const },
    { key: "price", label: "Precio", x: 318, width: 56, align: "right" as const },
    { key: "lineTotal", label: "Importe", x: 378, width: 64, align: "right" as const },
    { key: "notes", label: "Notas", x: 446, width: 90, align: "left" as const },
  ];
}

function getPurchaseOrderColumns(): PdfColumn[] {
  return [
    { key: "index", label: "#", x: 0, width: 20, align: "center" },
    { key: "image", label: "Imagen", x: 24, width: 42, align: "left" },
    { key: "product", label: "Producto", x: 70, width: 138, align: "left" },
    { key: "presentation", label: "Presentacion", x: 212, width: 88, align: "left" },
    { key: "quantity", label: "Cant.", x: 304, width: 50, align: "right" },
    { key: "price", label: "Precio", x: 358, width: 76, align: "right" },
    { key: "lineTotal", label: "Importe", x: 438, width: 98, align: "right" },
  ];
}

function getStorageOrderColumns(): PdfColumn[] {
  return [
    { key: "index", label: "#", x: 0, width: 20, align: "center" },
    { key: "image", label: "Imagen", x: 24, width: 42, align: "left" },
    { key: "product", label: "Producto", x: 70, width: 140, align: "left" },
    { key: "destination", label: "Almacen / Rack", x: 214, width: 146, align: "left" },
    { key: "quantity", label: "Cant.", x: 364, width: 54, align: "right" },
    { key: "care", label: "Cuidado", x: 422, width: 114, align: "left" },
  ];
}

function getInventoryReportColumns(): PdfColumn[] {
  return [
    { key: "index", label: "#", x: 0, width: 20, align: "center" },
    { key: "product", label: "Producto", x: 24, width: 170, align: "left" },
    { key: "destination", label: "Almacen / Rack", x: 198, width: 138, align: "left" },
    { key: "quantity", label: "Disponible", x: 340, width: 50, align: "right" },
    { key: "tracking", label: "Lote / Cad.", x: 394, width: 78, align: "left" },
    { key: "value", label: "Valor", x: 476, width: 60, align: "right" },
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
  return detail.items.reduce((sum, item) => {
    if (item.selected === false) return sum;
    return sum + getItemLineTotal(item);
  }, 0);
}

async function buildItemImageMap(items: SupplyRequisitionItem[]) {
  const entries = await Promise.all(
    items.map(async (item) => [item.id, await loadImageDataUrl(item.image_url)] as const),
  );
  return new Map(entries);
}

async function buildReceivingItemImageMap(items: ReceivingItem[]) {
  const entries = await Promise.all(
    items.map(async (item) => [item.purchase_order_item_id, await loadImageDataUrl(item.image_url)] as const),
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

function getUniqueIdOptions(values: Array<{ id: string | null; label: string | null }>, fallbackId = "sin_categoria", fallbackLabel = "Sin categoría") {
  const options = new Map<string, string>();
  values.forEach((value) => {
    options.set(value.id ?? fallbackId, value.label?.trim() || fallbackLabel);
  });
  return Array.from(options, ([id, label]) => ({ id, label })).toSorted((left, right) => left.label.localeCompare(right.label, APP_LOCALE));
}

function getOptionLabel(options: Array<{ id: string; label: string }>, value: string, allLabel: string) {
  if (value === "todos") return allLabel;
  return options.find((option) => option.id === value)?.label ?? allLabel;
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
      <PageHeader title="Catálogo de insumos" subtitle="Maestro de productos y costos" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumo, marca o presentación..." className="field-input mb-5 mt-6 max-w-sm" />
      <Card className="p-0">
        <DataTable
          columns={[["product", "Producto"], ["unit_price", "Precio"], ["brand", "Marca"], ["presentation", "Presentación"], ["almacen", "Almacén"]]}
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

function InventoryView({
  supabase,
  selectedLocation,
  role,
  refreshKey,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  selectedLocation: string;
  role: UserRole | null;
  refreshKey: number;
}) {
  const [activeTab, setActiveTab] = useState<"almacen" | "consumos">("almacen");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("todos");
  const [rackFilter, setRackFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [rows, setRows] = useState<InventoryStoredRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consumptions state
  const [consumptionLots, setConsumptionLots] = useState<LotConsumptionSummary[]>([]);
  const [consumptionLoading, setConsumptionLoading] = useState(false);
  const [consumptionSearch, setConsumptionSearch] = useState("");
  const [inspectingLotId, setInspectingLotId] = useState<string | null>(null);
  const [lotDetail, setLotDetail] = useState<LotConsumptionDetail | null>(null);
  const [lotDetailLoading, setLotDetailLoading] = useState(false);

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase.rpc("list_abastecimiento_inventory_items", {
      p_date_from: null,
      p_date_to: dateTo || null,
    });
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      setRows([]);
      return;
    }

    let fetchedRows = (data as InventoryStoredRow[] | null) ?? [];
    if (role && role.role !== "super_admin") {
      fetchedRows = fetchedRows.filter(
        (row) => normalize(row.location_name) === normalize(role.sucursal ?? "")
      );
    }
    setRows(fetchedRows);
  }, [dateTo, role, supabase]);

  const loadConsumptions = useCallback(async () => {
    if (!supabase) return;
    setConsumptionLoading(true);
    setError(null);
    const { data, error: consError } = await supabase.rpc("list_abastecimiento_production_lot_consumptions", {
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
    });
    setConsumptionLoading(false);

    if (consError) {
      setError(consError.message);
      setConsumptionLots([]);
      return;
    }

    let fetchedLots = (data as LotConsumptionSummary[] | null) ?? [];
    if (role && role.role !== "super_admin") {
      fetchedLots = fetchedLots.filter(
        (lot) => normalize(lot.location_name) === normalize(role.sucursal ?? "")
      );
    }
    setConsumptionLots(fetchedLots);
  }, [dateFrom, dateTo, role, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadRows();
      void loadConsumptions();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadRows, loadConsumptions, refreshKey]);

  const inspectLotConsumption = async (lotId: string) => {
    if (!supabase || lotDetailLoading) return;
    setInspectingLotId(lotId);
    setLotDetailLoading(true);
    setError(null);
    const { data, error: detailErr } = await supabase.rpc(
      "get_abastecimiento_production_lot_consumption_detail",
      { p_lot_id: lotId }
    );
    setLotDetailLoading(false);

    if (detailErr) {
      setError(detailErr.message);
      return;
    }

    setLotDetail(data as LotConsumptionDetail);
  };

  const scopedRows = filterByLocation(rows, selectedLocation);
  const warehouseScopedRows = scopedRows.filter((row) => warehouseFilter === "todos" || (row.warehouse_id ?? "sin_almacen") === warehouseFilter);
  const warehouseOptions = useMemo(
    () => getUniqueIdOptions(
      scopedRows.map((row) => ({ id: row.warehouse_id, label: row.warehouse_name ?? row.almacen })),
      "sin_almacen",
      "Sin almacén",
    ),
    [scopedRows],
  );
  const rackOptions = useMemo(
    () => getUniqueIdOptions(
      warehouseScopedRows.map((row) => ({ id: row.rack_id, label: row.rack_name ?? row.rack_position })),
      "sin_rack",
      "Sin rack",
    ),
    [warehouseScopedRows],
  );
  const categoryOptions = useMemo(() => getUniqueIdOptions(scopedRows.map((row) => ({ id: row.category_id, label: row.category_name }))), [scopedRows]);
  const visible = scopedRows.filter((row) => {
    const matchesWarehouse = warehouseFilter === "todos" || (row.warehouse_id ?? "sin_almacen") === warehouseFilter;
    const matchesRack = rackFilter === "todos" || (row.rack_id ?? "sin_rack") === rackFilter;
    const matchesCategory = categoryFilter === "todos" || (row.category_id ?? "sin_categoria") === categoryFilter;
    const matchesSearch = !searchQuery.trim() || [
      row.product,
      row.brand,
      row.presentation,
      row.receipt_folio,
      row.lot_code,
      row.category_name,
      row.warehouse_name,
      row.almacen
    ].some((val) => val && val.toLowerCase().includes(searchQuery.toLowerCase().trim()));

    return matchesWarehouse && matchesRack && matchesCategory && matchesSearch;
  });
  const totalGrams = visible.reduce((sum, row) => sum + (row.base_unit === "g" ? Number(row.available_base_quantity ?? 0) : 0), 0);
  const totalMilliliters = visible.reduce((sum, row) => sum + (row.base_unit === "ml" ? Number(row.available_base_quantity ?? 0) : 0), 0);
  const totalPieces = visible.reduce((sum, row) => sum + (row.base_unit === "pieza" ? Number(row.available_base_quantity ?? 0) : 0), 0);
  const totalValue = visible.reduce((sum, row) => sum + Number(row.available_value ?? 0), 0);

  // Consumptions filtered
  const scopedConsumptionLots = filterByLocation(consumptionLots, selectedLocation);
  const visibleConsumptionLots = scopedConsumptionLots.filter((lot) => {
    if (!consumptionSearch.trim()) return true;
    const q = consumptionSearch.toLowerCase();
    return (
      lot.folio.toLowerCase().includes(q) ||
      lot.location_name.toLowerCase().includes(q) ||
      (lot.products_summary ?? "").toLowerCase().includes(q) ||
      (lot.top_ingredients_summary ?? "").toLowerCase().includes(q) ||
      (lot.notes ?? "").toLowerCase().includes(q)
    );
  });
  const totalConsumptionPieces = visibleConsumptionLots.reduce((sum, lot) => sum + Number(lot.total_produced_pieces ?? 0), 0);
  const totalConsumptionIngredients = visibleConsumptionLots.reduce((sum, lot) => sum + Number(lot.total_ingredients_count ?? 0), 0);
  const totalConsumptionCost = visibleConsumptionLots.reduce((sum, lot) => sum + Number(lot.total_ingredient_cost ?? 0), 0);

  function generateInventoryReport() {
    if (visible.length === 0) return;
    setReportLoading(true);
    setError(null);
    try {
      downloadInventoryReportPdf(visible, {
        categoryLabel: getOptionLabel(categoryOptions, categoryFilter, "Todas"),
        dateFrom: "",
        dateTo,
        locationLabel: selectedLocation,
        rackLabel: getOptionLabel(rackOptions, rackFilter, "Todos"),
        totalGrams,
        totalMilliliters,
        totalPieces,
        totalValue,
        warehouseLabel: getOptionLabel(warehouseOptions, warehouseFilter, "Todos"),
      });
    } catch (reportError) {
      setError(getErrorMessage(reportError));
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Inventario y existencias" subtitle={`Control de insumos y consumos · ${selectedLocation}`} />
        <div className="flex flex-wrap items-center gap-2">
          {/* Subtabs Switcher */}
          <div className="inline-flex rounded-xl bg-[#EFECE6] p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab("almacen")}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-black transition ${
                activeTab === "almacen"
                  ? "bg-white text-stone-950 shadow-sm"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              <span>📦 Almacén y Stock</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("consumos")}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-black transition ${
                activeTab === "consumos"
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-stone-600 hover:text-stone-950"
              }`}
            >
              <span>🥣 Consumo por Lotes</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                activeTab === "consumos" ? "bg-amber-700 text-white" : "bg-stone-200 text-stone-700"
              }`}>
                {scopedConsumptionLots.length}
              </span>
            </button>
          </div>

          <Button
            variant="secondary"
            disabled={loading || consumptionLoading}
            onClick={() => {
              void loadRows();
              void loadConsumptions();
            }}
          >
            {loading || consumptionLoading ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </div>

      {error ? <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

      {/* TAB 1: ALMACEN Y EXISTENCIAS */}
      {activeTab === "almacen" && (
        <div>
          <div className="grid gap-3 md:grid-cols-4">
            <KpiCard label="Disponible en gramos" value={formatNumber(totalGrams)} sub="g" accent />
            <KpiCard label="Disponible en mililitros" value={formatNumber(totalMilliliters)} sub="ml" />
            <KpiCard label="Disponible en piezas" value={formatNumber(totalPieces)} sub="pzas" />
            <KpiCard label="Valor disponible" value={formatCurrency(totalValue)} />
          </div>

          <div className="mt-5 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-2 xl:grid-cols-[1.5fr_160px_140px_130px_140px_auto] xl:items-end">
            <Field label="Buscar insumo / producto">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="field-input"
                placeholder="Nombre del insumo, marca, presentación..."
              />
            </Field>
            <Field label="Existencias al corte de">
              <input value={dateTo} onChange={(event) => setDateTo(event.target.value)} type="date" className="field-input" />
            </Field>
            <Field label="Almacén">
              <select
                value={warehouseFilter}
                onChange={(event) => {
                  setWarehouseFilter(event.target.value);
                  setRackFilter("todos");
                }}
                className="field-input"
              >
                <option value="todos">Todos</option>
                {warehouseOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Rack">
              <select value={rackFilter} onChange={(event) => setRackFilter(event.target.value)} className="field-input">
                <option value="todos">Todos</option>
                {rackOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Categoría">
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="field-input">
                <option value="todos">Todas</option>
                {categoryOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </Field>
            <div className="mb-4 flex flex-col gap-2">
              <Button disabled={visible.length === 0 || reportLoading} onClick={() => void generateInventoryReport()}>
                {reportLoading ? "Generando..." : "Reporte PDF"}
              </Button>
              <div className="rounded-lg bg-[#FAFAF8] px-3 py-2 text-center text-xs font-bold text-stone-500">
                {visible.length} de {scopedRows.length} partidas
              </div>
            </div>
          </div>

          <Card className="mt-5 p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#EDE8E3]">
                    {["Ingreso", "Producto", "Sucursal", "Almacén", "Rack", "Categoría", "Existencia base", "Lote", "Caducidad", "Cuidado", "Valor disponible"].map((label) => (
                      <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.receipt_item_id} className="border-b border-[#F5F1EE] transition hover:bg-[#FAFAF7]">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-bold text-[#B45309]">{row.receipt_folio}</p>
                        <p className="text-xs font-semibold text-stone-500">{formatDate(row.stored_at)}</p>
                      </td>
                      <td className="min-w-[280px] px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <ProductThumb product={row} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-stone-950">{row.product}</p>
                            <p className="truncate text-xs font-semibold text-stone-500">{row.presentation ?? "Sin presentación"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.location_name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-700">
                        <p className="font-semibold text-stone-800">{row.warehouse_name ?? row.almacen ?? "Sin almacén"}</p>
                        <p className="text-xs text-stone-500">{row.almacen ?? "Sin tipo"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-700">
                        <p className="font-semibold text-stone-800">{row.rack_name ?? "Sin rack"}</p>
                        <p className="text-xs text-stone-500">{row.rack_position ?? row.storage_type ?? "—"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.category_name ?? "Sin categoría"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {row.base_unit ? (
                          <>
                            <p className="font-bold text-stone-950">{formatNumber(row.available_base_quantity)} {row.base_unit}</p>
                            <p className="text-xs font-semibold text-stone-500">
                              Recibido {formatNumber(row.received_base_quantity)} · Consumido {formatNumber(row.consumed_base_quantity)}
                            </p>
                          </>
                        ) : (
                          <span className="font-semibold text-amber-700">Pendiente de normalizar</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.lot_code || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.expires_at ? formatDate(row.expires_at) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">{row.delicate_management ? <Badge status="cuidado_especial" /> : <span className="text-stone-400">Normal</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-bold text-stone-950">{formatCurrency(row.available_value)}</p>
                        {row.base_unit ? <p className="text-xs font-semibold text-stone-500">{formatCurrency(row.base_unit_cost)} / {row.base_unit}</p> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loading ? <EmptyState message="Cargando inventario..." /> : null}
            {!loading && visible.length === 0 ? <EmptyState message="No hay partidas en almacén con estos filtros" /> : null}
          </Card>
        </div>
      )}

      {/* TAB 2: CONSUMO DE INSUMOS POR LOTES */}
      {activeTab === "consumos" && (
        <div>
          <div className="grid gap-3 md:grid-cols-4">
            <KpiCard label="Lotes procesados" value={visibleConsumptionLots.length} sub={`de ${scopedConsumptionLots.length}`} accent />
            <KpiCard label="Cantidad producida" value={formatNumber(totalConsumptionPieces)} />
            <KpiCard label="Insumos consumidos" value={formatNumber(totalConsumptionIngredients)} sub="partidas de receta" />
            <KpiCard label="Costo total de insumos" value={formatCurrency(totalConsumptionCost)} />
          </div>

          <div className="mt-5 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[180px_180px_1fr_auto] md:items-end">
            <Field label="Fecha inicial">
              <input value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} type="date" className="field-input" />
            </Field>
            <Field label="Fecha final">
              <input value={dateTo} onChange={(event) => setDateTo(event.target.value)} type="date" className="field-input" />
            </Field>
            <Field label="Buscar lote, producto o insumo">
              <input
                value={consumptionSearch}
                onChange={(event) => setConsumptionSearch(event.target.value)}
                className="field-input"
                placeholder="PROD-..., Alfajor, Harina, Mantequilla..."
              />
            </Field>
            <div className="mb-4 rounded-lg bg-[#FAFAF8] px-3 py-2 text-center text-xs font-bold text-stone-500">
              {visibleConsumptionLots.length} lotes
            </div>
          </div>

          {consumptionLoading ? (
            <div className="mt-6">
              <EmptyState message="Calculando y cargando consumo de insumos..." />
            </div>
          ) : visibleConsumptionLots.length === 0 ? (
            <div className="mt-6">
              <EmptyState message="No hay consumos de lotes de producción para los filtros seleccionados." />
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {visibleConsumptionLots.map((lot) => (
                <div
                  key={lot.lot_id}
                  className="overflow-hidden rounded-2xl border border-[#EDE8E3] bg-white p-5 shadow-[0_1px_4px_rgba(28,25,23,0.04)] transition hover:border-[#D6C9BF] hover:shadow-[0_8px_24px_rgba(28,25,23,0.08)]"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between border-b border-[#F5F1EE] pb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-[#B45309] text-base">{lot.folio}</span>
                        <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-black text-amber-900">
                          {lot.location_name}
                        </span>
                        <span className="text-xs font-bold text-stone-400">
                          · {formatDate(lot.production_date)}
                        </span>
                      </div>
                      {lot.notes ? (
                        <p className="text-xs text-stone-500 italic">Notas: {lot.notes}</p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400">Costo en Insumos</p>
                        <p className="text-lg font-black text-stone-950">{formatCurrency(lot.total_ingredient_cost)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void inspectLotConsumption(lot.lot_id)}
                        disabled={lotDetailLoading && inspectingLotId === lot.lot_id}
                        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-extrabold text-amber-950 transition hover:bg-amber-100 shadow-sm"
                      >
                        {lotDetailLoading && inspectingLotId === lot.lot_id ? "Cargando..." : "🥣 Ver Desglose de Insumos"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl bg-[#FAFAF8] p-3.5 border border-[#EDE8E3]">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-stone-500 mb-2">
                        🧁 Productos Producidos ({lot.total_products_count} productos · {formatNumber(lot.total_produced_pieces)} piezas)
                      </p>
                      <p className="text-xs font-semibold text-stone-800 leading-relaxed">
                        {lot.products_summary}
                      </p>
                    </div>

                    <div className="rounded-xl bg-amber-50/40 p-3.5 border border-amber-200/60">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-900 mb-2">
                        🌾 Insumos Clave Requeridos ({lot.total_ingredients_count} partidas)
                      </p>
                      <p className="text-xs font-semibold text-stone-700 leading-relaxed line-clamp-2">
                        {lot.top_ingredients_summary}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: DESGLOSE DE CONSUMO DE INSUMOS POR LOTE */}
      {lotDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 backdrop-blur-sm">
          <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-3xl border border-[#EDE8E3] bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#EDE8E3] p-6 bg-[#FAFAF8] rounded-t-3xl">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-sm font-black text-white">🥣</span>
                  <h3 className="text-xl font-black text-stone-950">Desglose de Insumos del Lote</h3>
                  <span className="rounded-lg bg-stone-200 px-2.5 py-0.5 text-xs font-extrabold text-stone-800">{lotDetail.folio}</span>
                </div>
                <p className="mt-1 text-xs font-bold text-stone-500">
                  {lotDetail.location_name} · Producción del {formatDate(lotDetail.production_date)}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400">Costo Total Lote</p>
                  <p className="text-xl font-black text-amber-900">{formatCurrency(lotDetail.totals.total_cost)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLotDetail(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-lg font-bold text-stone-500 transition hover:bg-stone-200 hover:text-stone-950"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {lotDetail.notes ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
                  <span className="font-bold">Notas del Lote:</span> {lotDetail.notes}
                </div>
              ) : null}

              {lotDetail.products.map((prod) => (
                <div key={prod.lot_item_id} className="rounded-2xl border border-[#EDE8E3] bg-white overflow-hidden shadow-sm">
                  {/* Product Header */}
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between bg-[#F7F4F0] p-4 border-b border-[#EDE8E3]">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-base font-extrabold text-stone-950">{prod.product_name}</p>
                        <span className="rounded-md bg-stone-900 px-2 py-0.5 text-xs font-bold text-white">
                          {formatNumber(prod.quantity)} {prod.unit}
                        </span>
                      </div>
                      {prod.has_recipe ? (
                        <p className="mt-0.5 text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                          <span>📜 Receta: <b>{prod.recipe_name}</b></span>
                          <span className="text-stone-400">·</span>
                          <span>Rendimiento: <b>{prod.recipe_yield_pieces || prod.recipe_portions || 1} pz</b></span>
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs font-bold text-amber-700">
                          ✨ Producto comodín sin receta (no descuenta insumos)
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400">Costo Insumos</p>
                      <p className="text-sm font-black text-stone-950">
                        {formatCurrency(prod.ingredients.reduce((s, ing) => s + Number(ing.total_cost || 0), 0))}
                      </p>
                    </div>
                  </div>

                  {/* Ingredients Table */}
                  {prod.ingredients.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#EDE8E3] bg-white text-stone-400 text-[10px] font-black uppercase tracking-wider">
                            <th className="px-4 py-2.5">Insumo / Materia Prima</th>
                            <th className="px-4 py-2.5">Origen / Receta</th>
                            <th className="px-4 py-2.5 text-right">Cantidad Consumida</th>
                            <th className="px-4 py-2.5 text-right">Costo Unitario</th>
                            <th className="px-4 py-2.5 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F5F1EE]">
                          {prod.ingredients.map((ing) => (
                            <tr key={ing.id} className="hover:bg-stone-50/80 transition">
                              <td className="px-4 py-2.5 font-bold text-stone-950">
                                {ing.ingredient_name}
                              </td>
                              <td className="px-4 py-2.5">
                                {ing.is_subrecipe ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-extrabold text-purple-900">
                                    🌿 Subreceta: {ing.subrecipe_name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-extrabold text-emerald-900">
                                    ✨ Directo
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-extrabold text-amber-950">
                                {formatNumber(ing.quantity_consumed)} {ing.unit}
                              </td>
                              <td className="px-4 py-2.5 text-right font-semibold text-stone-500">
                                {ing.unit_cost > 0 ? formatCurrency(ing.unit_cost) : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-right font-black text-stone-950">
                                {formatCurrency(ing.total_cost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-xs font-semibold text-stone-400">
                      Sin insumos asociados a este producto.
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-[#EDE8E3] bg-[#FAFAF8] p-5 rounded-b-3xl">
              <div className="flex items-center gap-4 text-xs font-bold text-stone-600">
                <span>Total Insumos: <b>{lotDetail.totals.total_ingredients_count}</b></span>
                <span>Directos: <b>{lotDetail.totals.total_direct_ingredients}</b></span>
                <span>De Subrecetas: <b>{lotDetail.totals.total_subrecipe_ingredients}</b></span>
              </div>
              <Button onClick={() => setLotDetail(null)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PurchasesView({
  supabase,
  purchaseOrders,
  currentUserId,
  role,
  reload,
  selectedLocation,
  realtimeBatch,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  purchaseOrders: PurchaseOrderRow[];
  currentUserId: string;
  role: UserRole | null;
  reload: () => Promise<void>;
  selectedLocation: string;
  realtimeBatch: RealtimeBatch;
}) {
  const [filter, setFilter] = useState<PurchaseOrderWorkflowStatus | "todas">("revisando_gerencia");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());
  const permissions = getPurchasePermissions(role);
  const canManagePurchases = permissions.accounting || permissions.management || permissions.purchasing;
  const visible = purchaseOrders.filter((order) => {
    if (filter === "todas") return true;
    return canonicalPurchaseOrderStatus(order.status) === filter;
  });
  const reviewing = purchaseOrders.filter((order) => canonicalPurchaseOrderStatus(order.status) === "revisando_gerencia");
  const urgent = purchaseOrders.filter((order) => order.request_type === "urgente");
  const approved = purchaseOrders.filter((order) => canonicalPurchaseOrderStatus(order.status) === "aprobado");
  const rejected = purchaseOrders.filter((order) => canonicalPurchaseOrderStatus(order.status) === "rechazado");
  const visibleTotal = visible.reduce((sum, order) => sum + Number(order.estimated_total ?? 0), 0);

  async function fetchDetail(purchaseOrderId: string) {
    if (!supabase) throw new Error("Supabase no está configurado.");
    const { data, error: detailError } = await supabase.rpc("get_abastecimiento_purchase_order", { p_purchase_order_id: purchaseOrderId });
    if (detailError) throw detailError;
    return data as PurchaseOrderDetail;
  }

  async function openDetail(purchaseOrderId: string) {
    setDetailLoadingId(purchaseOrderId);
    setError(null);
    try {
      setDetail(await fetchDetail(purchaseOrderId));
    } catch (purchaseError) {
      setError(getErrorMessage(purchaseError));
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function runAction(order: PurchaseOrderRow, action: PurchaseOrderAction) {
    if (!supabase || !canManagePurchases || actionLoadingKey) return false;
    const reasonRequired = action === "rechazar" || action === "cancelar";
    const reason = reasonRequired
      ? globalThis.prompt(action === "rechazar" ? "Motivo del rechazo:" : "Motivo de cancelación:")?.trim()
      : "";
    if (reasonRequired && !reason) {
      setError("La acción requiere un motivo.");
      return false;
    }

    const loadingKey = `${order.id}:${action}`;
    const commandKey = `${order.id}:${order.version ?? 1}:${action}`;
    setActionLoadingKey(loadingKey);
    setError(null);
    const commandId = getCommandId(commandIds.current, commandKey);
    const result = await supabase.rpc("update_abastecimiento_purchase_order_status_v2", {
      p_action: action,
      p_command_id: commandId,
      p_expected_version: order.version ?? 1,
      p_purchase_order_id: order.id,
      p_reason: reason || null,
    });
    setActionLoadingKey(null);

    if (result.error) {
      setError(result.error.message);
      return false;
    }

    commandIds.current.delete(commandKey);
    if (detail?.id === order.id) {
      setDetail(result.data as PurchaseOrderDetail);
    }
    await reload();
    return true;
  }

  async function generatePurchaseOrder(purchaseOrderId: string) {
    setLoadingId(purchaseOrderId);
    setError(null);
    try {
      const detail = await fetchDetail(purchaseOrderId);
      if (!["aprobado", "completado"].includes(canonicalPurchaseOrderStatus(detail.status))) {
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
        <KpiCard label="En revisión" value={reviewing.length} sub="Contabilidad y Gerencia" accent />
        <KpiCard label="Urgentes" value={urgent.length} sub="prioridad de compra" alert={urgent.length > 0} />
        <KpiCard label="Aprobadas" value={approved.length} sub="con fondos" />
        <KpiCard label="Rechazadas" value={rejected.length} sub="editables por Compras" alert={rejected.length > 0} />
        <KpiCard label="Valor filtrado" value={formatCurrency(visibleTotal)} sub="cantidad x precio total" />
      </div>
      <Segmented value={filter} onChange={(value) => setFilter(value as PurchaseOrderWorkflowStatus | "todas")} options={[["todas", "Todas"], ...PURCHASE_ORDER_STATUS_OPTIONS]} />
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
                const canDownload = ["aprobado", "completado"].includes(canonicalPurchaseOrderStatus(order.status));
                const actions = getPurchaseOrderActions(order, permissions, currentUserId);
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
                        <button type="button" onClick={() => void openDetail(order.id)} className="rounded-lg border border-[#DDD7D1] px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-[#F5F1EE]">
                          {detailLoadingId === order.id ? "Abriendo..." : canonicalPurchaseOrderStatus(order.status) === "rechazado" && permissions.purchasing ? "Editar" : "Ver"}
                        </button>
                        {actions.map(([action, label]) => (
                          <button
                            key={action}
                            type="button"
                            disabled={Boolean(actionLoadingKey)}
                            onClick={() => void runAction(order, action)}
                            className="rounded-lg border border-[#DDD7D1] px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-[#F5F1EE] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {actionLoadingKey === `${order.id}:${action}` ? "Guardando..." : label}
                          </button>
                        ))}
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
      {detail ? (
        <PurchaseOrderDetailModal
          key={`${detail.id}-${detail.version ?? detail.updated_at}-${detail.status}`}
          supabase={supabase}
          detail={detail}
          currentUserId={currentUserId}
          permissions={permissions}
          externalChange={
            hasNewerAggregateEvent(realtimeBatch, ["purchase_order"], [detail.id], detail.version) ||
            hasNewerVersion(purchaseOrders.find((row) => row.id === detail.id)?.version, detail.version)
          }
          actionLoadingKey={actionLoadingKey}
          onAction={runAction}
          onClose={() => setDetail(null)}
          onReload={() => openDetail(detail.id)}
          onUpdated={async (updated) => {
            setDetail(updated);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PurchaseOrderDetailModal({
  supabase,
  detail,
  currentUserId,
  permissions,
  externalChange,
  actionLoadingKey,
  onAction,
  onClose,
  onReload,
  onUpdated,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  detail: PurchaseOrderDetail;
  currentUserId: string;
  permissions: PurchasePermissions;
  externalChange: boolean;
  actionLoadingKey: string | null;
  onAction: (order: PurchaseOrderRow, action: PurchaseOrderAction) => Promise<boolean>;
  onClose: () => void;
  onReload: () => Promise<void>;
  onUpdated: (detail: PurchaseOrderDetail) => Promise<void>;
}) {
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [items, setItems] = useState(() => detail.items.map((item) => ({
    ...item,
    quantity: String(item.quantity ?? ""),
    unit_price: String(item.unit_cost ?? item.unit_price ?? 0),
  })));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());
  const status = canonicalPurchaseOrderStatus(detail.status);
  const canEdit = status === "rechazado" && permissions.purchasing && !externalChange;
  const total = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const actions = getPurchaseOrderActions(detail, permissions, currentUserId);

  function updateItem(itemId: string, changes: { quantity?: string; unit_price?: string }) {
    setDirty(true);
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...changes } : item));
  }

  async function saveChanges() {
    if (!supabase || !canEdit || saving || actionLoadingKey) return null;
    if (items.some((item) => Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) {
      setError("Todas las partidas requieren cantidad positiva y costo no negativo.");
      return null;
    }

    setSaving(true);
    setError(null);
    const commandKey = `${detail.id}:${detail.version ?? 1}:edit`;
    const commandId = getCommandId(commandIds.current, commandKey);
    const result = await supabase.rpc("update_abastecimiento_purchase_order_v2", {
      p_command_id: commandId,
      p_expected_version: detail.version ?? 1,
      p_items: items.map((item) => ({
        purchase_order_item_id: item.id,
        quantity: Number(item.quantity),
        unit_cost: Number(item.unit_price),
      })),
      p_notes: notes.trim() || null,
      p_purchase_order_id: detail.id,
    });
    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return null;
    }

    commandIds.current.delete(commandKey);
    setDirty(false);
    const updated = result.data as PurchaseOrderDetail;
    await onUpdated(updated);
    return updated;
  }

  async function saveAndResubmit() {
    const order = dirty ? await saveChanges() : detail;
    if (order) await onAction(order, "reenviar");
  }

  return (
    <Modal title={`Orden de compra ${detail.folio}`} onClose={onClose} maxWidthClass="max-w-6xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={detail.status} />
            <Badge status={detail.request_type} />
          </div>
          <p className="mt-2 text-sm font-semibold text-stone-500">Requisición {detail.requisition_folio} · {detail.location_name} · ciclo {detail.review_cycle ?? 1}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          {status === "rechazado" && permissions.purchasing ? (
            <Button disabled={saving || Boolean(actionLoadingKey) || externalChange} onClick={() => void saveAndResubmit()}>{saving ? "Guardando..." : "Guardar y reenviar"}</Button>
          ) : null}
          {actions.map(([action, label]) => (
            <Button key={action} disabled={Boolean(actionLoadingKey) || externalChange} onClick={() => void onAction(detail, action)}>
              {actionLoadingKey === `${detail.id}:${action}` ? "Guardando..." : label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl bg-[#FAFAF8] p-4 md:grid-cols-4">
        <KpiMini label="Partidas" value={items.length} />
        <KpiMini label="Total" value={formatCurrency(total)} />
        <KpiMini label="Contabilidad" value={detail.accounting_approved_by_name ?? (detail.accounting_approved_at ? "Aprobada" : ["aprobado", "completado"].includes(status) ? "Aprobación heredada" : "Pendiente")} />
        <KpiMini label="Gerencia" value={detail.management_approved_by_name ?? (detail.management_approved_at ? "Aprobada" : ["aprobado", "completado"].includes(status) ? "Aprobación heredada" : "Pendiente")} />
      </div>

      {detail.rejected_reason ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">Motivo de rechazo: {detail.rejected_reason}</p> : null}
      {detail.cancelled_reason ? <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">Motivo de cancelación: {detail.cancelled_reason}</p> : null}
      {externalChange ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
          <span>Esta orden cambió en otra sesión. Recarga antes de continuar.</span>
          <Button variant="secondary" onClick={() => void onReload()}>Recargar datos</Button>
        </div>
      ) : null}
      {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-[#EDE8E3] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#EDE8E3]">
              {["Producto", "Proveedor", "Unidad", "Cantidad", "Costo unitario", "Subtotal"].map((label) => (
                <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[#F5F1EE]">
                <td className="min-w-[260px] px-4 py-3 font-bold text-stone-950">{item.product}</td>
                <td className="whitespace-nowrap px-4 py-3 text-stone-700">{item.supplier_name ?? "Sin proveedor"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-stone-700">{item.unit ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <input disabled={!canEdit} value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} type="number" min="0.001" step="0.001" className="field-input h-9 w-28 disabled:opacity-70" />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <input disabled={!canEdit} value={item.unit_price ?? ""} onChange={(event) => updateItem(item.id, { unit_price: event.target.value })} type="number" min="0" step="0.01" className="field-input h-9 w-32 disabled:opacity-70" />
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-bold text-stone-950">{formatCurrency(Number(item.quantity) * Number(item.unit_price))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <Field label="Notas de la orden">
          <textarea disabled={!canEdit} value={notes} onChange={(event) => { setNotes(event.target.value); setDirty(true); }} className="field-input min-h-20 resize-y disabled:opacity-70" />
        </Field>
      </div>
    </Modal>
  );
}

function ReceiptsView({
  supabase,
  selectedLocation,
  role,
  refreshKey,
  realtimeBatch,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  selectedLocation: string;
  role: UserRole | null;
  refreshKey: number;
  realtimeBatch: RealtimeBatch;
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filter, setFilter] = useState<ReceivingStatus | "todas">("pendiente");
  const [rows, setRows] = useState<ReceivingOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [storagePdfLoadingId, setStoragePdfLoadingId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceivingOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManageReceipts = canManageReceiving(role);

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await listAbastecimientoReceivingOrders(supabase, {
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
    });
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      setRows([]);
      return;
    }

    let fetchedRows = (data as ReceivingOrderRow[] | null) ?? [];
    if (role && role.role !== "super_admin") {
      fetchedRows = fetchedRows.filter(
        (row) => normalize(row.location_name) === normalize(role.sucursal ?? "")
      );
    }
    setRows(fetchedRows);
  }, [dateFrom, dateTo, role, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadRows();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadRows, refreshKey]);

  const scopedRows = filterByLocation(rows, selectedLocation);
  const visible = scopedRows.filter((row) => filter === "todas" || row.status === filter);
  const pending = scopedRows.filter((row) => row.status === "pendiente");
  const received = scopedRows.filter((row) => row.status === "recibida");
  const inWarehouse = scopedRows.filter((row) => row.status === "en_almacen");
  const differences = scopedRows.reduce((sum, row) => sum + Number(row.differences_count ?? 0), 0);
  const visiblePurchased = visible.reduce((sum, row) => sum + Number(row.total_ordered ?? 0), 0);
  const visibleReceived = visible.reduce((sum, row) => sum + Number(row.total_received ?? 0), 0);

  async function openDetail(purchaseOrderId: string) {
    if (!supabase) return;
    setDetailLoadingId(purchaseOrderId);
    setError(null);
    const { data, error: detailError } = await supabase.rpc("get_abastecimiento_receiving_order", {
      p_purchase_order_id: purchaseOrderId,
    });
    setDetailLoadingId(null);

    if (detailError) {
      setError(detailError.message);
      return;
    }

    setDetail(data as ReceivingOrderDetail);
  }

  async function generateStorageOrder(row: ReceivingOrderRow) {
    if (!supabase) return;
    if (row.status !== "recibida") {
      setError("Solo las recepciones en estado recibida pueden generar orden de almacenamiento.");
      return;
    }

    setStoragePdfLoadingId(row.purchase_order_id);
    setError(null);
    try {
      const { data, error: detailError } = await supabase.rpc("get_abastecimiento_receiving_order", {
        p_purchase_order_id: row.purchase_order_id,
      });

      if (detailError) throw detailError;
      await downloadStorageOrderPdf(data as ReceivingOrderDetail);
    } catch (pdfError) {
      setError(getErrorMessage(pdfError));
    } finally {
      setStoragePdfLoadingId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Recepción de mercancía" subtitle={`Requisiciones completadas · ${selectedLocation}`} />
        <Button variant="secondary" disabled={loading} onClick={() => void loadRows()}>{loading ? "Actualizando..." : "Actualizar"}</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Pendientes" value={pending.length} sub="sin recibir" accent />
        <KpiCard label="Recibidas" value={received.length} sub="verificadas" />
        <KpiCard label="En almacén" value={inWarehouse.length} sub="cerradas" />
        <KpiCard label="Diferencias" value={differences} sub="partidas con variación" alert={differences > 0} />
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 lg:grid-cols-[160px_160px_1fr] lg:items-end">
        <Field label="Fecha inicial">
          <input value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} type="date" className="field-input" />
        </Field>
        <Field label="Fecha final">
          <input value={dateTo} onChange={(event) => setDateTo(event.target.value)} type="date" className="field-input" />
        </Field>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented value={filter} onChange={(value) => setFilter(value as ReceivingStatus | "todas")} options={[["pendiente", "Pendientes"], ["recibida", "Recibidas"], ["en_almacen", "En almacén"], ["todas", "Todas"]]} />
          <div className="rounded-lg bg-[#FAFAF8] px-3 py-2 text-xs font-bold text-stone-500">
            Comprado {formatNumber(visiblePurchased)} · Recibido {formatNumber(visibleReceived)}
          </div>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

      <Card className="mt-5 p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#EDE8E3]">
                {["Requi", "Orden", "Completada", "Sucursal", "Solicitó", "Items", "Recibido / comprado", "Diferencias", "Estado", "Acciones"].map((label) => (
                  <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.purchase_order_id} className="border-b border-[#F5F1EE] transition hover:bg-[#FAFAF7]">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-[#B45309]">{row.requisition_folio}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-stone-700">{row.purchase_folio}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{formatDate(row.completed_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.location_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.requested_by_name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{row.items_count}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-stone-700">{formatNumber(row.total_received)} / {formatNumber(row.total_ordered)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 font-bold ${Number(row.differences_count) > 0 ? "text-red-600" : "text-emerald-700"}`}>{row.differences_count}</td>
                  <td className="whitespace-nowrap px-4 py-3"><Badge status={row.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.status === "recibida" ? (
                        <button
                          type="button"
                          disabled={storagePdfLoadingId === row.purchase_order_id}
                          onClick={() => void generateStorageOrder(row)}
                          className="rounded-lg border border-[#DDD7D1] bg-[#F5F1EE] px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-[#EDE8E3] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {storagePdfLoadingId === row.purchase_order_id ? "Generando..." : "Orden almacén"}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void openDetail(row.purchase_order_id)} className="rounded-lg bg-[#1C1917] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#2D2926]">
                        {detailLoadingId === row.purchase_order_id ? "Abriendo..." : row.status === "pendiente" && canManageReceipts ? "Recibir" : "Ver"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? <EmptyState message="Cargando recepciones..." /> : null}
        {!loading && visible.length === 0 ? <EmptyState message="No hay requisiciones completadas en este rango" /> : null}
      </Card>

      {detail ? (
        <ReceivingDetailModal
          supabase={supabase}
          detail={detail}
          canManage={canManageReceipts}
          externalChange={hasNewerAggregateEvent(
            realtimeBatch,
            ["receipt"],
            [detail.receipt_id, detail.purchase_order_id],
            detail.version,
          ) || hasNewerVersion(
            rows.find((row) => row.purchase_order_id === detail.purchase_order_id)?.version,
            detail.version,
          )}
          onReload={() => openDetail(detail.purchase_order_id)}
          onClose={() => setDetail(null)}
          onSaved={async (updatedDetail) => {
            setDetail(updatedDetail);
            await loadRows();
          }}
        />
      ) : null}
    </div>
  );
}

function ReceivingDetailModal({
  supabase,
  detail,
  canManage,
  externalChange,
  onReload,
  onClose,
  onSaved,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  detail: ReceivingOrderDetail;
  canManage: boolean;
  externalChange: boolean;
  onReload: () => Promise<void>;
  onClose: () => void;
  onSaved: (detail: ReceivingOrderDetail) => Promise<void>;
}) {
  const [status, setStatus] = useState<ReceivingStatus>(detail.status);
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [items, setItems] = useState<ReceivingDraftItem[]>(() => detail.items.map(receivingItemToDraft));
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandIds = useRef(new Map<string, string>());
  const locked = !canManage || detail.status === "en_almacen" || externalChange;
  const statusOptions = getReceivingStatusOptions(detail.status);
  const totalPurchased = items.reduce((sum, item) => sum + Number(item.purchased_quantity ?? 0), 0);
  const totalReceived = items.reduce((sum, item) => sum + Number(item.received_quantity || 0), 0);
  const differences = items.filter((item) => getReceivingDifference(item) !== 0).length;

  function updateItem(purchaseOrderItemId: string, changes: Partial<Pick<ReceivingDraftItem, "received_quantity" | "lot_code" | "expires_at">>) {
    setItems((current) => current.map((item) => (item.purchase_order_item_id === purchaseOrderItemId ? { ...item, ...changes } : item)));
  }

  function fillPurchasedQuantities() {
    setItems((current) => current.map((item) => ({ ...item, received_quantity: String(item.purchased_quantity ?? 0) })));
  }

  async function saveReceipt() {
    if (!supabase || !canManage || locked) return;
    if (status === "pendiente") {
      setError("Marca la mercancía como recibida antes de guardar.");
      return;
    }
    if (items.some((item) => Number(item.received_quantity || 0) < 0)) {
      setError("Las cantidades recibidas no pueden ser negativas.");
      return;
    }

    setSaving(true);
    setError(null);
    const expectedVersion = detail.receipt_id ? (detail.version ?? 1) : 0;
    const commandKey = `${detail.purchase_order_id}:${expectedVersion}:${status}`;
    const commandId = getCommandId(commandIds.current, commandKey);
    const payload = {
      p_items: items.map((item) => ({
        expires_at: item.expires_at || null,
        lot_code: item.lot_code.trim(),
        purchase_order_item_id: item.purchase_order_item_id,
        received_quantity: Number(item.received_quantity || 0),
      })),
      p_notes: notes.trim(),
      p_purchase_order_id: detail.purchase_order_id,
      p_status: status,
    };
    const result = await supabase.rpc("save_abastecimiento_receipt_v2", {
      ...payload,
      p_command_id: commandId,
      p_expected_version: expectedVersion,
    });
    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    commandIds.current.delete(commandKey);
    await onSaved(result.data as ReceivingOrderDetail);
  }

  async function generateStorageOrder() {
    if (detail.status !== "recibida") {
      setError("Solo las recepciones en estado recibida pueden generar orden de almacenamiento.");
      return;
    }

    setPdfLoading(true);
    setError(null);
    try {
      await downloadStorageOrderPdf(detail);
    } catch (pdfError) {
      setError(getErrorMessage(pdfError));
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <Modal title={`Recepción ${detail.requisition_folio}`} onClose={onClose} maxWidthClass="max-w-7xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={detail.status} />
            {differences > 0 ? <Badge status="diferencia" /> : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-stone-500">{detail.location_name} · {detail.area_name ?? "Sin área"} · OC {detail.purchase_folio}</p>
        </div>
        <div className="flex flex-wrap justify-start gap-2 md:justify-end">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          {detail.status === "recibida" ? <Button variant="secondary" disabled={pdfLoading} onClick={generateStorageOrder}>{pdfLoading ? "Generando..." : "Orden almacén PDF"}</Button> : null}
          {!locked ? <Button disabled={saving || status === "pendiente"} onClick={saveReceipt}>{saving ? "Guardando..." : "Guardar recepción"}</Button> : null}
        </div>
      </div>

      <div className="mt-5 grid gap-3 rounded-xl bg-[#FAFAF8] p-4 md:grid-cols-4">
        <KpiMini label="Comprado" value={formatNumber(totalPurchased)} />
        <KpiMini label="Recibido" value={formatNumber(totalReceived)} />
        <KpiMini label="Diferencias" value={differences} />
        <KpiMini label="Completada" value={formatDate(detail.completed_at)} />
      </div>

      <div className="mt-4 grid items-end gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[220px_1fr_auto]">
        <Field label="Estado de recepción">
          <select disabled={locked} value={status} onChange={(event) => setStatus(event.target.value as ReceivingStatus)} className="field-input disabled:opacity-70">
            {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Notas">
          <input disabled={locked} value={notes} onChange={(event) => setNotes(event.target.value)} className="field-input disabled:opacity-70" placeholder="Observaciones generales" />
        </Field>
        {!locked ? <Button variant="secondary" onClick={fillPurchasedQuantities}>Recibir todo</Button> : null}
      </div>

      {detail.status === "en_almacen" ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">La recepción ya está en almacén; el registro queda cerrado.</p>
      ) : null}
      {!canManage ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">Solo Logística, Almacén o Recepción pueden actualizar este registro.</p>
      ) : null}
      {externalChange ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
          <span>Esta recepción cambió en otra sesión. Recarga antes de guardar.</span>
          <Button variant="secondary" onClick={() => void onReload()}>Recargar datos</Button>
        </div>
      ) : null}
      {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-[#EDE8E3] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#EDE8E3]">
              {["Producto", "Destino", "Requisitado", "Comprado", "Recibido", "Diferencia", "Lote", "Caducidad"].map((label) => (
                <th key={label} className="whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const difference = getReceivingDifference(item);
              return (
                <tr key={item.purchase_order_item_id} className="border-b border-[#F5F1EE]">
                  <td className="min-w-[280px] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductThumb product={item} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-stone-950">{item.product}</p>
                        <p className="truncate text-xs font-semibold text-stone-500">{item.presentation ?? "Sin presentación"}</p>
                        {item.delicate_management ? <p className="mt-1 text-xs font-bold text-amber-700">Cuidado especial</p> : null}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">
                    <p className="font-semibold text-stone-800">{item.warehouse_name ?? item.almacen ?? "Sin almacén"}</p>
                    <p className="text-xs text-stone-500">{item.rack_name ?? "Sin rack"}{item.rack_position ? ` · ${item.rack_position}` : ""}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-stone-700">{formatNumber(item.requisition_quantity)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-stone-700">{formatNumber(item.purchased_quantity)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <input disabled={locked} value={item.received_quantity} onChange={(event) => updateItem(item.purchase_order_item_id, { received_quantity: event.target.value })} type="number" min="0" step="0.001" className="field-input h-9 w-28 disabled:opacity-70" />
                  </td>
                  <td className={`whitespace-nowrap px-4 py-3 font-bold ${difference === 0 ? "text-emerald-700" : "text-red-600"}`}>{formatSignedNumber(difference)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <input disabled={locked} value={item.lot_code} onChange={(event) => updateItem(item.purchase_order_item_id, { lot_code: event.target.value })} className="field-input h-9 w-32 disabled:opacity-70" placeholder="Opcional" />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <input disabled={locked} value={item.expires_at} onChange={(event) => updateItem(item.purchase_order_item_id, { expires_at: event.target.value })} type="date" className="field-input h-9 w-36 disabled:opacity-70" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function SimpleOpsView({
  supabase,
  rpc,
  refreshKey,
  selectedLocation,
  locationKeys,
  title,
  subtitle,
  columns,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  rpc: "list_abastecimiento_transfers_v2" | "list_abastecimiento_waste_entries_v2";
  refreshKey: number;
  selectedLocation: string;
  locationKeys: string[];
  title: string;
  subtitle: string;
  columns: string[];
}) {
  const [records, setRecords] = useState<SampleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc(rpc);
    setLoading(false);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setRecords((data as SampleRecord[] | null) ?? []);
  }, [rpc, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadRecords, refreshKey]);

  const visibleRecords = selectedLocation === "Todas"
    ? records
    : records.filter((record) => locationKeys.some((key) => record[key] === selectedLocation));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={title} subtitle={subtitle} />
        <Button variant="secondary" disabled={loading} onClick={() => void loadRecords()}>
          {loading ? "Actualizando..." : "Actualizar"}
        </Button>
      </div>
      {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <Card className="mt-6 p-0">
        <DataTable
          columns={columns.map((column) => [column, humanize(column)])}
          rows={visibleRecords}
          renderCell={(key, row) => {
            const value = row[key];
            if (key === "estado" || key === "tipo") return <Badge status={String(value)} />;
            if (key === "monto" || key === "valor") return formatCurrency(value);
            if (typeof value === "boolean") return value ? "Sí" : "No";
            return String(value ?? "—");
          }}
        />
        {!loading && visibleRecords.length === 0 ? <EmptyState message="Sin registros para esta sucursal" /> : null}
      </Card>
    </div>
  );
}

function ProductionView({
  supabase,
  locations,
  selectedLocation,
  role,
  refreshKey,
  realtimeBatch,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  locations: LocationRow[];
  selectedLocation: string;
  role: UserRole | null;
  refreshKey: number;
  realtimeBatch: RealtimeBatch;
}) {
  const [productionDate, setProductionDate] = useState(formatTodayForFilename());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ProductionStockProduct[]>([]);
  const [bufferItems, setBufferItems] = useState<ProductionBufferItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [productionLots, setProductionLots] = useState<ProductionLotSummary[]>([]);
  const [editingLot, setEditingLot] = useState<ProductionLotDetail | null>(null);
  const [clientRequestId, setClientRequestId] = useState(() => globalThis.crypto.randomUUID());
  const commandIds = useRef(new Map<string, string>());
  const [loading, setLoading] = useState(false);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [deletingLotId, setDeletingLotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedLocationId = selectedLocation === "Todas"
    ? role?.role === "super_admin"
      ? null
      : locations.find((location) => normalize(location.name) === normalize(role?.sucursal ?? ""))?.id ?? null
    : locations.find((location) => location.name === selectedLocation)?.id ?? null;
  const targetLocationId = editingLot?.location_id ?? selectedLocationId;
  const locationLabel = selectedLocation === "Todas" && role?.role !== "super_admin" ? role?.sucursal ?? "Mi sucursal" : selectedLocation;
  const canManageLots = role?.role === "super_admin";
  const canCreateLots = getRealtimeLocationCapabilities(role).includes("production");

  const loadRows = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase.rpc("list_abastecimiento_stock_lots", {
      p_location_id: selectedLocationId,
      p_production_date: productionDate || null,
    });
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      setRows([]);
      return;
    }

    setRows((data as ProductionStockProduct[] | null) ?? []);
  }, [productionDate, selectedLocationId, supabase]);

  const loadLots = useCallback(async () => {
    if (!supabase || !canManageLots) return;
    setLotsLoading(true);
    const { data, error: lotsError } = await supabase.rpc("list_abastecimiento_production_lots_v2", {
      p_date_from: null,
      p_date_to: null,
      p_limit: 50,
      p_location_id: selectedLocationId,
    });
    setLotsLoading(false);

    if (lotsError) {
      setError(lotsError.message);
      setProductionLots([]);
      return;
    }

    setProductionLots((data as ProductionLotSummary[] | null) ?? []);
  }, [canManageLots, selectedLocationId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadRows();
      void loadLots();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadLots, loadRows, refreshKey]);

  const visibleRows = rows.filter((row) => `${row.product} ${row.description ?? ""} ${row.packaging ?? ""} ${row.category ?? ""} ${row.subcategory ?? ""} ${row.location_name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const producedTotal = rows.reduce((sum, row) => sum + Number(row.produced_quantity ?? 0), 0);
  const activeProducts = rows.filter((row) => Number(row.produced_quantity ?? 0) > 0).length;
  const bufferTotal = bufferItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const externalChange = Boolean(editingLot && hasNewerAggregateEvent(
    realtimeBatch,
    ["production"],
    [editingLot.lot_id],
    editingLot.version,
  ));

  function addWildcardProduct() {
    if (!canCreateLots) return;
    const locationId = targetLocationId ?? locations[0]?.id ?? "";
    if (!locationId) {
      setError("Selecciona una sucursal para agregar productos.");
      return;
    }

    const customId = -Math.floor(Date.now() + Math.random() * 1000);
    setError(null);
    setSidebarOpen(true);
    setBufferItems((current) => [
      {
        product: {
          stock_lot_id: null,
          finished_product_id: customId,
          product: "",
          description: "Producto especial fuera de catálogo (sin receta)",
          packaging: "Venta individual",
          category: "Especial",
          subcategory: "Comodín",
          image_url: null,
          price: 0,
          location_id: locationId,
          location_name: locationLabel,
          production_date: productionDate,
          produced_quantity: 0,
          is_custom: true,
        },
        quantity: 1,
        unit: "pieza",
        is_custom: true,
        custom_name: "",
      },
      ...current,
    ]);
  }

  function updateBufferCustomName(finishedProductId: number, customName: string) {
    setBufferItems((current) =>
      current.map((item) =>
        item.product.finished_product_id === finishedProductId
          ? {
              ...item,
              custom_name: customName,
              product: {
                ...item.product,
                product: customName,
              },
            }
          : item
      )
    );
  }

  function addToBuffer(row: ProductionStockProduct) {
    if (!canCreateLots) return;
    const locationId = row.location_id ?? targetLocationId;
    if (!locationId) {
      setError("Selecciona una sucursal para armar el lote del día.");
      return;
    }

    setError(null);
    setSidebarOpen(true);
    setBufferItems((current) => {
      const existing = current.find((item) => item.product.finished_product_id === row.finished_product_id);
      if (existing) {
        return current.map((item) => (item.product.finished_product_id === row.finished_product_id ? { ...item, quantity: item.quantity + 1 } : item));
      }

      return [
        ...current,
        {
          product: { ...row, location_id: locationId, location_name: row.location_name === "Todas" ? locationLabel : row.location_name },
          quantity: 1,
          unit: "pieza",
        },
      ];
    });
  }

  function updateBufferQuantity(finishedProductId: number, quantity: number) {
    if (quantity <= 0) {
      setBufferItems((current) => current.filter((item) => item.product.finished_product_id !== finishedProductId));
      return;
    }

    setBufferItems((current) => current.map((item) => (item.product.finished_product_id === finishedProductId ? { ...item, quantity } : item)));
  }

  function updateBufferUnit(finishedProductId: number, unit: string) {
    setBufferItems((current) =>
      current.map((item) =>
        item.product.finished_product_id === finishedProductId ? { ...item, unit } : item
      )
    );
  }

  function resetBuffer() {
    setBufferItems([]);
    setNotes("");
    setEditingLot(null);
    setClientRequestId(globalThis.crypto.randomUUID());
  }

  async function saveProductionLot() {
    if (!supabase || saving) return;
    if (!canCreateLots) {
      setError("No tienes permiso para registrar producción.");
      return;
    }
    if (externalChange) {
      setError("Este lote cambió en otra sesión. Cancela la edición y vuelve a abrirlo.");
      return;
    }
    if (!targetLocationId) {
      setError("Selecciona una sucursal para guardar el lote.");
      return;
    }

    if (bufferItems.length === 0) {
      setError("Agrega al menos un producto al lote.");
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      p_items: bufferItems.map((item) => ({
        finished_product_id: item.product.finished_product_id,
        product_name: (item.custom_name || item.product.product).trim() || "Producto Especial",
        custom_name: (item.custom_name || item.product.product).trim() || "Producto Especial",
        is_custom: item.is_custom || item.product.finished_product_id <= 0,
        quantity: Number(item.quantity || 0),
        unit: item.unit || "pieza",
      })),
      p_notes: notes.trim(),
    };
    const commandKey = editingLot ? `production:update:${editingLot.lot_id}` : null;
    const { error: saveError } = editingLot
      ? await supabase.rpc("update_abastecimiento_production_lot_v2", {
        ...payload,
        p_lot_id: editingLot.lot_id,
        p_command_id: getCommandId(commandIds.current, commandKey!),
        p_expected_version: editingLot.version,
      })
      : await supabase.rpc("save_abastecimiento_production_lot_v2", {
        ...payload,
        p_location_id: targetLocationId,
        p_production_date: productionDate || null,
        p_command_id: clientRequestId,
      });
    setSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    if (commandKey) commandIds.current.delete(commandKey);
    resetBuffer();
    await Promise.all([loadRows(), loadLots()]);
  }

  async function loadLotForEdit(lotId: string) {
    if (!supabase || detailLoadingId) return;
    setDetailLoadingId(lotId);
    setError(null);
    const { data, error: detailError } = await supabase.rpc("get_abastecimiento_production_lot_v2", {
      p_lot_id: lotId,
    });
    setDetailLoadingId(null);

    if (detailError) {
      setError(detailError.message);
      return;
    }

    const detail = data as ProductionLotDetail;
    setEditingLot(detail);
    setProductionDate(detail.production_date);
    setNotes(detail.notes ?? "");
    setBufferItems(detail.items.map((item) => ({
      product: {
        stock_lot_id: null,
        finished_product_id: item.finished_product_id,
        product: item.product,
        description: item.description,
        packaging: item.packaging,
        category: item.category,
        subcategory: item.subcategory,
        image_url: item.image_url,
        price: item.price,
        location_id: detail.location_id,
        location_name: detail.location_name,
        production_date: detail.production_date,
        produced_quantity: item.quantity,
        is_custom: item.finished_product_id <= 0,
      },
      quantity: Number(item.quantity || 0),
      unit: item.unit || "pieza",
      is_custom: item.finished_product_id <= 0,
      custom_name: item.product,
    })));
    setSidebarOpen(true);
  }

  async function deleteLot(lot: ProductionLotSummary) {
    if (!supabase || deletingLotId) return;
    if (!window.confirm(`Borrar el lote ${lot.folio}? Esta acción ajustará el acumulado de producción.`)) return;
    setDeletingLotId(lot.lot_id);
    setError(null);
    const commandKey = `production:delete:${lot.lot_id}`;
    const { error: deleteError } = await supabase.rpc("delete_abastecimiento_production_lot_v2", {
      p_lot_id: lot.lot_id,
      p_command_id: getCommandId(commandIds.current, commandKey),
      p_expected_version: lot.version,
    });
    setDeletingLotId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    commandIds.current.delete(commandKey);
    if (editingLot?.lot_id === lot.lot_id) resetBuffer();
    await Promise.all([loadRows(), loadLots()]);
  }

  return (
    <div className="pb-24">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader title="Producción de sucursal" subtitle={`Producción diaria · ${locationLabel}`} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canCreateLots}
            onClick={addWildcardProduct}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-black text-amber-950 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>✨ + Producto Comodín / Especial</span>
          </button>
          <Button variant="secondary" disabled={loading} onClick={() => void loadRows()}>{loading ? "Actualizando..." : "Actualizar"}</Button>
          <Button onClick={() => setSidebarOpen(true)}>Lote del día ({bufferItems.length})</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <KpiCard label="Productos visibles" value={rows.length} accent />
        <KpiCard label="Productos producidos" value={activeProducts} />
        <KpiCard label="Cantidad producida" value={formatNumber(producedTotal)} />
        <KpiCard label="En lote actual" value={formatNumber(bufferTotal)} sub={`${bufferItems.length} productos`} />
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[180px_1fr_auto] md:items-end">
        <Field label="Fecha">
          <input value={productionDate} max={formatTodayForFilename()} onChange={(event) => setProductionDate(event.target.value)} type="date" className="field-input" />
        </Field>
        <Field label="Buscar producto">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="field-input" placeholder="Nombre, empaque o categoría..." />
        </Field>
        <div className="mb-4 rounded-lg bg-[#FAFAF8] px-3 py-2 text-center text-xs font-bold text-stone-500">
          {visibleRows.length} de {rows.length}
        </div>
      </div>

      {error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {!canCreateLots ? <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">Solo Producción o administración de sucursal pueden registrar lotes.</p> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleRows.map((row) => (
          <button
            key={`${row.location_id ?? "all"}-${row.finished_product_id}`}
            type="button"
            disabled={!canCreateLots}
            onClick={() => addToBuffer(row)}
            className="group flex min-h-[188px] flex-col overflow-hidden rounded-xl border border-[#EDE8E3] bg-white text-left shadow-[0_1px_4px_rgba(28,25,23,0.04)] transition hover:-translate-y-0.5 hover:border-[#D6C9BF] hover:shadow-[0_12px_28px_rgba(28,25,23,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ProductThumb product={row} size="lg" />
            <div className="flex flex-1 flex-col p-4">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-extrabold text-stone-950">{row.product}</p>
                <p className="mt-1 truncate text-xs font-semibold text-stone-500">{row.packaging ?? "Sin empaque"}</p>
                <p className="mt-1 truncate text-xs font-semibold text-stone-500">{[row.category, row.subcategory].filter(Boolean).join(" · ") || "Producto terminado"}</p>
              </div>
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-stone-400">{row.location_name}</p>
                  <p className="mt-1 text-3xl font-extrabold leading-none text-[#B45309]">{formatNumber(row.produced_quantity)}</p>
                </div>
                <span className="rounded-lg bg-[#1C1917] px-3 py-2 text-sm font-extrabold text-white transition group-hover:bg-[#2D2926]">
                  Agregar
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {loading ? <EmptyState message="Cargando productos..." /> : null}
      {!loading && visibleRows.length === 0 ? <EmptyState message="No hay productos para esta sucursal" /> : null}

      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="fixed bottom-5 right-5 z-30 rounded-full bg-[#1C1917] px-5 py-3 text-sm font-extrabold text-white shadow-[0_16px_40px_rgba(28,25,23,0.25)]"
      >
        Lote ({bufferItems.length})
      </button>

      <div className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-[#EDE8E3] bg-white shadow-[-18px_0_42px_rgba(28,25,23,0.16)] transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-start justify-between gap-3 border-b border-[#EDE8E3] px-5 py-4">
          <div>
            <p className="text-lg font-extrabold text-stone-950">{editingLot ? `Editando ${editingLot.folio}` : "Lote del día"}</p>
            <p className="text-sm font-semibold text-stone-500">{editingLot?.location_name ?? locationLabel} · {formatDate(productionDate)}</p>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} className="text-2xl leading-none text-stone-400 transition hover:text-stone-950">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-[#EDE8E3] bg-[#FAFAF8] p-4">
            <div className="grid grid-cols-3 gap-3">
              <KpiMini label="Productos" value={bufferItems.length} />
              <KpiMini label="Cantidad" value={formatNumber(bufferTotal)} />
              <KpiMini label="Sucursal" value={editingLot?.location_name ?? (targetLocationId ? locationLabel : "Selecciona")} />
            </div>
            <Field label="Notas">
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className="field-input mt-3" placeholder="Notas del lote" />
            </Field>

            <button
              type="button"
              disabled={!canCreateLots}
              onClick={addWildcardProduct}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-amber-400 bg-amber-50/80 px-3 py-2 text-xs font-black text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>✨ + Agregar Producto Comodín (Sin receta)</span>
            </button>
          </div>

          {externalChange ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Este lote cambió en otra sesión. Cancela la edición y vuelve a abrirlo antes de guardar.
            </p>
          ) : null}

          <div className="mt-4 space-y-3">
            {bufferItems.map((item) => {
              const isCustom = item.is_custom || item.product.finished_product_id <= 0;

              if (isCustom) {
                return (
                  <div key={item.product.finished_product_id} className="rounded-xl border border-amber-300 bg-amber-50/40 p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500 text-[10px] font-black text-white">✨</span>
                        <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">
                          Producto Comodín / Especial
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateBufferQuantity(item.product.finished_product_id, 0)}
                        className="text-xl leading-none text-stone-400 transition hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-2">
                      <label className="block text-[10px] font-extrabold uppercase tracking-wider text-stone-600 mb-1">
                        Nombre del Producto:
                      </label>
                      <input
                        type="text"
                        value={item.custom_name ?? item.product.product}
                        onChange={(e) => updateBufferCustomName(item.product.finished_product_id, e.target.value)}
                        placeholder="Ej. Pastel de fresas especial, Baguette rústica..."
                        className="field-input h-9 text-xs font-extrabold bg-white border-amber-300 focus:border-amber-500 text-stone-950"
                        autoFocus={!item.custom_name}
                      />
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateBufferQuantity(item.product.finished_product_id, item.quantity - 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200 bg-white text-lg font-bold transition hover:bg-amber-100"
                        >
                          -
                        </button>
                        <input
                          value={item.quantity}
                          onChange={(event) => updateBufferQuantity(item.product.finished_product_id, Number(event.target.value || 0))}
                          type="number"
                          min="0"
                          step="any"
                          className="field-input h-9 w-20 text-center font-bold bg-white border-amber-200"
                        />
                        <button
                          type="button"
                          onClick={() => updateBufferQuantity(item.product.finished_product_id, item.quantity + 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-200 bg-white text-lg font-bold transition hover:bg-amber-100"
                        >
                          +
                        </button>
                      </div>

                      <select
                        value={item.unit || "pieza"}
                        onChange={(e) => updateBufferUnit(item.product.finished_product_id, e.target.value)}
                        className="field-input h-9 flex-1 text-xs font-bold bg-white border-amber-200"
                      >
                        {LOT_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>

                    <p className="mt-1.5 text-[10px] font-semibold text-stone-400">
                      ℹ️ Sin receta: no descontará materias primas ni insumos.
                    </p>
                  </div>
                );
              }

              return (
                <div key={item.product.finished_product_id} className="rounded-xl border border-[#EDE8E3] bg-white p-3">
                  <div className="flex items-start gap-3">
                    <ProductThumb product={item.product} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-extrabold text-stone-950">{item.product.product}</p>
                      <p className="mt-1 truncate text-xs font-semibold text-stone-500">{item.product.packaging ?? "Sin empaque"}</p>
                    </div>
                    <button type="button" onClick={() => updateBufferQuantity(item.product.finished_product_id, 0)} className="text-xl leading-none text-stone-300 transition hover:text-red-600">×</button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => updateBufferQuantity(item.product.finished_product_id, item.quantity - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#EDE8E3] text-lg font-bold transition hover:bg-stone-50">-</button>
                      <input
                        value={item.quantity}
                        onChange={(event) => updateBufferQuantity(item.product.finished_product_id, Number(event.target.value || 0))}
                        type="number"
                        min="0"
                        step="any"
                        className="field-input h-9 w-20 text-center font-bold"
                      />
                      <button type="button" onClick={() => updateBufferQuantity(item.product.finished_product_id, item.quantity + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#EDE8E3] text-lg font-bold transition hover:bg-stone-50">+</button>
                    </div>
                    <select
                      value={item.unit || "pieza"}
                      onChange={(e) => updateBufferUnit(item.product.finished_product_id, e.target.value)}
                      className="field-input h-9 flex-1 text-xs font-bold bg-white"
                    >
                      {LOT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {bufferItems.length === 0 ? <EmptyState message="Presiona productos para agregarlos al lote" /> : null}

          {canManageLots ? (
            <div className="mt-6">
              <SectionHeader title="Lotes pasados" />
              <div className="space-y-3">
                {productionLots.map((lot) => (
                  <div key={lot.lot_id} className="rounded-xl border border-[#EDE8E3] bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-stone-950">{lot.folio}</p>
                        <p className="text-xs font-semibold text-stone-500">{lot.location_name} · {formatDate(lot.production_date)}</p>
                        <p className="mt-1 text-xs text-stone-500">{formatNumber(lot.total_quantity)} piezas · {lot.items_count} productos</p>
                      </div>
                      <Badge status="completado" />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void loadLotForEdit(lot.lot_id)} className="rounded-lg border border-[#DDD7D1] px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-[#F5F1EE]">
                        {detailLoadingId === lot.lot_id ? "Cargando..." : "Editar"}
                      </button>
                      <button type="button" disabled={deletingLotId === lot.lot_id} onClick={() => void deleteLot(lot)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-60">
                        {deletingLotId === lot.lot_id ? "Borrando..." : "Borrar"}
                      </button>
                    </div>
                  </div>
                ))}
                {lotsLoading ? <EmptyState message="Cargando lotes..." /> : null}
                {!lotsLoading && productionLots.length === 0 ? <EmptyState message="Sin lotes guardados" /> : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-[#EDE8E3] p-4">
          {editingLot ? <button type="button" onClick={resetBuffer} className="mb-2 w-full rounded-lg border border-[#EDE8E3] px-4 py-2 text-sm font-bold text-stone-600">Cancelar edición</button> : null}
          <Button disabled={!canCreateLots || saving || externalChange || bufferItems.length === 0 || !targetLocationId} onClick={() => void saveProductionLot()}>
            {saving ? "Guardando..." : editingLot ? "Guardar cambios" : "Guardar lote"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QualityView({
  supabase,
  locations,
  selectedLocation,
  role,
  refreshKey,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  locations: LocationRow[];
  selectedLocation: string;
  role: UserRole | null;
  refreshKey: number;
}) {
  const [activeTab, setActiveTab] = useState<"verificar" | "historial">("verificar");
  const [verificationDate, setVerificationDate] = useState(formatTodayForFilename());
  const [search, setSearch] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string>("all");
  const [productionLots, setProductionLots] = useState<ProductionLotSummary[]>([]);
  const [items, setItems] = useState<QualityDraftItem[]>([]);
  const [generalNotes, setGeneralNotes] = useState("");
  const [verifications, setVerifications] = useState<QualityVerificationSummary[]>([]);
  const [inspectingVerification, setInspectingVerification] = useState<QualityVerificationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inspectLoadingId, setInspectLoadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [commandId, setCommandId] = useState(() => globalThis.crypto.randomUUID());

  const selectedLocationId = selectedLocation === "Todas"
    ? role?.role === "super_admin"
      ? null
      : locations.find((location) => normalize(location.name) === normalize(role?.sucursal ?? ""))?.id ?? null
    : locations.find((location) => location.name === selectedLocation)?.id ?? null;

  const targetLocationId = useMemo(() => {
    if (selectedLocationId) return selectedLocationId;
    if (selectedLotId !== "all") {
      const lot = productionLots.find((l) => l.lot_id === selectedLotId);
      if (lot?.location_id) return lot.location_id;
    }
    const uniqueLocs = Array.from(new Set(productionLots.map((l) => l.location_id).filter(Boolean)));
    if (uniqueLocs.length === 1) return uniqueLocs[0];
    return locations.find((l) => l.name === "Teran")?.id ?? locations[0]?.id ?? null;
  }, [selectedLocationId, selectedLotId, productionLots, locations]);

  const locationLabel = selectedLocation === "Todas" && role?.role !== "super_admin" ? role?.sucursal ?? "Mi sucursal" : selectedLocation;

  const loadProductionLots = useCallback(async () => {
    if (!supabase) return;
    setLotsLoading(true);
    const { data, error: lotsErr } = await supabase.rpc("list_abastecimiento_production_lots", {
      p_location_id: selectedLocationId,
      p_date_from: verificationDate || null,
      p_date_to: verificationDate || null,
      p_limit: 50,
    });
    setLotsLoading(false);
    if (!lotsErr && data) {
      setProductionLots((data as ProductionLotSummary[] | null) ?? []);
    } else {
      setProductionLots([]);
    }
  }, [selectedLocationId, supabase, verificationDate]);

  const loadProductionToVerify = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    const { data, error: pendingErr } = await supabase.rpc("list_abastecimiento_pending_quality_items", {
      p_location_id: selectedLocationId,
      p_date: verificationDate || null,
      p_lot_id: selectedLotId !== "all" ? selectedLotId : null,
    });
    setLoading(false);

    if (pendingErr) {
      setError(pendingErr.message);
      setItems([]);
      return;
    }

    type QualityPendingProduct = {
      lot_item_id: string | null;
      finished_product_id: number;
      product_name: string;
      description: string | null;
      packaging: string | null;
      category: string | null;
      subcategory: string | null;
      image_url: string | null;
      declared_quantity: number;
      point_of_sale_quantity: number;
      unit: string;
    };

    const rawList = (data as QualityPendingProduct[] | null) ?? [];
    const initialItems: QualityDraftItem[] = rawList.map((it) => ({
      finished_product_id: it.finished_product_id,
      product_name: it.product_name,
      description: it.description,
      packaging: it.packaging,
      category: it.category,
      subcategory: it.subcategory,
      image_url: it.image_url,
      declared_quantity: Number(it.declared_quantity || 0),
      point_of_sale_quantity: Number(it.point_of_sale_quantity || 0),
      unit: it.unit || "pieza",
      storage_location: QUALITY_STORAGE_LOCATIONS[0],
      storage_notes: "",
      lot_item_id: it.lot_item_id,
    }));
    setItems(initialItems);
  }, [selectedLocationId, selectedLotId, supabase, verificationDate]);

  const loadVerifications = useCallback(async () => {
    if (!supabase) return;
    setHistoryLoading(true);
    const { data, error: histErr } = await supabase.rpc("list_abastecimiento_quality_verifications", {
      p_location_id: selectedLocationId,
      p_date_from: null,
      p_date_to: null,
      p_limit: 50,
    });
    setHistoryLoading(false);
    if (histErr) {
      setError(histErr.message);
      setVerifications([]);
      return;
    }
    setVerifications((data as QualityVerificationSummary[] | null) ?? []);
  }, [selectedLocationId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadProductionLots();
      void loadProductionToVerify();
      void loadVerifications();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadProductionLots, loadProductionToVerify, loadVerifications, refreshKey]);

  const updateItemPdvQty = (finishedProductId: number, value: number) => {
    const safeQty = Math.max(0, isNaN(value) ? 0 : value);
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId
          ? { ...it, point_of_sale_quantity: safeQty }
          : it
      )
    );
  };

  const updateItemUnit = (finishedProductId: number, unit: string) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId
          ? { ...it, unit }
          : it
      )
    );
  };

  const updateItemStorageLocation = (finishedProductId: number, location: string) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId
          ? { ...it, storage_location: location }
          : it
      )
    );
  };

  const updateItemStorageNotes = (finishedProductId: number, notesText: string) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId
          ? { ...it, storage_notes: notesText }
          : it
      )
    );
  };

  const saveVerification = async () => {
    if (!supabase || saving) return;
    if (!targetLocationId) {
      setError("Selecciona una sucursal para guardar la verificación de calidad.");
      return;
    }
    if (items.length === 0) {
      setError("No hay productos pendientes por verificar.");
      return;
    }

    const itemsMissingNotes = items.filter(
      (it) => it.point_of_sale_quantity < it.declared_quantity && !it.storage_notes.trim()
    );
    if (itemsMissingNotes.length > 0) {
      setError(
        `Por favor escribe la observación de dónde queda almacenado el resto de: ${itemsMissingNotes
          .map((i) => i.product_name)
          .join(", ")}.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    const payload = {
      p_location_id: targetLocationId,
      p_verification_date: verificationDate || null,
      p_lot_id: selectedLotId !== "all" ? selectedLotId : null,
      p_notes: generalNotes.trim() || null,
      p_items: items.map((it) => ({
        finished_product_id: it.finished_product_id,
        product_name: it.product_name,
        declared_quantity: it.declared_quantity,
        point_of_sale_quantity: it.point_of_sale_quantity,
        unit: it.unit || "pieza",
        storage_location: it.point_of_sale_quantity !== it.declared_quantity ? it.storage_location : null,
        storage_notes: it.point_of_sale_quantity !== it.declared_quantity ? it.storage_notes.trim() : null,
        lot_item_id: it.lot_item_id,
      })),
      p_command_id: commandId,
    };

    const { data, error: saveErr } = await supabase.rpc(
      "save_abastecimiento_quality_verification_v2",
      payload
    );
    setSaving(false);

    if (saveErr) {
      setError(saveErr.message);
      return;
    }

    const res = data as { folio?: string; has_discrepancies?: boolean };
    setSuccessMessage(
      `✓ Registro de Calidad ${res?.folio ?? ""} guardado con éxito ${
        res?.has_discrepancies ? "con registro de resguardo/almacén" : "(100% en punto de venta)"
      }.`
    );
    setGeneralNotes("");
    setCommandId(globalThis.crypto.randomUUID());
    await Promise.all([loadVerifications(), loadProductionLots(), loadProductionToVerify()]);
  };

  const inspectVerification = async (verificationId: string) => {
    if (!supabase || inspectLoadingId) return;
    setInspectLoadingId(verificationId);
    setError(null);
    const { data, error: inspErr } = await supabase.rpc("get_abastecimiento_quality_verification", {
      p_verification_id: verificationId,
    });
    setInspectLoadingId(null);
    if (inspErr) {
      setError(inspErr.message);
      return;
    }
    setInspectingVerification(data as QualityVerificationDetail);
  };

  const totalDeclared = items.reduce((sum, it) => sum + Number(it.declared_quantity || 0), 0);
  const totalPdv = items.reduce((sum, it) => sum + Number(it.point_of_sale_quantity || 0), 0);
  const totalStored = items.reduce(
    (sum, it) => sum + Math.max(0, Number(it.declared_quantity || 0) - Number(it.point_of_sale_quantity || 0)),
    0
  );
  const discrepancyCount = items.filter((it) => it.point_of_sale_quantity !== it.declared_quantity).length;
  const matchPercentage = totalDeclared > 0 ? Math.min(100, Math.round((totalPdv / totalDeclared) * 100)) : 100;

  const visibleItems = items.filter((it) =>
    `${it.product_name} ${it.description ?? ""} ${it.packaging ?? ""} ${it.category ?? ""} ${it.subcategory ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader
          title="Control de Calidad y Punto de Venta"
          subtitle={`Verificación de producto real en PDV vs producción declarada · ${locationLabel}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={activeTab}
            onChange={(val) => {
              setActiveTab(val as "verificar" | "historial");
              setError(null);
            }}
            options={[
              ["verificar", "Verificación PDV"],
              ["historial", `Historial (${verifications.length})`],
            ]}
          />
          <Button
            variant="secondary"
            disabled={loading || historyLoading}
            onClick={() => {
              void loadProductionLots();
              void loadProductionToVerify();
              void loadVerifications();
            }}
          >
            {loading || historyLoading ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Coincidencia en PDV"
          value={`${matchPercentage}%`}
          sub={`${formatNumber(totalPdv)} de ${formatNumber(totalDeclared)} unidades`}
          accent={matchPercentage === 100 && totalDeclared > 0}
          alert={matchPercentage < 100 && totalDeclared > 0}
        />
        <KpiCard
          label="Producción Pendiente"
          value={formatNumber(totalDeclared)}
          sub={`${items.length} productos por verificar`}
        />
        <KpiCard
          label="Llegó a Punto de Venta"
          value={formatNumber(totalPdv)}
          sub="Disponible en mostrador/PDV"
        />
        <KpiCard
          label="En Reserva / Almacén"
          value={formatNumber(totalStored)}
          sub={`${discrepancyCount} productos con diferencia`}
          alert={totalStored > 0}
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {successMessage ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm">
          <span>{successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-600 hover:text-emerald-950 font-bold">✕</button>
        </div>
      ) : null}

      {activeTab === "verificar" ? (
        <>
          {/* Controls Bar */}
          <div className="mt-5 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[180px_1fr_1fr] md:items-end">
            <Field label="Fecha de Producción">
              <input
                value={verificationDate}
                onChange={(event) => setVerificationDate(event.target.value)}
                type="date"
                className="field-input"
              />
            </Field>

            <Field label="Lote / Origen">
              <select
                value={selectedLotId}
                onChange={(event) => setSelectedLotId(event.target.value)}
                className="field-input"
              >
                <option value="all">📦 Toda la producción pendiente del día</option>
                {productionLots.map((lot) => (
                  <option key={lot.lot_id} value={lot.lot_id}>
                    {lot.folio} · {lot.location_name} ({lot.items_count} productos - {formatNumber(lot.total_quantity)}) {lot.is_verified ? "· ✓ Ya verificado" : "· ⏳ Pendiente"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Buscar Producto">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="field-input"
                placeholder="Nombre, categoría, empaque..."
              />
            </Field>
          </div>

          {/* Products Verification Grid */}
          {loading ? (
            <div className="mt-6">
              <EmptyState message="Cargando productos de producción para verificación..." />
            </div>
          ) : items.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#DDD7D1] bg-[#FAFAF8] p-10 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <Icon path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </div>
              <h3 className="text-base font-extrabold text-stone-900">✓ Sin productos pendientes por verificar</h3>
              <p className="mx-auto mt-1 max-w-md text-xs font-medium text-stone-500">
                Todos los productos elaborados para {locationLabel} en la fecha {verificationDate} ya han sido verificados y registrados en Punto de Venta.
                Puedes consultar las recepciones guardadas en la pestaña de{" "}
                <button
                  type="button"
                  onClick={() => setActiveTab("historial")}
                  className="font-bold text-[#B45309] underline hover:text-[#92400E]"
                >
                  Historial ({verifications.length})
                </button>.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {visibleItems.map((item) => {
                const diff = item.declared_quantity - item.point_of_sale_quantity;
                const isMatched = diff === 0;
                const isShortage = diff > 0;
                const unitLabel = item.unit || "pieza";

                return (
                  <div
                    key={item.finished_product_id}
                    className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition ${
                      !isMatched
                        ? "border-amber-300 ring-2 ring-amber-400/20 bg-[#FFFDF9]"
                        : "border-[#EDE8E3] hover:border-[#D6C9BF] hover:shadow-md"
                    }`}
                  >
                    {/* Header: Fixed square thumbnail + product info + declared qty */}
                    <div className="flex items-start gap-4">
                      {item.image_url ? (
                        <div
                          aria-label={`Imagen de ${item.product_name}`}
                          role="img"
                          className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-xl border border-[#EDE8E3] bg-[#F5F1EE] bg-cover bg-center shadow-inner"
                          style={{ backgroundImage: `url(${item.image_url})` }}
                        />
                      ) : (
                        <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-xl border border-[#EDE8E3] bg-[#F5F1EE] text-sm font-black text-[#B45309]">
                          {getInitials(item.product_name)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="text-base font-extrabold text-stone-950 leading-snug">
                              {item.product_name}
                            </h4>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center rounded-md bg-[#F5F1EE] px-2 py-0.5 text-xs font-semibold text-stone-600">
                                {[item.category, item.subcategory].filter(Boolean).join(" · ") || "Producto terminado"}
                              </span>
                              {item.packaging ? (
                                <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                                  {item.packaging}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="shrink-0 self-start">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-extrabold text-white shadow-sm">
                              <span>Declarado:</span>
                              <span className="text-amber-400 font-black">{formatNumber(item.declared_quantity)}</span>
                              <span className="text-stone-300 font-medium">{unitLabel}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Verification Row */}
                    <div className="mt-4 rounded-xl bg-[#FAFAF8] p-3.5 border border-[#EDE8E3]/80">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <span className="block text-[10px] font-extrabold uppercase tracking-wider text-stone-500 mb-1">
                            Llegó a Punto de Venta (PDV)
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateItemPdvQty(item.finished_product_id, item.point_of_sale_quantity - 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#DDD7D1] bg-white text-base font-black text-stone-700 shadow-sm transition hover:bg-stone-100 active:scale-95"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={item.point_of_sale_quantity}
                                onChange={(e) => updateItemPdvQty(item.finished_product_id, Number(e.target.value))}
                                className="h-9 w-20 rounded-lg border border-[#DDD7D1] bg-white text-center text-base font-black text-stone-950 shadow-inner focus:border-[#B45309] focus:outline-none focus:ring-2 focus:ring-[#B45309]/20"
                              />
                              <button
                                type="button"
                                onClick={() => updateItemPdvQty(item.finished_product_id, item.point_of_sale_quantity + 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#DDD7D1] bg-white text-base font-black text-stone-700 shadow-sm transition hover:bg-stone-100 active:scale-95"
                              >
                                +
                              </button>
                            </div>
                            <select
                              value={item.unit || "pieza"}
                              onChange={(e) => updateItemUnit(item.finished_product_id, e.target.value)}
                              className="h-9 rounded-lg border border-[#DDD7D1] bg-white px-2.5 text-xs font-black text-stone-700 shadow-sm focus:border-[#B45309] focus:outline-none"
                            >
                              {LOT_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                            <span className="text-xs font-bold text-stone-500 whitespace-nowrap">
                              de {formatNumber(item.declared_quantity)} {unitLabel}
                            </span>
                          </div>
                        </div>

                        <div className="sm:text-right">
                          <span className="block text-[10px] font-extrabold uppercase tracking-wider text-stone-500 mb-1">
                            Estado de Recepción
                          </span>
                          <div>
                            {isMatched ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800 whitespace-nowrap">
                                ✓ Coincide al 100%
                              </span>
                            ) : isShortage ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900 whitespace-nowrap">
                                ⚠ Faltan {formatNumber(diff)} {unitLabel} en PDV
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-100 px-3 py-1 text-xs font-extrabold text-sky-900 whitespace-nowrap">
                                ℹ Excedente (+{formatNumber(Math.abs(diff))} {unitLabel})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Discrepancy & Storage Location Capture */}
                    {!isMatched ? (
                      <div className="mt-3.5 rounded-xl border border-amber-300 bg-amber-50/80 p-4 shadow-sm">
                        <div className="mb-2.5 flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[11px] font-black text-white">
                            !
                          </span>
                          <p className="text-xs font-black text-amber-950 uppercase tracking-wide">
                            {isShortage
                              ? `¿Dónde queda almacenado el restante (${formatNumber(diff)} ${unitLabel})?`
                              : `Observación del excedente (+${formatNumber(Math.abs(diff))} ${unitLabel})`}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-end">
                          <div>
                            <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-amber-900">
                              Ubicación de Resguardo
                            </label>
                            <select
                              value={item.storage_location}
                              onChange={(e) => updateItemStorageLocation(item.finished_product_id, e.target.value)}
                              className="field-input h-10 text-xs font-bold bg-white border-amber-300 text-stone-900"
                            >
                              {QUALITY_STORAGE_LOCATIONS.map((loc) => (
                                <option key={loc} value={loc}>
                                  {loc}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-amber-900">
                              Observación / Motivo de Almacenamiento <span className="text-red-600 font-bold">*</span>
                            </label>
                            <input
                              type="text"
                              value={item.storage_notes}
                              onChange={(e) => updateItemStorageNotes(item.finished_product_id, e.target.value)}
                              placeholder={`Ej. Quedan ${formatNumber(diff)} ${unitLabel} en cámara fría por espacio en mostrador...`}
                              className={`field-input h-10 text-xs bg-white ${
                                isShortage && !item.storage_notes.trim()
                                  ? "border-red-300 ring-2 ring-red-400/20 focus:border-red-500"
                                  : "border-amber-300 focus:border-amber-500"
                              }`}
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Save Bar */}
          {items.length > 0 ? (
            <div className="mt-8 rounded-2xl border border-[#EDE8E3] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.05em] text-stone-500">
                    Observaciones Generales de la Verificación (Opcional)
                  </label>
                  <input
                    value={generalNotes}
                    onChange={(e) => setGeneralNotes(e.target.value)}
                    placeholder="Turno matutino, estado general del producto, comentarios adicionales..."
                    className="field-input h-10 text-sm"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-xl bg-[#F5F1EE] px-4 py-2 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Resumen</p>
                    <p className="text-sm font-extrabold text-stone-950">
                      PDV: <span className="text-[#B45309]">{formatNumber(totalPdv)}</span> / Decl: {formatNumber(totalDeclared)}
                      {totalStored > 0 ? ` · Reserva: ${formatNumber(totalStored)}` : ""}
                    </p>
                  </div>

                  <Button
                    disabled={saving || items.length === 0 || !targetLocationId}
                    onClick={() => void saveVerification()}
                  >
                    {saving ? "Guardando..." : "Guardar Verificación de Calidad"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        /* Historial Tab */
        <div className="mt-5 rounded-2xl border border-[#EDE8E3] bg-white p-5 shadow-sm">
          <SectionHeader
            title="Historial de Auditorías y Verificaciones de Calidad"
            actionLabel="Actualizar"
            onAction={() => void loadVerifications()}
          />

          {historyLoading ? (
            <EmptyState message="Cargando historial de verificaciones..." />
          ) : verifications.length === 0 ? (
            <EmptyState message="No hay verificaciones de calidad registradas para esta sucursal." />
          ) : (
            <DataTable
              columns={[
                ["folio", "Folio"],
                ["fecha", "Fecha"],
                ["sucursal", "Sucursal"],
                ["origen", "Lote Origen"],
                ["declarado", "Declarado"],
                ["pdv", "En PDV"],
                ["almacen", "Almacenado"],
                ["estado", "Estado"],
                ["verificador", "Verificado por"],
                ["acciones", "Acción"],
              ]}
              rows={verifications}
              renderCell={(key, row) => {
                const v = row as QualityVerificationSummary;
                if (key === "folio") return <span className="font-extrabold text-stone-950">{v.folio}</span>;
                if (key === "fecha") return <span className="text-xs font-semibold">{formatDate(v.verification_date)}</span>;
                if (key === "sucursal") return <span className="text-xs font-bold text-[#B45309]">{v.location_name}</span>;
                if (key === "origen") return <span className="text-xs text-stone-600">{v.lot_folio ?? "Producción del día"}</span>;
                if (key === "declarado") return <span className="font-bold">{formatNumber(v.total_declared)}</span>;
                if (key === "pdv") return <span className="font-bold text-emerald-700">{formatNumber(v.total_point_of_sale)}</span>;
                if (key === "almacen") return <span className={`font-bold ${Number(v.total_stored_elsewhere) > 0 ? "text-amber-700" : "text-stone-400"}`}>{formatNumber(v.total_stored_elsewhere)}</span>;
                if (key === "estado") return <Badge status={v.has_discrepancies ? "con_diferencia" : "coincide"} />;
                if (key === "verificador") return <span className="text-xs text-stone-500">{v.verified_by_name}</span>;
                if (key === "acciones") {
                  return (
                    <button
                      type="button"
                      onClick={() => void inspectVerification(v.verification_id)}
                      disabled={inspectLoadingId === v.verification_id}
                      className="rounded-lg border border-[#DDD7D1] bg-[#F5F1EE] px-3 py-1 text-xs font-bold text-stone-700 transition hover:bg-[#EDE8E3]"
                    >
                      {inspectLoadingId === v.verification_id ? "Cargando..." : "Ver Detalle"}
                    </button>
                  );
                }
                return null;
              }}
            />
          )}
        </div>
      )}

      {/* Inspect Detail Modal */}
      {inspectingVerification ? (
        <Modal
          title={`Detalle de Calidad: ${inspectingVerification.folio}`}
          onClose={() => setInspectingVerification(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl bg-[#FAFAF8] p-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Sucursal</p>
                <p className="text-sm font-extrabold text-stone-900">{inspectingVerification.location_name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Fecha de Verificación</p>
                <p className="text-sm font-extrabold text-stone-900">{formatDate(inspectingVerification.verification_date)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Verificado Por</p>
                <p className="text-sm font-extrabold text-stone-900">{inspectingVerification.verified_by_name}</p>
              </div>
            </div>

            {inspectingVerification.general_notes ? (
              <div className="rounded-xl border border-stone-200 bg-white p-3.5 text-xs text-stone-700">
                <span className="font-bold text-stone-900">Observación General: </span>
                {inspectingVerification.general_notes}
              </div>
            ) : null}

            <div className="divide-y divide-[#EDE8E3] rounded-xl border border-[#EDE8E3] bg-white">
              {inspectingVerification.items.map((it) => {
                const diff = Number(it.declared_quantity) - Number(it.point_of_sale_quantity);
                const isMatched = diff === 0;
                const unitLabel = it.unit || "pieza";

                return (
                  <div key={it.finished_product_id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <ProductThumb product={{ product: it.product_name, image_url: it.image_url }} size="sm" />
                        <div>
                          <p className="text-sm font-extrabold text-stone-950">{it.product_name}</p>
                          <p className="text-xs text-stone-500">
                            {[it.category, it.subcategory].filter(Boolean).join(" · ")}
                            {it.packaging ? ` · ${it.packaging}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <Badge status={isMatched ? "coincide" : "con_diferencia"} />
                        <p className="mt-1 text-xs font-bold text-stone-700">
                          PDV: <span className="text-emerald-700">{formatNumber(it.point_of_sale_quantity)} {unitLabel}</span> / Decl: {formatNumber(it.declared_quantity)} {unitLabel}
                        </p>
                      </div>
                    </div>

                    {!isMatched ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                        <div className="flex items-center gap-1 font-bold text-amber-900">
                          <span>📦 Ubicación de Almacenamiento:</span>
                          <span className="rounded bg-amber-200/80 px-1.5 py-0.5 text-amber-950">{it.storage_location ?? "No especificada"}</span>
                          <span className="text-amber-700">({formatNumber(diff)} {unitLabel} resguardadas)</span>
                        </div>
                        {it.storage_notes ? (
                          <p className="mt-1 text-stone-700">
                            <span className="font-semibold">Nota:</span> {it.storage_notes}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setInspectingVerification(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function MermaPvView({
  supabase,
  locations,
  selectedLocation,
  role,
  refreshKey,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  locations: LocationRow[];
  selectedLocation: string;
  role: UserRole | null;
  refreshKey: number;
}) {
  const [activeTab, setActiveTab] = useState<"declarar" | "historial">("declarar");
  const [mermaDate, setMermaDate] = useState(formatTodayForFilename());
  const [search, setSearch] = useState("");
  const [qualityVerifications, setQualityVerifications] = useState<QualityVerificationSummary[]>([]);
  const [items, setItems] = useState<MermaPvDraftItem[]>([]);
  const [generalNotes, setGeneralNotes] = useState("");
  const [mermaRecords, setMermaRecords] = useState<MermaPvSummary[]>([]);
  const [inspectingRecord, setInspectingRecord] = useState<MermaPvDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifsLoading, setVerifsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inspectLoadingId, setInspectLoadingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [commandId, setCommandId] = useState(() => globalThis.crypto.randomUUID());

  const selectedLocationId = selectedLocation === "Todas"
    ? role?.role === "super_admin"
      ? null
      : locations.find((location) => normalize(location.name) === normalize(role?.sucursal ?? ""))?.id ?? null
    : locations.find((location) => location.name === selectedLocation)?.id ?? null;

  const targetLocationId = useMemo(() => {
    if (selectedLocationId) return selectedLocationId;
    const uniqueLocs = Array.from(new Set(qualityVerifications.map((v) => v.location_id).filter(Boolean)));
    if (uniqueLocs.length === 1) return uniqueLocs[0];
    return locations.find((l) => l.name === "Teran")?.id ?? locations[0]?.id ?? null;
  }, [selectedLocationId, qualityVerifications, locations]);

  const locationLabel = selectedLocation === "Todas" && role?.role !== "super_admin" ? role?.sucursal ?? "Mi sucursal" : selectedLocation;

  const loadQualityVerifications = useCallback(async () => {
    if (!supabase) return;
    setVerifsLoading(true);
    const { data, error: verifsErr } = await supabase.rpc("list_abastecimiento_quality_verifications", {
      p_location_id: selectedLocationId,
      p_date_from: mermaDate || null,
      p_date_to: mermaDate || null,
      p_limit: 50,
    });
    setVerifsLoading(false);
    if (!verifsErr && data) {
      setQualityVerifications((data as QualityVerificationSummary[] | null) ?? []);
    } else {
      setQualityVerifications([]);
    }
  }, [selectedLocationId, supabase, mermaDate]);

  const loadProductsToMerma = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);

    const { data, error: prodErr } = await supabase.rpc("list_abastecimiento_quality_products_for_merma", {
      p_location_id: selectedLocationId,
      p_date: mermaDate || null,
      p_verification_id: null,
    });
    setLoading(false);

    if (prodErr) {
      setError(prodErr.message);
      setItems([]);
      return;
    }

    type QualityMermaProduct = {
      quality_item_id: string | null;
      verification_id: string | null;
      verification_folio: string | null;
      finished_product_id: number;
      product_name: string;
      description: string | null;
      packaging: string | null;
      category: string | null;
      subcategory: string | null;
      image_url: string | null;
      unit_price?: number;
      pdv_received_quantity: number;
      unit: string;
    };

    const rawList = (data as QualityMermaProduct[] | null) ?? [];
    const draftItems: MermaPvDraftItem[] = rawList.map((p) => ({
      quality_item_id: p.quality_item_id,
      verification_id: p.verification_id,
      verification_folio: p.verification_folio,
      finished_product_id: p.finished_product_id,
      product_name: p.product_name,
      description: p.description,
      packaging: p.packaging,
      category: p.category,
      subcategory: p.subcategory,
      image_url: p.image_url,
      unit_price: Number(p.unit_price || 0),
      pdv_received_quantity: Number(p.pdv_received_quantity || 0),
      merma_quantity: 0,
      unit: p.unit || "pieza",
      destination: "desecho",
      recovery_action: RECOVERY_ACTIONS[0],
      reason: MERMA_PV_REASONS[0],
      notes: "",
    }));
    setItems(draftItems);
  }, [selectedLocationId, supabase, mermaDate]);

  const loadMermaRecords = useCallback(async () => {
    if (!supabase) return;
    setHistoryLoading(true);
    const { data, error: histErr } = await supabase.rpc("list_abastecimiento_merma_pv_records", {
      p_location_id: selectedLocationId,
      p_date_from: null,
      p_date_to: null,
      p_limit: 50,
    });
    setHistoryLoading(false);
    if (histErr) {
      setError(histErr.message);
      setMermaRecords([]);
      return;
    }
    setMermaRecords((data as MermaPvSummary[] | null) ?? []);
  }, [selectedLocationId, supabase]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadQualityVerifications();
      void loadProductsToMerma();
      void loadMermaRecords();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadQualityVerifications, loadProductsToMerma, loadMermaRecords, refreshKey]);

  const updateItemMermaQty = (finishedProductId: number, value: number) => {
    setItems((current) =>
      current.map((it) => {
        if (it.finished_product_id !== finishedProductId) return it;
        const maxQty = it.pdv_received_quantity;
        const safeQty = Math.max(0, Math.min(maxQty, isNaN(value) ? 0 : value));
        return { ...it, merma_quantity: safeQty };
      })
    );
  };

  const updateItemDestination = (finishedProductId: number, destination: MermaPvDestination) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId ? { ...it, destination } : it
      )
    );
  };

  const updateItemRecoveryAction = (finishedProductId: number, recovery_action: string) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId ? { ...it, recovery_action } : it
      )
    );
  };

  const updateItemReason = (finishedProductId: number, reason: string) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId ? { ...it, reason } : it
      )
    );
  };

  const updateItemNotes = (finishedProductId: number, notesText: string) => {
    setItems((current) =>
      current.map((it) =>
        it.finished_product_id === finishedProductId ? { ...it, notes: notesText } : it
      )
    );
  };

  const setAllZeroMerma = () => {
    setItems((current) =>
      current.map((it) => ({
        ...it,
        merma_quantity: 0,
        notes: "",
      }))
    );
    setSuccessMessage("Se registró 0 merma: 100% vendido en todos los productos.");
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  };

  const setAllTotalMerma = () => {
    setItems((current) =>
      current.map((it) => ({
        ...it,
        merma_quantity: it.pdv_received_quantity,
      }))
    );
  };

  const saveMermaRecord = async () => {
    if (!supabase || saving) return;
    if (!targetLocationId) {
      setError("Selecciona una sucursal para guardar el registro de merma PV.");
      return;
    }
    if (items.length === 0) {
      setError("No hay productos verificados por Calidad en Punto de Venta para declarar merma.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    const payload = {
      p_location_id: targetLocationId,
      p_merma_date: mermaDate || null,
      p_verification_id: null,
      p_notes: generalNotes.trim() || null,
      p_items: items.map((it) => ({
        finished_product_id: it.finished_product_id,
        product_name: it.product_name,
        unit_price: it.unit_price || 0,
        pdv_received_quantity: it.pdv_received_quantity,
        merma_quantity: it.merma_quantity,
        unit: it.unit || "pieza",
        destination: it.destination || "desecho",
        recovery_action: it.destination === "recuperacion" ? it.recovery_action || RECOVERY_ACTIONS[0] : null,
        reason: it.reason || MERMA_PV_REASONS[0],
        notes: it.notes.trim() || null,
        quality_item_id: it.quality_item_id,
      })),
      p_command_id: commandId,
    };

    const { data, error: saveErr } = await supabase.rpc(
      "save_abastecimiento_merma_pv_v2",
      payload
    );
    setSaving(false);

    if (saveErr) {
      setError(saveErr.message);
      return;
    }

    const res = data as {
      folio?: string;
      total_merma?: number;
      total_desecho?: number;
      total_recuperacion?: number;
      total_desecho_value?: number;
      total_recuperacion_value?: number;
      merma_percentage?: number;
    };
    setSuccessMessage(
      `✓ Registro de Merma PV ${res?.folio ?? ""} guardado con éxito (${formatNumber(
        res?.total_merma ?? 0
      )} unidades mermadas · 🗑️ ${formatNumber(res?.total_desecho ?? 0)} en Desecho [${formatCurrency(
        res?.total_desecho_value ?? 0
      )}] / ♻️ ${formatNumber(res?.total_recuperacion ?? 0)} en Recuperación [${formatCurrency(
        res?.total_recuperacion_value ?? 0
      )}]).`
    );
    setGeneralNotes("");
    setCommandId(globalThis.crypto.randomUUID());
    await Promise.all([loadMermaRecords(), loadProductsToMerma(), loadQualityVerifications()]);
  };

  const inspectRecord = async (mermaRecordId: string) => {
    if (!supabase || inspectLoadingId) return;
    setInspectLoadingId(mermaRecordId);
    setError(null);
    const { data, error: inspErr } = await supabase.rpc("get_abastecimiento_merma_pv_record", {
      p_merma_record_id: mermaRecordId,
    });
    setInspectLoadingId(null);
    if (inspErr) {
      setError(inspErr.message);
      return;
    }
    setInspectingRecord(data as MermaPvDetail);
  };

  const totalReceived = items.reduce((sum, it) => sum + Number(it.pdv_received_quantity || 0), 0);
  const totalMerma = items.reduce((sum, it) => sum + Number(it.merma_quantity || 0), 0);
  const totalSold = Math.max(0, totalReceived - totalMerma);
  const totalDesecho = items.reduce(
    (sum, it) => (it.destination === "desecho" ? sum + Number(it.merma_quantity || 0) : sum),
    0
  );
  const totalRecuperacion = items.reduce(
    (sum, it) => (it.destination === "recuperacion" ? sum + Number(it.merma_quantity || 0) : sum),
    0
  );
  const totalDesechoValue = items.reduce(
    (sum, it) => (it.destination === "desecho" ? sum + (Number(it.merma_quantity || 0) * Number(it.unit_price || 0)) : sum),
    0
  );
  const totalRecuperacionValue = items.reduce(
    (sum, it) => (it.destination === "recuperacion" ? sum + (Number(it.merma_quantity || 0) * Number(it.unit_price || 0)) : sum),
    0
  );
  const mermaPercentage = totalReceived > 0 ? Math.round((totalMerma / totalReceived) * 100) : 0;
  const soldPercentage = totalReceived > 0 ? Math.round((totalSold / totalReceived) * 100) : 100;
  const itemsWithMermaCount = items.filter((it) => it.merma_quantity > 0).length;

  // Historical aggregated metrics
  const histTotalMerma = mermaRecords.reduce((sum, r) => sum + Number(r.total_merma || 0), 0);
  const histTotalDesecho = mermaRecords.reduce((sum, r) => sum + Number(r.total_desecho || 0), 0);
  const histTotalRecuperacion = mermaRecords.reduce((sum, r) => sum + Number(r.total_recuperacion || 0), 0);
  const histTotalDesechoValue = mermaRecords.reduce((sum, r) => sum + Number(r.total_desecho_value || 0), 0);
  const histTotalRecuperacionValue = mermaRecords.reduce((sum, r) => sum + Number(r.total_recuperacion_value || 0), 0);
  const histRecoveryRate = histTotalMerma > 0 ? Math.round((histTotalRecuperacion / histTotalMerma) * 100) : 0;

  const visibleItems = items.filter((it) =>
    `${it.product_name} ${it.description ?? ""} ${it.packaging ?? ""} ${it.category ?? ""} ${it.subcategory ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <PageHeader
          title="Control de Merma en Punto de Venta (PV)"
          subtitle={`Declaración de producto no vendido a partir de recepción de calidad · ${locationLabel}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={activeTab}
            onChange={(val) => {
              setActiveTab(val as "declarar" | "historial");
              setError(null);
            }}
            options={[
              ["declarar", "Declaración de Merma"],
              ["historial", `Historial (${mermaRecords.length})`],
            ]}
          />
          <Button
            variant="secondary"
            disabled={loading || historyLoading}
            onClick={() => {
              void loadQualityVerifications();
              void loadProductsToMerma();
              void loadMermaRecords();
            }}
          >
            {loading || historyLoading ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="% Merma en PDV"
          value={`${mermaPercentage}%`}
          sub={`${formatNumber(totalMerma)} de ${formatNumber(totalReceived)} unidades`}
          accent={mermaPercentage === 0 && totalReceived > 0}
          alert={mermaPercentage > 15}
        />
        <KpiCard
          label="Vendido / Consumido"
          value={formatNumber(totalSold)}
          sub={`${soldPercentage}% del producto colocado`}
          accent={totalSold > 0}
        />
        <KpiCard
          label="🗑️ A Desecho (Basura)"
          value={formatNumber(totalDesecho)}
          sub={`Pérdida: ${formatCurrency(totalDesechoValue)}`}
          alert={totalDesecho > 0}
        />
        <KpiCard
          label="♻️ A Recuperación"
          value={formatNumber(totalRecuperacion)}
          sub={`Valor: ${formatCurrency(totalRecuperacionValue)}`}
          accent={totalRecuperacion > 0}
        />
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {successMessage ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm">
          <span>{successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage(null)} className="text-emerald-600 hover:text-emerald-950 font-bold">✕</button>
        </div>
      ) : null}

      {activeTab === "declarar" ? (
        <>
          {/* Controls Bar */}
          <div className="mt-5 grid gap-3 rounded-xl border border-[#EDE8E3] bg-white p-4 md:grid-cols-[180px_1fr_1fr_auto] md:items-end">
            <Field label="Fecha de Verificación">
              <input
                value={mermaDate}
                onChange={(event) => setMermaDate(event.target.value)}
                type="date"
                className="field-input"
              />
            </Field>

            <Field label="Origen de Calidad">
              <select value="all" disabled className="field-input disabled:opacity-80">
                <option value="all">🛡️ Toda la recepción verificada en PDV del día</option>
              </select>
            </Field>

            <Field label="Buscar Producto">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="field-input"
                placeholder="Nombre, categoría, empaque..."
              />
            </Field>

            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={setAllZeroMerma}
                disabled={items.length === 0}
                className="h-10 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                ✓ 0 Merma (Vendido 100%)
              </button>
              <button
                type="button"
                onClick={setAllTotalMerma}
                disabled={items.length === 0}
                className="h-10 rounded-lg border border-stone-300 bg-stone-50 px-3 text-xs font-bold text-stone-700 transition hover:bg-stone-100 disabled:opacity-50"
              >
                Merma Total
              </button>
            </div>
          </div>

          {/* Products Merma Grid */}
          {loading ? (
            <div className="mt-6">
              <EmptyState message="Cargando productos verificados en Punto de Venta..." />
            </div>
          ) : items.length === 0 ? (
            qualityVerifications.length > 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-emerald-200 bg-[#F6FBF8] p-10 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
                  <Icon path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </div>
                <h3 className="text-base font-extrabold text-emerald-950">✓ Toda la merma en PDV ha sido declarada</h3>
                <p className="mx-auto mt-1 max-w-md text-xs font-medium text-emerald-800/80">
                  Todos los productos recibidos en Punto de Venta para {locationLabel} en la fecha {mermaDate} ya cuentan con su declaración de merma o venta registrada.
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab("historial")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3.5 py-1.5 text-xs font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50"
                  >
                    Ver Historial de Declaraciones ({mermaRecords.length})
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-[#DDD7D1] bg-[#FAFAF8] p-10 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Icon path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </div>
                <h3 className="text-base font-extrabold text-stone-900">Sin recepción en PDV para esta fecha</h3>
                <p className="mx-auto mt-1 max-w-md text-xs font-medium text-stone-500">
                  No se encontraron recepciones de producto en Punto de Venta verificadas por Calidad para {locationLabel} en la fecha {mermaDate}.
                  Verifica primero la recepción en la pestaña de Calidad para poder declarar su merma o venta.
                </p>
              </div>
            )
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {visibleItems.map((item) => {
                const soldQty = Math.max(0, item.pdv_received_quantity - item.merma_quantity);
                const hasMerma = item.merma_quantity > 0;
                const isTotalMerma = item.merma_quantity === item.pdv_received_quantity;
                const unitLabel = item.unit || "pieza";
                const isRecuperacion = item.destination === "recuperacion";

                return (
                  <div
                    key={item.finished_product_id}
                    className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition ${
                      hasMerma
                        ? isRecuperacion
                          ? "border-emerald-300 ring-2 ring-emerald-500/20 bg-[#FBFCFB]"
                          : "border-red-300 ring-2 ring-red-400/20 bg-[#FFFDFD]"
                        : "border-[#EDE8E3] hover:border-[#D6C9BF] hover:shadow-md"
                    }`}
                  >
                    {/* Header: Fixed thumbnail + product name + received in PDV badge */}
                    <div className="flex items-start gap-4">
                      {item.image_url ? (
                        <div
                          aria-label={`Imagen de ${item.product_name}`}
                          role="img"
                          className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-xl border border-[#EDE8E3] bg-[#F5F1EE] bg-cover bg-center shadow-inner"
                          style={{ backgroundImage: `url(${item.image_url})` }}
                        />
                      ) : (
                        <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-xl border border-[#EDE8E3] bg-[#F5F1EE] text-sm font-black text-[#B45309]">
                          {getInitials(item.product_name)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="text-base font-extrabold text-stone-950 leading-snug">
                              {item.product_name}
                            </h4>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center rounded-md bg-[#F5F1EE] px-2 py-0.5 text-xs font-semibold text-stone-600">
                                {[item.category, item.subcategory].filter(Boolean).join(" · ") || "Producto terminado"}
                              </span>
                              {item.packaging ? (
                                <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                                  {item.packaging}
                                </span>
                              ) : null}
                              {item.unit_price > 0 ? (
                                <span className="inline-flex items-center rounded-md bg-amber-50 border border-amber-200/80 px-2 py-0.5 text-xs font-bold text-amber-900">
                                  {formatCurrency(item.unit_price)} / {unitLabel}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="shrink-0 self-start">
                            <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-extrabold text-white shadow-sm">
                              <span>Entró a PDV:</span>
                              <span className="text-amber-400 font-black">{formatNumber(item.pdv_received_quantity)}</span>
                              <span className="text-stone-300 font-medium">{unitLabel}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Merma Stepper & Sold Pill */}
                    <div className="mt-4 rounded-xl bg-[#FAFAF8] p-3.5 border border-[#EDE8E3]/80">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <span className="block text-[10px] font-extrabold uppercase tracking-wider text-stone-500 mb-1">
                            Cantidad de Merma (No vendido)
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateItemMermaQty(item.finished_product_id, item.merma_quantity - 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#DDD7D1] bg-white text-base font-black text-stone-700 shadow-sm transition hover:bg-stone-100 active:scale-95"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={item.pdv_received_quantity}
                                step="any"
                                value={item.merma_quantity}
                                onChange={(e) => updateItemMermaQty(item.finished_product_id, Number(e.target.value))}
                                className="h-9 w-20 rounded-lg border border-[#DDD7D1] bg-white text-center text-base font-black text-stone-950 shadow-inner focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                              />
                              <button
                                type="button"
                                onClick={() => updateItemMermaQty(item.finished_product_id, item.merma_quantity + 1)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#DDD7D1] bg-white text-base font-black text-stone-700 shadow-sm transition hover:bg-stone-100 active:scale-95"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs font-bold text-stone-600">
                              {unitLabel}
                            </span>

                            <div className="flex gap-1 ml-1">
                              <button
                                type="button"
                                onClick={() => updateItemMermaQty(item.finished_product_id, 0)}
                                className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-bold text-stone-600 hover:bg-stone-100"
                              >
                                0
                              </button>
                              <button
                                type="button"
                                onClick={() => updateItemMermaQty(item.finished_product_id, item.pdv_received_quantity)}
                                className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-bold text-stone-600 hover:bg-stone-100"
                              >
                                Todo
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="sm:text-right">
                          <span className="block text-[10px] font-extrabold uppercase tracking-wider text-stone-500 mb-1">
                            Resultado en PDV
                          </span>
                          <div className="flex flex-wrap items-center sm:justify-end gap-2">
                            <span className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">
                              Vendido: {formatNumber(soldQty)} {unitLabel}
                            </span>
                            {!hasMerma ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-extrabold text-emerald-800 whitespace-nowrap">
                                ✓ 100% Vendido
                              </span>
                            ) : isTotalMerma ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-3 py-1 text-xs font-extrabold text-red-900 whitespace-nowrap">
                                ⛔ 100% Merma
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900 whitespace-nowrap">
                                ⚠ Merma ({formatNumber(item.merma_quantity)} {unitLabel})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Destination (Desecho / Recuperación), Reason & Notes */}
                    {hasMerma ? (
                      <div
                        className={`mt-3.5 rounded-xl border p-4 shadow-sm transition ${
                          isRecuperacion
                            ? "border-emerald-300 bg-emerald-50/70"
                            : "border-red-300 bg-red-50/80"
                        }`}
                      >
                        {/* Destination selector pills */}
                        <div className="mb-3">
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-stone-800">
                              ¿A dónde se va la merma? ({formatNumber(item.merma_quantity)} {unitLabel})
                            </label>
                            {item.unit_price > 0 ? (
                              <span className="text-xs font-black text-stone-900">
                                Valor: {formatCurrency(item.merma_quantity * item.unit_price)}
                              </span>
                            ) : null}
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => updateItemDestination(item.finished_product_id, "desecho")}
                              className={`flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition ${
                                !isRecuperacion
                                  ? "border-red-600 bg-red-600 text-white font-black shadow-sm"
                                  : "border-stone-300 bg-white text-stone-700 font-bold hover:bg-stone-50"
                              }`}
                            >
                              <span className="text-sm">🗑️ Desecho / Basura</span>
                              <span className={`text-[10px] ${!isRecuperacion ? "text-red-100 font-medium" : "text-stone-400 font-normal"}`}>
                                Pérdida total no reutilizable
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => updateItemDestination(item.finished_product_id, "recuperacion")}
                              className={`flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition ${
                                isRecuperacion
                                  ? "border-emerald-700 bg-emerald-700 text-white font-black shadow-sm"
                                  : "border-stone-300 bg-white text-stone-700 font-bold hover:bg-stone-50"
                              }`}
                            >
                              <span className="text-sm">♻️ Recuperación</span>
                              <span className={`text-[10px] ${isRecuperacion ? "text-emerald-100 font-medium" : "text-stone-400 font-normal"}`}>
                                Reproceso, pan molido, donación
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Reason, Recovery Action & Observation Inputs */}
                        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                          {isRecuperacion ? (
                            <div>
                              <label className="mb-1 block text-[10px] font-extrabold uppercase tracking-wider text-emerald-900">
                                Acción de Recuperación
                              </label>
                              <select
                                value={item.recovery_action}
                                onChange={(e) => updateItemRecoveryAction(item.finished_product_id, e.target.value)}
                                className="field-input h-10 text-xs font-bold bg-white border-emerald-300 text-stone-900"
                              >
                                {RECOVERY_ACTIONS.map((act) => (
                                  <option key={act} value={act}>
                                    {act}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}

                          <div className={!isRecuperacion ? "sm:col-span-1" : ""}>
                            <label
                              className={`mb-1 block text-[10px] font-extrabold uppercase tracking-wider ${
                                isRecuperacion ? "text-emerald-900" : "text-red-900"
                              }`}
                            >
                              Motivo / Razón
                            </label>
                            <select
                              value={item.reason}
                              onChange={(e) => updateItemReason(item.finished_product_id, e.target.value)}
                              className={`field-input h-10 text-xs font-bold bg-white text-stone-900 ${
                                isRecuperacion ? "border-emerald-300" : "border-red-300"
                              }`}
                            >
                              {MERMA_PV_REASONS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className={isRecuperacion ? "sm:col-span-2" : "sm:col-span-1"}>
                            <label
                              className={`mb-1 block text-[10px] font-extrabold uppercase tracking-wider ${
                                isRecuperacion ? "text-emerald-900" : "text-red-900"
                              }`}
                            >
                              Observaciones Adicionales
                            </label>
                            <input
                              type="text"
                              value={item.notes}
                              onChange={(e) => updateItemNotes(item.finished_product_id, e.target.value)}
                              placeholder={`Ej. Sobrantes al cierre de turno, empaque deteriorado...`}
                              className={`field-input h-10 text-xs bg-white ${
                                isRecuperacion ? "border-emerald-300 focus:border-emerald-500" : "border-red-300 focus:border-red-500"
                              }`}
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Save Bar */}
          {items.length > 0 ? (
            <div className="mt-8 rounded-2xl border border-[#EDE8E3] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.05em] text-stone-500">
                    Observaciones Generales de la Merma PV (Opcional)
                  </label>
                  <input
                    value={generalNotes}
                    onChange={(e) => setGeneralNotes(e.target.value)}
                    placeholder="Turno vespertino/cierre, condiciones climatológicas, afluencia..."
                    className="field-input h-10 text-sm"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-xl bg-[#F5F1EE] px-4 py-2 text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Resumen</p>
                    <p className="text-sm font-extrabold text-stone-950">
                      PDV: <span className="text-[#B45309]">{formatNumber(totalReceived)}</span> · Vendido: <span className="text-emerald-700">{formatNumber(totalSold)}</span> · 🗑️ Desecho: <span className="text-red-700">{formatNumber(totalDesecho)} ({formatCurrency(totalDesechoValue)})</span> · ♻️ Recup: <span className="text-emerald-700">{formatNumber(totalRecuperacion)} ({formatCurrency(totalRecuperacionValue)})</span>
                    </p>
                  </div>

                  <Button
                    disabled={saving || items.length === 0 || !targetLocationId}
                    onClick={() => void saveMermaRecord()}
                  >
                    {saving ? "Guardando..." : "Guardar Merma PV"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        /* Historial Tab */
        <div className="mt-5 space-y-5">
          {/* Historical Summary Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[#EDE8E3] bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Total Merma Histórica</p>
              <p className="mt-1 text-2xl font-black text-stone-950">{formatNumber(histTotalMerma)}</p>
              <p className="mt-0.5 text-xs text-stone-500">{mermaRecords.length} registros auditados</p>
            </div>

            <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-red-800">🗑️ Total a Desecho</p>
              <p className="mt-1 text-2xl font-black text-red-900">{formatNumber(histTotalDesecho)}</p>
              <p className="mt-0.5 text-xs text-red-700 font-extrabold">{formatCurrency(histTotalDesechoValue)} en pérdida</p>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">♻️ Total en Recuperación</p>
              <p className="mt-1 text-2xl font-black text-emerald-900">{formatNumber(histTotalRecuperacion)}</p>
              <p className="mt-0.5 text-xs text-emerald-700 font-extrabold">{formatCurrency(histTotalRecuperacionValue)} recuperable</p>
            </div>

            <div className="rounded-2xl border border-[#EDE8E3] bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Tasa de Recuperación</p>
              <p className="mt-1 text-2xl font-black text-[#B45309]">{histRecoveryRate}%</p>
              <p className="mt-0.5 text-xs text-stone-500">Del total mermado histórico</p>
            </div>
          </div>

          <div className="rounded-2xl border border-[#EDE8E3] bg-white p-5 shadow-sm">
            <SectionHeader
              title="Historial de Declaraciones de Merma en Punto de Venta"
              actionLabel="Actualizar"
              onAction={() => void loadMermaRecords()}
            />

            {historyLoading ? (
              <EmptyState message="Cargando historial de merma PV..." />
            ) : mermaRecords.length === 0 ? (
              <EmptyState message="No hay declaraciones de merma PV registradas para esta sucursal." />
            ) : (
              <DataTable
                columns={[
                  ["folio", "Folio"],
                  ["fecha", "Fecha"],
                  ["sucursal", "Sucursal"],
                  ["origen", "Verif. Calidad"],
                  ["recibido", "Entró a PDV"],
                  ["vendido", "Vendido"],
                  ["desecho", "🗑️ Desecho"],
                  ["recuperacion", "♻️ Recuperación"],
                  ["merma", "Total Merma"],
                  ["porcentaje", "% Merma"],
                  ["registrador", "Registrado por"],
                  ["acciones", "Acción"],
                ]}
                rows={mermaRecords}
                renderCell={(key, row) => {
                  const r = row as MermaPvSummary;
                  const pct = Number(r.merma_percentage || 0);
                  if (key === "folio") return <span className="font-extrabold text-stone-950">{r.folio}</span>;
                  if (key === "fecha") return <span className="text-xs font-semibold">{formatDate(r.merma_date)}</span>;
                  if (key === "sucursal") return <span className="text-xs font-bold text-[#B45309]">{r.location_name}</span>;
                  if (key === "origen") return <span className="text-xs text-stone-600">{r.verification_folio ?? "Recepción del día"}</span>;
                  if (key === "recibido") return <span className="font-bold">{formatNumber(r.total_received_pdv)}</span>;
                  if (key === "vendido") return <span className="font-bold text-emerald-700">{formatNumber(r.total_sold)}</span>;
                  if (key === "desecho") {
                    const qty = Number(r.total_desecho || 0);
                    const val = Number(r.total_desecho_value || 0);
                    return (
                      <div>
                        <span className={`font-bold ${qty > 0 ? "text-red-700" : "text-stone-400"}`}>{formatNumber(qty)}</span>
                        {qty > 0 ? <p className="text-[10px] font-extrabold text-red-600">{formatCurrency(val)}</p> : null}
                      </div>
                    );
                  }
                  if (key === "recuperacion") {
                    const qty = Number(r.total_recuperacion || 0);
                    const val = Number(r.total_recuperacion_value || 0);
                    return (
                      <div>
                        <span className={`font-bold ${qty > 0 ? "text-emerald-700 font-extrabold" : "text-stone-400"}`}>{formatNumber(qty)}</span>
                        {qty > 0 ? <p className="text-[10px] font-extrabold text-emerald-600">{formatCurrency(val)}</p> : null}
                      </div>
                    );
                  }
                  if (key === "merma") return <span className={`font-bold ${Number(r.total_merma) > 0 ? "text-red-700" : "text-stone-400"}`}>{formatNumber(r.total_merma)}</span>;
                  if (key === "porcentaje") {
                    const statusKey = pct === 0 ? "sin_merma" : pct < 20 ? "merma_parcial" : "merma_alta";
                    return <Badge status={statusKey} />;
                  }
                  if (key === "registrador") return <span className="text-xs text-stone-500">{r.registered_by_name}</span>;
                  if (key === "acciones") {
                    return (
                      <button
                        type="button"
                        onClick={() => void inspectRecord(r.merma_record_id)}
                        disabled={inspectLoadingId === r.merma_record_id}
                        className="rounded-lg border border-[#DDD7D1] bg-[#F5F1EE] px-3 py-1 text-xs font-bold text-stone-700 transition hover:bg-[#EDE8E3]"
                      >
                        {inspectLoadingId === r.merma_record_id ? "Cargando..." : "Ver Detalle"}
                      </button>
                    );
                  }
                  return null;
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Inspect Detail Modal */}
      {inspectingRecord ? (
        <Modal
          title={`Detalle de Merma PV: ${inspectingRecord.folio}`}
          onClose={() => setInspectingRecord(null)}
          maxWidthClass="max-w-3xl"
        >
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl bg-[#FAFAF8] p-4 sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Sucursal</p>
                <p className="text-sm font-extrabold text-stone-900">{inspectingRecord.location_name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Fecha</p>
                <p className="text-sm font-extrabold text-stone-900">{formatDate(inspectingRecord.merma_date)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Registrado Por</p>
                <p className="text-sm font-extrabold text-stone-900">{inspectingRecord.registered_by_name}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">% Merma Global</p>
                <p className={`text-sm font-extrabold ${Number(inspectingRecord.merma_percentage) > 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {inspectingRecord.merma_percentage}%
                </p>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl border border-stone-200 bg-white p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-stone-400">Entró a PDV</p>
                <p className="text-lg font-black text-stone-900">{formatNumber(inspectingRecord.total_received_pdv)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-800">Vendido</p>
                <p className="text-lg font-black text-emerald-900">{formatNumber(inspectingRecord.total_sold)}</p>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-red-800">🗑️ Desecho</p>
                <p className="text-lg font-black text-red-900">{formatNumber(inspectingRecord.total_desecho ?? 0)}</p>
                <p className="text-[11px] font-extrabold text-red-700">{formatCurrency(inspectingRecord.total_desecho_value ?? 0)}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-800">♻️ Recuperación</p>
                <p className="text-lg font-black text-emerald-900">{formatNumber(inspectingRecord.total_recuperacion ?? 0)}</p>
                <p className="text-[11px] font-extrabold text-emerald-700">{formatCurrency(inspectingRecord.total_recuperacion_value ?? 0)}</p>
              </div>
            </div>

            {inspectingRecord.general_notes ? (
              <div className="rounded-xl border border-stone-200 bg-white p-3.5 text-xs text-stone-700">
                <span className="font-bold text-stone-900">Observación General: </span>
                {inspectingRecord.general_notes}
              </div>
            ) : null}

            <div className="divide-y divide-[#EDE8E3] rounded-xl border border-[#EDE8E3] bg-white">
              {inspectingRecord.items.map((it) => {
                const hasMerma = Number(it.merma_quantity) > 0;
                const unitLabel = it.unit || "pieza";
                const isRecup = it.destination === "recuperacion";

                return (
                  <div key={it.finished_product_id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <ProductThumb product={{ product: it.product_name, image_url: it.image_url }} size="sm" />
                        <div>
                          <p className="text-sm font-extrabold text-stone-950">{it.product_name}</p>
                          <p className="text-xs text-stone-500">
                            {[it.category, it.subcategory].filter(Boolean).join(" · ")}
                            {it.packaging ? ` · ${it.packaging}` : ""}
                            {Number(it.unit_price || 0) > 0 ? ` · ${formatCurrency(it.unit_price!)}/${unitLabel}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-xs font-bold text-stone-700">
                          PDV: {formatNumber(it.pdv_received_quantity)} {unitLabel} · Vendido: <span className="text-emerald-700 font-extrabold">{formatNumber(it.sold_quantity)}</span>
                        </p>
                        <p className={`mt-0.5 text-xs font-bold ${hasMerma ? "text-red-700" : "text-stone-400"}`}>
                          Merma: {formatNumber(it.merma_quantity)} {unitLabel}
                          {hasMerma && Number(it.total_price || 0) > 0 ? ` (${formatCurrency(it.total_price!)})` : ""}
                        </p>
                      </div>
                    </div>

                    {hasMerma ? (
                      <div
                        className={`mt-3 rounded-lg border p-3 text-xs ${
                          isRecup ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 font-bold">
                          <span className={isRecup ? "text-emerald-900" : "text-red-900"}>📦 Destino:</span>
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-extrabold ${
                              isRecup ? "bg-emerald-200 text-emerald-950" : "bg-red-200 text-red-950"
                            }`}
                          >
                            {isRecup ? "♻️ Recuperación / Reproceso" : "🗑️ Desecho / Basura"}
                          </span>
                          {isRecup && it.recovery_action ? (
                            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900 font-bold">
                              {it.recovery_action}
                            </span>
                          ) : null}
                          <span className="text-stone-500 font-normal">· Motivo: {it.reason}</span>
                          {Number(it.total_price || 0) > 0 ? (
                            <span className="ml-auto font-black text-stone-900">
                              Importe: {formatCurrency(it.total_price!)}
                            </span>
                          ) : null}
                        </div>
                        {it.notes ? (
                          <p className="mt-1 text-stone-700">
                            <span className="font-semibold">Nota:</span> {it.notes}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setInspectingRecord(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
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
  role,
}: {
  view: ViewId;
  locations: LocationRow[];
  selectedLocation: string;
  setSelectedLocation: (value: string) => void;
  setView: (value: ViewId) => void;
  pendingCount: number;
  role: UserRole | null;
}) {
  const isSuperAdmin = role?.role === "super_admin";
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#EDE8E3] bg-white px-4 md:px-6">
      <select value={view} onChange={(event) => setView(event.target.value as ViewId)} className="field-input h-9 max-w-[170px] lg:hidden">
        {NAV_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>

      {isSuperAdmin ? (
        <>
          <div className="hidden gap-1 rounded-lg bg-[#F5F1EE] p-1 md:flex">
            {["Todas", ...locations.map((location) => location.name)].map((location) => (
              <button key={location} type="button" onClick={() => setSelectedLocation(location)} className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${selectedLocation === location ? "bg-white text-stone-950 shadow-sm" : "text-stone-500 hover:text-stone-950"}`}>{location}</button>
            ))}
          </div>
          <select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)} className="field-input h-9 max-w-[180px] md:hidden">
            {["Todas", ...locations.map((location) => location.name)].map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-[#F5F1EE] px-3 py-1.5 text-xs font-bold text-stone-700">
          <span>Sucursal:</span>
          <span className="text-[#B45309]">{selectedLocation}</span>
        </div>
      )}

      <div className="flex-1" />
      <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#EDE8E3] bg-white text-stone-600">
        <Icon path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        {pendingCount > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-white bg-red-600" /> : null}
      </div>
    </header>
  );
}

type WpStatus = {
  status: string;
  qr: string | null;
  phone: string | null;
  command: string | null;
  last_connected_at: string | null;
  updated_at: string | null;
};
type WpEmployee = { id: string; nombre: string | null; apellidos: string | null; telefono: string | null; has_phone: boolean };
type WpRecipient = { employee_id: string; display_name: string | null; phone: string };
type WpRecipientsConfig = { enabled: boolean; template?: string | null; recipients: WpRecipient[] };
type WpMessage = { id: string; to_phone: string; body: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null };

const WP_MSG_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendiente", className: "bg-amber-100 text-amber-700" },
  sending: { label: "Enviando", className: "bg-blue-100 text-blue-700" },
  sent: { label: "Enviado", className: "bg-emerald-100 text-emerald-700" },
  failed: { label: "Fallido", className: "bg-red-100 text-red-700" },
};

function formatWpDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SettingsView({
  supabase,
  refreshKey,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  refreshKey: number;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ajustes" subtitle="Configuración del sistema · solo super administradores" />
      <MinimaxInventorySettingsPanel supabase={supabase} refreshKey={refreshKey} />
      <WhatsAppSettingsPanel supabase={supabase} refreshKey={refreshKey} />
    </div>
  );
}

function MinimaxInventorySettingsPanel({
  supabase,
  refreshKey,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  refreshKey: number;
}) {
  const [status, setStatus] = useState<MinimaxInventoryStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!supabase) return;
    const { data, error: statusError } = await supabase.rpc("get_abastecimiento_minimax_settings_status");
    if (statusError) {
      setError(statusError.message);
      return;
    }
    const value = Array.isArray(data) ? data[0] : data;
    setStatus(value as MinimaxInventoryStatus);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      await loadStatus();
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [loadStatus, refreshKey]);

  async function configure() {
    if (!supabase || saving || apiKey.trim().length < 12) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: invokeError } = await supabase.functions.invoke("normalize-production-inventory", {
      body: { action: "configure", apiKey: apiKey.trim() },
    });
    setSaving(false);
    if (invokeError) {
      setError(invokeError.message);
      return;
    }
    setApiKey("");
    setMessage("Clave validada y guardada de forma segura.");
    await loadStatus();
  }

  async function normalizePending() {
    if (!supabase || normalizing) return;
    setNormalizing(true);
    setError(null);
    setMessage(null);
    const { data, error: invokeError } = await supabase.functions.invoke("normalize-production-inventory", {
      body: { action: "normalize", limit: 50 },
    });
    setNormalizing(false);
    if (invokeError) {
      setError(invokeError.message);
      return;
    }
    const result = data as { applied?: number; unresolved?: number } | null;
    setMessage(`Se normalizaron ${result?.applied ?? 0} insumos${result?.unresolved ? `; ${result.unresolved} requieren revisión` : ""}.`);
    await loadStatus();
  }

  return (
    <div className="rounded-2xl border border-[#E5DED7] bg-white p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-lg font-extrabold text-stone-950">Normalización de inventario</p>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">
            Convierte presentaciones comerciales a gramos, mililitros o piezas antes de consumir recetas.
          </p>
        </div>
        <span className="w-fit rounded-full bg-stone-950 px-3 py-1 text-xs font-black text-white">MiniMax-M3</span>
      </div>

      {error ? <div className="mt-4"><AlertRow tone="red" message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{message}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <Field label={status?.configured ? "Reemplazar API key" : "API key de MiniMax"}>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="field-input"
            placeholder={status?.configured ? "La clave actual permanece oculta" : "Ingresa tu API key"}
          />
        </Field>
        <Button disabled={saving || apiKey.trim().length < 12} onClick={() => void configure()}>
          {saving ? "Validando..." : status?.configured ? "Reemplazar clave" : "Configurar clave"}
        </Button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <KpiMini label="Conexión" value={loading ? "Consultando..." : status?.configured ? "Configurada" : "Sin configurar"} />
        <KpiMini label="Insumos normalizados" value={`${status?.normalized_count ?? 0} / ${status?.total_count ?? 0}`} />
        <KpiMini label="Rendimientos listos" value={`${status?.recipe_output_normalized_count ?? 0} / ${status?.recipe_output_total_count ?? 0}`} />
        <KpiMini label="Insumos pendientes" value={status?.pending_count ?? 0} />
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t border-[#EDE8E3] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold text-stone-500">La clave se guarda en Vault y nunca se vuelve a mostrar en el navegador.</p>
        <Button
          variant="secondary"
          disabled={!status?.configured || normalizing || status.pending_count === 0}
          onClick={() => void normalizePending()}
        >
          {normalizing ? "Normalizando..." : "Normalizar siguientes 50"}
        </Button>
      </div>
    </div>
  );
}

function WhatsAppSettingsPanel({
  supabase,
  refreshKey,
}: {
  supabase: ReturnType<typeof createBrowserSupabaseClient>;
  refreshKey: number;
}) {
  const [status, setStatus] = useState<WpStatus | null>(null);
  const [employees, setEmployees] = useState<WpEmployee[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(false);
  const [template, setTemplate] = useState("");
  const [selectedTrigger, setSelectedTrigger] = useState("requisition_created");
  const [messages, setMessages] = useState<WpMessage[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!supabase) return;
    const { data, error: statusError } = await supabase.rpc("wp_get_status");
    if (statusError) {
      setError(statusError.message);
      return;
    }
    const row = Array.isArray(data) ? (data[0] as WpStatus | undefined) : (data as WpStatus | null);
    setStatus(row ?? null);
  }, [supabase]);

  const loadConfig = useCallback(async () => {
    if (!supabase) return;
    const [empRes, recRes, msgRes] = await Promise.all([
      supabase.rpc("wp_list_employees"),
      supabase.rpc("wp_get_notification_rule", { p_event_type: selectedTrigger }),
      supabase.rpc("wp_get_recent_messages", { p_limit: 15 }),
    ]);
    if (empRes.error) setError(empRes.error.message);
    else setEmployees((empRes.data as WpEmployee[] | null) ?? []);

    if (!recRes.error && recRes.data) {
      const config = recRes.data as WpRecipientsConfig;
      setEnabled(Boolean(config.enabled));
      setTemplate(config.template ?? "");
      setSelectedIds(new Set((config.recipients ?? []).map((r) => r.employee_id)));
    }
    if (!msgRes.error) setMessages((msgRes.data as WpMessage[] | null) ?? []);
  }, [supabase, selectedTrigger]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await Promise.all([loadStatus(), loadConfig()]);
      if (active) setLoading(false);
    })();
    const timer = setInterval(() => {
      loadStatus();
    }, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loadStatus, loadConfig, refreshKey]);

  function toggleEmployee(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSavedAt(null);
  }

  async function save() {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc("wp_save_notification_rule", {
      p_event_type: selectedTrigger,
      p_enabled: enabled,
      p_template: template.trim(),
      p_employee_ids: Array.from(selectedIds),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setSavedAt(Date.now());
    await loadConfig();
  }

  async function requestLogout() {
    if (!supabase) return;
    await supabase.rpc("wp_request_logout");
    setStatus((prev) => (prev ? { ...prev, status: "connecting", qr: null, phone: null } : prev));
    setTimeout(() => loadStatus(), 2500);
  }

  const filteredEmployees = useMemo(() => {
    const term = normalize(search.trim());
    const withName = employees.map((e) => ({
      ...e,
      label: `${e.nombre ?? ""} ${e.apellidos ?? ""}`.trim() || "(sin nombre)",
    }));
    if (!term) return withName;
    return withName.filter((e) => normalize(e.label).includes(term) || (e.telefono ?? "").includes(search.trim()));
  }, [employees, search]);

  const statusValue = status?.status ?? "disconnected";

  return (
    <div className="flex flex-col gap-5">
      {error ? <AlertRow tone="red" message={error} /> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Conexión */}
        <div className="rounded-2xl border border-[#E5DED7] bg-white p-6">
          <SectionHeader title="Conexión de WhatsApp" actionLabel="Actualizar" onAction={loadStatus} />
          <div className="mt-4 flex flex-col items-center text-center">
            {loading ? (
              <p className="py-10 text-sm text-stone-500">Cargando…</p>
            ) : statusValue === "connected" ? (
              <>
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Conectado
                </span>
                <p className="mt-3 text-lg font-extrabold text-stone-950">+{status?.phone}</p>
                <p className="mt-1 text-xs text-stone-500">Vinculado desde {formatWpDateTime(status?.last_connected_at ?? null)}</p>
                <div className="mt-5">
                  <Button variant="secondary" onClick={requestLogout}>Desvincular</Button>
                </div>
              </>
            ) : statusValue === "qr" && status?.qr ? (
              <>
                <img src={status.qr} alt="Código QR de WhatsApp" className="h-56 w-56 rounded-lg border border-[#E5DED7]" />
                <p className="mt-4 text-sm font-semibold text-stone-700">Escanea para vincular</p>
                <p className="mt-1 max-w-xs text-xs text-stone-500">WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo. El código se renueva solo.</p>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-700">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> {statusValue === "connecting" ? "Conectando…" : "Sin conexión"}
                </span>
                <p className="mt-4 max-w-xs text-xs text-stone-500">
                  Esperando al gateway de WhatsApp. Cuando esté corriendo en el servidor aparecerá aquí un código QR para vincular. Verifica que el servicio esté activo (PM2) si no aparece en unos segundos.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Últimos envíos */}
        <div className="rounded-2xl border border-[#E5DED7] bg-white p-6">
          <SectionHeader title="Últimos envíos" />
          <div className="mt-4 flex flex-col gap-2">
            {messages.length === 0 ? (
              <EmptyState message="Aún no hay notificaciones enviadas" />
            ) : (
              messages.map((msg) => {
                const chip = WP_MSG_STATUS[msg.status] ?? { label: msg.status, className: "bg-stone-100 text-stone-600" };
                return (
                  <div key={msg.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#EDE8E3] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-stone-800">+{msg.to_phone}</p>
                      <p className="text-xs text-stone-500">{formatWpDateTime(msg.created_at)}{msg.last_error ? ` · ${msg.last_error}` : ""}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.className}`}>{chip.label}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Configuración de Notificaciones de Requisición */}
      <div className="rounded-2xl border border-[#E5DED7] bg-white p-6">
        <div className="flex flex-col gap-4 border-b border-[#EDE8E3] pb-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-extrabold text-stone-950">Configuración de Notificaciones de WhatsApp</h3>
            <p className="text-sm text-stone-500">Personaliza los mensajes de WhatsApp y destinatarios según cada evento.</p>
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Evento Trigger</label>
            <select
              value={selectedTrigger}
              onChange={(event) => {
                setSelectedTrigger(event.target.value);
                setSavedAt(null);
              }}
              className="field-input bg-white"
            >
              <optgroup label="Requisiciones">
                <option value="requisition_created">Nueva Requisición Creada</option>
                <option value="requisition_status_changed">Cualquier Cambio de Estado (Requi)</option>
                <option value="requisition_status_revisando_compras">Compras inició la revisión</option>
                <option value="requisition_status_aprobada_compras">Requisición aprobada por Compras</option>
                <option value="requisition_status_cancelada_compras">Requisición cancelada por Compras</option>
                <option value="requisition_status_completado">Requisición completada en almacén</option>
              </optgroup>
              <optgroup label="Compras">
                <option value="purchase_order_created">Nueva Orden de Compra Creada</option>
                <option value="purchase_order_status_changed">Cualquier Cambio de Estado (Compra)</option>
                <option value="purchase_order_status_revisando_gerencia">Orden reenviada a revisión</option>
                <option value="purchase_order_status_aprobado">Orden de Compra Aprobada</option>
                <option value="purchase_order_status_rechazado">Orden de Compra Rechazada</option>
                <option value="purchase_order_status_completado">Orden de Compra Completada</option>
                <option value="purchase_order_status_cancelado">Orden de Compra Cancelada</option>
              </optgroup>
              <optgroup label="Recepciones">
                <option value="receipt_created">Nueva Recepción Iniciada</option>
                <option value="receipt_status_changed">Cualquier Cambio de Estado (Recepción)</option>
                <option value="receipt_status_recibida">Recepción Recibida</option>
                <option value="receipt_status_en_almacen">Recepción en Almacén (Cerrada)</option>
                <option value="receipt_has_differences">Recepción Registrada con Diferencias</option>
              </optgroup>
              <optgroup label="Traspasos">
                <option value="transfer_created">Nuevo Traspaso Creado</option>
                <option value="transfer_status_changed">Cualquier Cambio de Estado (Traspaso)</option>
                <option value="transfer_status_en_transito">Traspaso Enviado (En Tránsito)</option>
                <option value="transfer_status_completado">Traspaso Completado</option>
                <option value="transfer_status_cancelado">Traspaso Cancelado</option>
              </optgroup>
              <optgroup label="Operaciones">
                <option value="production_lot_created">Lote de Producción Registrado</option>
              </optgroup>
              <optgroup label="Mermas y Pérdidas">
                <option value="waste_entry_created">Pérdida/Merma/Caducidad Registrada</option>
              </optgroup>
            </select>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => { setEnabled(event.target.checked); setSavedAt(null); }}
            className="h-4 w-4 accent-[#B45309]"
          />
          <span className="text-sm font-bold text-stone-800">Activar notificaciones para este evento</span>
        </label>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-stone-500">Cuerpo del Mensaje (Plantilla)</label>
          <textarea
            value={template}
            onChange={(event) => { setTemplate(event.target.value); setSavedAt(null); }}
            placeholder="Escribe el cuerpo del mensaje..."
            className="field-input min-h-[120px] resize-y font-mono text-sm"
          />
          <p className="mt-1 text-xs text-stone-500">
            Puedes usar los siguientes placeholders:
          </p>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-stone-50 p-2.5 text-[11px] text-stone-600 border border-stone-100">
            <div><code>{"{{folio}}"}</code>: Folio (ej. REQ-1234)</div>
            <div><code>{"{{location}}"}</code>: Sucursal</div>
            <div><code>{"{{area}}"}</code>: Área solicitante</div>
            <div><code>{"{{request_type}}"}</code>: Tipo de solicitud</div>
            <div><code>{"{{status}}"}</code>: Estado actual</div>
            <div><code>{"{{requester}}"}</code>: Nombre del solicitante</div>
            <div><code>{"{{needed_by}}"}</code>: Fecha requerida</div>
            <div><code>{"{{notes}}"}</code>: Notas generales o nota de revisión</div>
            <div><code>{"{{old_status}}"}</code>: Estado anterior (cambios de estado)</div>
          </div>
        </div>

        <div className="mt-5 border-t border-[#EDE8E3] pt-4">
          <div className="flex flex-col gap-1 mb-3">
            <h4 className="text-sm font-extrabold text-stone-900">Destinatarios</h4>
            <p className="text-xs text-stone-500">Selecciona quiénes recibirán la notificación de WhatsApp para este evento.</p>
          </div>
          <div className="mt-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar empleado por nombre o teléfono…"
              className="field-input"
            />
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-[#EDE8E3]">
            {loading ? (
              <p className="p-4 text-sm text-stone-500">Cargando empleados…</p>
            ) : filteredEmployees.length === 0 ? (
              <p className="p-4 text-sm text-stone-500">Sin empleados que coincidan.</p>
            ) : (
              filteredEmployees.map((emp) => (
                <label
                  key={emp.id}
                  className={`flex items-center justify-between gap-3 border-b border-[#F1ECE7] px-3 py-2 last:border-b-0 ${emp.has_phone ? "cursor-pointer hover:bg-[#FAF7F4]" : "cursor-not-allowed opacity-55"}`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      disabled={!emp.has_phone}
                      checked={selectedIds.has(emp.id)}
                      onChange={() => toggleEmployee(emp.id)}
                      className="h-4 w-4 accent-[#B45309]"
                    />
                    <span className="text-sm font-medium text-stone-800">{emp.label}</span>
                  </span>
                  <span className="text-xs text-stone-500">{emp.has_phone ? emp.telefono : "sin teléfono"}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-stone-500">{selectedIds.size} destinatario(s) seleccionado(s)</p>
          <div className="flex items-center gap-3">
            {savedAt ? <span className="text-xs font-semibold text-emerald-600">Guardado</span> : null}
            <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarLogo({ large = false }: { large?: boolean }) {
  return (
    <div className={large ? "" : "border-b border-[#2D2926] px-5 py-5"}>
      <div className="flex items-center gap-3">
        <img
          src="/logo.png"
          alt="Logo Kadmiel"
          className={`${large ? "h-10" : "h-8"} w-auto shrink-0`}
          style={{ filter: "brightness(0) invert(1)" }}
        />
        {large ? (
          <div>
            <p className="text-lg font-extrabold leading-none text-white">Kadmiel</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C9BFB8]">Sistema de abastecimiento</p>
          </div>
        ) : null}
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
  return <div className="flex min-h-dvh items-center justify-center bg-[#F7F3EE] text-sm font-bold text-stone-500">Cargando Sistema de abastecimiento Kadmiel...</div>;
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

function formatSignedNumber(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function getReceivingDifference(item: Pick<ReceivingDraftItem, "received_quantity" | "purchased_quantity">) {
  return Number(item.received_quantity || 0) - Number(item.purchased_quantity ?? 0);
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

async function listAbastecimientoPurchaseOrders(client: NonNullable<ReturnType<typeof createBrowserSupabaseClient>>) {
  return client.rpc("list_abastecimiento_purchase_orders_v2");
}

async function listAbastecimientoRequisitions(client: NonNullable<ReturnType<typeof createBrowserSupabaseClient>>) {
  return client.rpc("list_abastecimiento_requisitions_v2");
}

async function listAbastecimientoReceivingOrders(
  client: NonNullable<ReturnType<typeof createBrowserSupabaseClient>>,
  params: { p_date_from: string | null; p_date_to: string | null },
) {
  return client.rpc("list_abastecimiento_receiving_orders_v2", params);
}

function getCommandId(commands: Map<string, string>, key: string) {
  const existing = commands.get(key);
  if (existing) return existing;
  const commandId = globalThis.crypto.randomUUID();
  commands.set(key, commandId);
  return commandId;
}

function canonicalRequisitionStatus(status: RequisitionStatus): RequisitionWorkflowStatus {
  if (status === "urgente") return "pendiente";
  if (status === "revisada") return "revisando_compras";
  if (status === "aprobada") return "aprobada_compras";
  if (status === "completado" || status === "completada") return "completado";
  if (status === "cancelada") return "cancelada_compras";
  return status;
}

function getRequisitionStatusOptions(status: RequisitionWorkflowStatus) {
  const allowed: Record<RequisitionWorkflowStatus, RequisitionWorkflowStatus[]> = {
    pendiente: ["pendiente", "revisando_compras", "cancelada_compras"],
    revisando_compras: ["revisando_compras", "aprobada_compras", "cancelada_compras"],
    aprobada_compras: ["aprobada_compras"],
    cancelada_compras: ["cancelada_compras"],
    completado: ["completado"],
  };
  return REQUISITION_STATUS_OPTIONS.filter(([value]) => allowed[status].includes(value));
}

function canonicalPurchaseOrderStatus(status: PurchaseOrderStatus): PurchaseOrderWorkflowStatus {
  if (status === "pendiente" || status === "urgente" || status === "parcial") return "revisando_gerencia";
  return status;
}

type PurchasePermissions = {
  accounting: boolean;
  management: boolean;
  purchasing: boolean;
};

function getPurchasePermissions(role: UserRole | null): PurchasePermissions {
  const admin = role?.role === "super_admin" || role?.role === "branch_admin";
  const department = normalize(role?.department ?? "");
  return {
    accounting: admin || department === "contabilidad" || department === "finanzas",
    management: admin || department === "gerencia" || department === "direccion",
    purchasing: admin || department === "compras",
  };
}

function getRealtimeLocationCapabilities(role: UserRole | null) {
  if (!role) return [];
  const all = ["purchasing", "accounting", "management", "receiving", "production", "inventory"];
  if (role.role === "super_admin" || role.role === "branch_admin") return all;

  const department = normalize(role.department ?? "");
  if (department === "compras") return ["purchasing", "inventory"];
  if (department === "contabilidad" || department === "finanzas") return ["accounting", "inventory"];
  if (department === "gerencia" || department === "direccion") return ["management", "inventory"];
  if (["logistica", "almacen", "recepcion"].includes(department)) return ["receiving", "inventory"];
  if (department === "produccion") return ["production", "inventory"];
  return ["inventory"];
}

function canManageReceiving(role: UserRole | null) {
  if (role?.role === "super_admin" || role?.role === "branch_admin") return true;
  return ["logistica", "almacen", "recepcion"].includes(normalize(role?.department ?? ""));
}

function getPurchaseOrderActions(order: PurchaseOrderRow, permissions: PurchasePermissions, currentUserId?: string): Array<[PurchaseOrderAction, string]> {
  const status = canonicalPurchaseOrderStatus(order.status);
  if (status === "rechazado") return permissions.purchasing ? [["cancelar", "Cancelar"]] : [];
  if (status !== "revisando_gerencia") return [];
  const actions: Array<[PurchaseOrderAction, string]> = [];
  if (!order.accounting_approved_at && permissions.accounting) actions.push(["aprobar_contabilidad", "Aprobar Contabilidad"]);
  if (order.accounting_approved_at && !order.management_approved_at && permissions.management && order.accounting_approved_by !== currentUserId) actions.push(["aprobar_gerencia", "Aprobar Gerencia"]);
  if (permissions.accounting || permissions.management) actions.push(["rechazar", "Rechazar"]);
  if (permissions.purchasing) actions.push(["cancelar", "Cancelar"]);
  return actions;
}

function getReceivingStatusOptions(status: ReceivingStatus) {
  const allowed: Record<ReceivingStatus, ReceivingStatus[]> = {
    pendiente: ["pendiente", "recibida"],
    recibida: ["recibida", "en_almacen"],
    en_almacen: ["en_almacen"],
  };
  return RECEIVING_STATUS_OPTIONS.filter(([value]) => allowed[status].includes(value));
}

function getRealtimeDomains(events: AbastecimientoDomainEvent[]) {
  const allDomains = Object.keys(INITIAL_REALTIME_INVALIDATIONS) as RealtimeDomain[];
  if (events.length === 0) return new Set(allDomains);

  const affected = new Set<RealtimeDomain>();
  events.forEach((event) => {
    const key = `${event.aggregate_type}.${event.event_type}`;
    const aggregate = normalize(event.aggregate_type);
    if (
      (event.location_id === null && event.audience_user_id === null) ||
      ["area", "supplier", "product", "productsettings", "inventorycatalog", "location", "category", "department", "inventoryassignment", "locationarea", "userrole"].includes(aggregate)
    ) affected.add("workspace");
    if (key.includes("requisition")) affected.add("requisitions");
    if (key.includes("purchase_order") || key.includes("purchase.")) {
      affected.add("purchases");
      affected.add("receipts");
    }
    if (key.includes("receipt")) {
      affected.add("receipts");
      affected.add("inventory");
    }
    if (key.includes("inventory") || key.includes("transfer") || key.includes("waste")) affected.add("inventory");
    if (["finishedproduct", "productlocation", "recipe"].includes(aggregate)) {
      affected.add("production");
      affected.add("inventory");
      affected.add("quality");
      affected.add("mermaPv");
    }
    if (key.includes("production")) {
      affected.add("production");
      affected.add("inventory");
      affected.add("quality");
    }
    if (key.includes("quality")) {
      affected.add("quality");
      affected.add("mermaPv");
    }
    if (key.includes("merma")) {
      affected.add("mermaPv");
      affected.add("inventory");
    }
  });
  return affected;
}

function incrementRealtimeInvalidations(current: RealtimeInvalidations, affected: Set<RealtimeDomain>) {
  const next = { ...current };
  affected.forEach((domain) => {
    next[domain] += 1;
  });
  return next;
}

function mergeLatestRealtimeEvents(
  current: AbastecimientoDomainEvent[],
  incoming: AbastecimientoDomainEvent[],
) {
  if (incoming.length === 0) return current;
  const events = new Map(current.map((event) => [`${event.aggregate_type}:${event.aggregate_id}`, event]));
  incoming.forEach((event) => {
    const key = `${event.aggregate_type}:${event.aggregate_id}`;
    const previous = events.get(key);
    if (!previous || event.aggregate_version >= previous.aggregate_version) events.set(key, event);
  });
  return Array.from(events.values());
}

function hasNewerAggregateEvent(
  batch: RealtimeBatch,
  aggregateTypes: string[],
  aggregateIds: Array<string | null>,
  version?: number,
) {
  const ids = new Set(aggregateIds.filter((id): id is string => Boolean(id)));
  return batch.events.some((event) => {
    const payloadId = typeof event.payload.purchase_order_id === "string" ? event.payload.purchase_order_id : null;
    const matchesAggregate = aggregateTypes.includes(event.aggregate_type) && (ids.has(event.aggregate_id) || Boolean(payloadId && ids.has(payloadId)));
    return matchesAggregate && (event.event_type === "deleted" || version === undefined || event.aggregate_version > version);
  });
}

function hasNewerVersion(current?: number, baseline?: number) {
  return typeof current === "number" && typeof baseline === "number" && current > baseline;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
}

function getFilteredProductsForUser(
  products: ProductRow[],
  role: UserRole | null,
  categoryMap: Map<string, string>,
  inventoryAreas: InventoryAreaLink[],
  inventoryDepts: InventoryDepartmentLink[]
): ProductRow[] {
  if (!role || role.role === "super_admin") return products;

  const userDeptId = role.department_id;
  const userAreaId = role.area_id;

  const filtered = products.filter((product) => {
    // Check department constraint: must match user's department
    const productDepts = inventoryDepts.filter((d) => d.inventory_id === product.id);
    const hasDeptMatch = productDepts.some((d) => d.department_id === userDeptId);
    if (!hasDeptMatch) return false;

    // Check area constraint: must match user's area
    const productAreas = inventoryAreas.filter((a) => a.inventory_id === product.id);
    const hasAreaMatch = productAreas.some((a) => a.area_id === userAreaId);
    if (!hasAreaMatch) return false;

    return true;
  });

  return filtered;
}
