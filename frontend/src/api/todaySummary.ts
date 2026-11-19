import { z } from "zod";
import { apiRequest } from "./client";

export const todaySummarySchema = z.object({ today_visit_count: z.number().int().nonnegative(), today_guest_count: z.number().int().nonnegative(), today_net_sales_amount: z.string() });
export const fetchTodaySummary = (store: string) => apiRequest(todaySummarySchema, `/stores/${store}/today-summary`);
