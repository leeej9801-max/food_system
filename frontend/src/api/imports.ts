import { z } from "zod";
import { apiRequest } from "./client";
import { csvCommitSchema, csvPreviewSchema, integrationStatusSchema, productMappingSchema, salesOrderSchema, salesOrdersListSchema, sampleCsvSchema } from "./schemas";
import type {
  CsvColumnMapping,
  CsvCommitResponse,
  CsvPreviewResponse,
  IntegrationStatus,
  PosModeType,
  ProductMapping,
  SalesOrder,
  SalesOrdersListResponse,
} from "../types";

export function fetchIntegrationStatus(storeId: string): Promise<IntegrationStatus> {
  return apiRequest(integrationStatusSchema, `/stores/${storeId}/integrations/status`);
}

export function updatePosMode(
  storeId: string,
  mode: PosModeType
): Promise<IntegrationStatus> {
  return apiRequest(integrationStatusSchema, `/stores/${storeId}/integrations/mode`, {
    method: "PATCH",
    body: JSON.stringify({ mode }),
  });
}

export function fetchSampleSalesCsv(
  storeId: string
): Promise<{ file_name: string; csv_text: string }> {
  return apiRequest(sampleCsvSchema, `/stores/${storeId}/imports/sales-csv/sample`
  );
}

export function previewSalesCsv(
  storeId: string,
  payload: {
    file_name: string;
    csv_text: string;
    mapping?: CsvColumnMapping;
  }
): Promise<CsvPreviewResponse> {
  return apiRequest(csvPreviewSchema, `/stores/${storeId}/imports/sales-csv/preview`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export function commitSalesCsv(
  storeId: string,
  batchId: string
): Promise<CsvCommitResponse> {
  return apiRequest(csvCommitSchema, `/stores/${storeId}/imports/sales-csv/${batchId}/commit`,
    {
      method: "POST",
    }
  );
}

export function fetchProductMappings(storeId: string): Promise<ProductMapping[]> {
  return apiRequest(z.array(productMappingSchema), `/stores/${storeId}/integrations/mappings`);
}

export function upsertProductMapping(
  storeId: string,
  payload: { external_product_name: string; menu_item_id: string }
): Promise<ProductMapping> {
  return apiRequest(productMappingSchema, `/stores/${storeId}/integrations/mappings`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchSalesOrders(storeId: string): Promise<SalesOrdersListResponse> {
  return apiRequest(salesOrdersListSchema, `/stores/${storeId}/sales-orders`);
}

export function updateSalesOrder(
  storeId: string,
  orderId: string,
  payload: {
    order_status?: "COMPLETED" | "CANCELLED";
    items?: Array<{ item_id: string; quantity: number }>;
  }
): Promise<SalesOrder> {
  return apiRequest(salesOrderSchema, `/stores/${storeId}/sales-orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createManualSalesOrder(
  storeId: string,
  payload: {
    external_order_id?: string;
    items: Array<{ menu_item_id: string; quantity: number }>;
  }
): Promise<SalesOrder> {
  return apiRequest(salesOrderSchema, `/stores/${storeId}/sales-orders`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

