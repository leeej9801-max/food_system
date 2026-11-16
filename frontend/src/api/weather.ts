import { apiRequest } from "./client";
import { weatherMonthSchema } from "./schemas";
import type { WeatherMonthResponse } from "../types";

export function fetchWeatherMonth(month: string): Promise<WeatherMonthResponse> {
  return apiRequest(weatherMonthSchema, `/weather?month=${month}`);
}
