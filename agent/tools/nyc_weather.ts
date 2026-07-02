import { defineTool } from "eve/tools";
import { z } from "zod";

// A few well-known NYC neighborhoods → coordinates. Puar defaults to Manhattan
// (Midtown) when no neighborhood is given. Add more here as they come up.
const NEIGHBORHOODS: Record<string, { lat: number; lon: number; label: string }> = {
  manhattan: { lat: 40.7549, lon: -73.984, label: "Midtown Manhattan" },
  midtown: { lat: 40.7549, lon: -73.984, label: "Midtown Manhattan" },
  "lower east side": { lat: 40.715, lon: -73.984, label: "Lower East Side" },
  williamsburg: { lat: 40.7081, lon: -73.9571, label: "Williamsburg, Brooklyn" },
  "park slope": { lat: 40.672, lon: -73.9776, label: "Park Slope, Brooklyn" },
  astoria: { lat: 40.7644, lon: -73.9235, label: "Astoria, Queens" },
  "long island city": { lat: 40.7447, lon: -73.9485, label: "Long Island City, Queens" },
  "the bronx": { lat: 40.8448, lon: -73.8648, label: "The Bronx" },
  harlem: { lat: 40.8116, lon: -73.9465, label: "Harlem" },
};

// WMO weather interpretation codes → plain-English conditions.
const WEATHER_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

export default defineTool({
  description:
    "Get current NYC weather. Defaults to Manhattan; pass a neighborhood " +
    "(e.g. 'Williamsburg', 'Astoria', 'Harlem') to target it.",
  inputSchema: z.object({
    neighborhood: z
      .string()
      .optional()
      .describe("An NYC neighborhood. Omit for Manhattan."),
  }),
  async execute({ neighborhood }) {
    const key = neighborhood?.trim().toLowerCase() ?? "";
    const place = NEIGHBORHOODS[key] ?? NEIGHBORHOODS.manhattan;
    const matched = key !== "" && key in NEIGHBORHOODS;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.lat));
    url.searchParams.set("longitude", String(place.lon));
    url.searchParams.set(
      "current",
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    );
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("precipitation_unit", "inch");
    url.searchParams.set("timezone", "America/New_York");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Weather service returned ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      current?: {
        temperature_2m: number;
        apparent_temperature: number;
        precipitation: number;
        weather_code: number;
        wind_speed_10m: number;
      };
    };
    const c = data.current;
    if (!c) throw new Error("Weather service returned no current conditions.");

    return {
      location: place.label,
      matchedNeighborhood: matched,
      conditions: WEATHER_CODES[c.weather_code] ?? "unknown",
      temperatureF: Math.round(c.temperature_2m),
      feelsLikeF: Math.round(c.apparent_temperature),
      windMph: Math.round(c.wind_speed_10m),
      precipitationInches: c.precipitation,
    };
  },
});
