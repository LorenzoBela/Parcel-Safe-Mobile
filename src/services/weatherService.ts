/**
 * Weather Service
 *
 * Provider strategy:
 * 1) WeatherAPI (primary, free tier, requires EXPO_PUBLIC_WEATHERAPI_KEY)
 * 2) Open-Meteo (fallback, no key)
 *
 * This keeps the app running without additional setup while allowing
 * higher-quality forecast signals when a WeatherAPI key is configured.
 */

// ==================== Types ====================

export interface WeatherData {
    /** Formatted temperature string, e.g. "28°C" */
    temp: string;
    /** Formatted heat index string, e.g. "32°C" */
    heatIndex?: string;
    /** Formatted rain chance string, e.g. "60%" */
    rainChance?: string;
    /** Formatted daily low temperature string, e.g. "7°C" */
    lowTemp?: string;
    /** Formatted daily high temperature string, e.g. "23°C" */
    highTemp?: string;
    /** Human-readable condition: Sunny, Cloudy, Rainy, etc. */
    condition: string;
    /** MaterialCommunityIcons name for the condition */
    icon: string;
}

interface OpenMeteoResponse {
    current: {
        time?: string;
        temperature_2m: number;
        apparent_temperature?: number;
        weather_code: number;
    };
    hourly?: {
        time?: string[];
        precipitation_probability?: number[];
        precipitation?: number[];
    };
    daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
    };
}

interface WeatherApiResponse {
    current?: {
        temp_c?: number;
        feelslike_c?: number;
        last_updated_epoch?: number;
        condition?: {
            code?: number;
        };
    };
    forecast?: {
        forecastday?: Array<{
            day?: {
                maxtemp_c?: number;
                mintemp_c?: number;
                daily_chance_of_rain?: number | string;
            };
            hour?: Array<{
                time_epoch?: number;
                chance_of_rain?: number | string;
                precip_mm?: number;
                will_it_rain?: number | string;
            }>;
        }>;
    };
}

// ==================== WMO Code Mapping ====================

/**
 * Maps WMO Weather interpretation codes (WW) to UI-friendly
 * condition strings and MaterialCommunityIcons names.
 *
 * Reference: https://open-meteo.com/en/docs → WMO Weather interpretation codes
 */
function mapWmoCode(code: number): { condition: string; icon: string } {
    if (code <= 1) {
        return { condition: 'Sunny', icon: 'weather-sunny' };
    }
    if (code >= 2 && code <= 3) {
        return { condition: 'Cloudy', icon: 'weather-cloudy' };
    }
    if (code === 45 || code === 48) {
        return { condition: 'Foggy', icon: 'weather-fog' };
    }
    if (code >= 51 && code <= 67) {
        return { condition: 'Rainy', icon: 'weather-rainy' };
    }
    if (code >= 71 && code <= 77) {
        return { condition: 'Snowy', icon: 'weather-snowy' };
    }
    if (code >= 80 && code <= 82) {
        return { condition: 'Rainy', icon: 'weather-pouring' };
    }
    if (code >= 95 && code <= 99) {
        return { condition: 'Thunder', icon: 'weather-lightning' };
    }
    // Fallback for unknown codes
    return { condition: 'Cloudy', icon: 'weather-cloudy' };
}

function mapWeatherApiCode(code: number): { condition: string; icon: string } {
    if (code === 1000) {
        return { condition: 'Sunny', icon: 'weather-sunny' };
    }
    if (code === 1003 || code === 1006 || code === 1009) {
        return { condition: 'Cloudy', icon: 'weather-cloudy' };
    }
    if (code === 1030 || code === 1135 || code === 1147) {
        return { condition: 'Foggy', icon: 'weather-fog' };
    }
    if (code === 1087 || code === 1273 || code === 1276 || code === 1279 || code === 1282) {
        return { condition: 'Thunder', icon: 'weather-lightning' };
    }

    const snowyCodes = new Set([
        1066, 1069, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219,
        1222, 1225, 1237, 1249, 1252, 1255, 1258, 1261, 1264,
    ]);

    if (snowyCodes.has(code)) {
        return { condition: 'Snowy', icon: 'weather-snowy' };
    }

    // Remaining common WeatherAPI weather codes are drizzle/rain variants.
    return { condition: 'Rainy', icon: 'weather-rainy' };
}

function parseNumberish(value: number | string | undefined | null): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function clampPercentage(value: number): number {
    return Math.min(100, Math.max(0, value));
}

function findNearestTimeIndex(times: string[], targetIso?: string): number {
    if (!targetIso) return -1;
    const targetMs = new Date(targetIso).getTime();
    if (Number.isNaN(targetMs)) return -1;

    let nearestIndex = -1;
    let nearestDelta = Number.POSITIVE_INFINITY;

    for (let i = 0; i < times.length; i += 1) {
        const slotMs = new Date(times[i]).getTime();
        if (Number.isNaN(slotMs)) continue;
        const delta = Math.abs(slotMs - targetMs);
        if (delta < nearestDelta) {
            nearestDelta = delta;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}

function adjustedHourlyRainProbability(probability?: number, precipitationMm?: number): number {
    if (typeof probability !== 'number') return 0;
    const baseProbability = clampPercentage(probability);

    if (typeof precipitationMm !== 'number') {
        return baseProbability;
    }

    // Dampen probabilities when forecast rain amount is too small to be meaningful.
    if (precipitationMm <= 0.02) return baseProbability * 0.2;
    if (precipitationMm <= 0.1) return baseProbability * 0.45;
    if (precipitationMm <= 0.3) return baseProbability * 0.7;
    return baseProbability;
}

function computeNearTermRainChance(data: OpenMeteoResponse): string | undefined {
    const probabilities = data.hourly?.precipitation_probability;
    const precipitation = data.hourly?.precipitation;

    if (!probabilities?.length) {
        const fallback = data.daily?.precipitation_probability_max?.[0];
        return typeof fallback === 'number' ? `${Math.round(clampPercentage(fallback))}%` : undefined;
    }

    const times = data.hourly?.time;
    const currentTime = data.current?.time;
    const windowHours = Math.min(4, probabilities.length);

    let startIndex = 0;
    if (times?.length) {
        const exactIndex = currentTime ? times.indexOf(currentTime) : -1;
        startIndex = exactIndex >= 0 ? exactIndex : findNearestTimeIndex(times, currentTime);
        if (startIndex < 0) startIndex = 0;
    }

    const endIndex = Math.min(startIndex + windowHours, probabilities.length);
    let noRainProbability = 1;

    for (let i = startIndex; i < endIndex; i += 1) {
        const adjustedProbability = adjustedHourlyRainProbability(probabilities[i], precipitation?.[i]);
        noRainProbability *= 1 - (adjustedProbability / 100);
    }

    const chance = clampPercentage((1 - noRainProbability) * 100);
    return `${Math.round(chance)}%`;
}

function computeWeatherApiRainChance(data: WeatherApiResponse): string | undefined {
    const dayChance = parseNumberish(data.forecast?.forecastday?.[0]?.day?.daily_chance_of_rain);
    const hours = data.forecast?.forecastday?.[0]?.hour;

    if (!hours?.length) {
        return typeof dayChance === 'number' ? `${Math.round(clampPercentage(dayChance))}%` : undefined;
    }

    const nowEpoch = parseNumberish(data.current?.last_updated_epoch);
    let startIndex = 0;

    if (typeof nowEpoch === 'number') {
        const nextHourIndex = hours.findIndex((hour) => {
            const epoch = parseNumberish(hour.time_epoch);
            return typeof epoch === 'number' && epoch >= nowEpoch;
        });
        if (nextHourIndex >= 0) {
            startIndex = nextHourIndex;
        }
    }

    const endIndex = Math.min(startIndex + 4, hours.length);
    let noRainProbability = 1;

    for (let i = startIndex; i < endIndex; i += 1) {
        const hour = hours[i];
        const explicitChance = parseNumberish(hour.chance_of_rain);
        const willItRain = parseNumberish(hour.will_it_rain);
        const derivedChance = willItRain === 1 ? 65 : 0;
        const chance = typeof explicitChance === 'number' ? explicitChance : derivedChance;
        const precipitation = parseNumberish(hour.precip_mm);
        const adjustedProbability = adjustedHourlyRainProbability(chance, precipitation);
        noRainProbability *= 1 - (adjustedProbability / 100);
    }

    const nearTermChance = clampPercentage((1 - noRainProbability) * 100);
    if (nearTermChance <= 0 && typeof dayChance === 'number') {
        return `${Math.round(clampPercentage(dayChance))}%`;
    }

    return `${Math.round(nearTermChance)}%`;
}

async function fetchWeatherFromWeatherApi(
    latitude: number,
    longitude: number,
): Promise<WeatherData | null> {
    const apiKey = process.env.EXPO_PUBLIC_WEATHERAPI_KEY?.trim();
    if (!apiKey) {
        return null;
    }

    try {
        const url =
            `https://api.weatherapi.com/v1/forecast.json` +
            `?key=${encodeURIComponent(apiKey)}` +
            `&q=${encodeURIComponent(`${latitude},${longitude}`)}` +
            `&days=1` +
            `&aqi=no` +
            `&alerts=no`;

        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[WeatherService] WeatherAPI HTTP ${response.status}`);
            return null;
        }

        const data: WeatherApiResponse = await response.json();
        const temp = parseNumberish(data.current?.temp_c);
        if (typeof temp !== 'number') {
            return null;
        }

        const feelsLike = parseNumberish(data.current?.feelslike_c);
        const weatherCode = parseNumberish(data.current?.condition?.code);
        const { condition, icon } = mapWeatherApiCode(
            typeof weatherCode === 'number' ? Math.round(weatherCode) : 1003,
        );
        const maxTemp = parseNumberish(data.forecast?.forecastday?.[0]?.day?.maxtemp_c);
        const minTemp = parseNumberish(data.forecast?.forecastday?.[0]?.day?.mintemp_c);
        const rainChance = computeWeatherApiRainChance(data);

        return {
            temp: `${Math.round(temp)}°C`,
            heatIndex: typeof feelsLike === 'number' ? `${Math.round(feelsLike)}°C` : undefined,
            rainChance,
            lowTemp: typeof minTemp === 'number' ? `${Math.round(minTemp)}°C` : undefined,
            highTemp: typeof maxTemp === 'number' ? `${Math.round(maxTemp)}°C` : undefined,
            condition,
            icon,
        };
    } catch (error) {
        console.warn('[WeatherService] WeatherAPI fetch failed:', error);
        return null;
    }
}

async function fetchWeatherFromOpenMeteo(
    latitude: number,
    longitude: number,
): Promise<WeatherData | null> {
    try {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&current=temperature_2m,apparent_temperature,weather_code` +
            `&hourly=precipitation_probability,precipitation` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
            `&forecast_days=1` +
            `&timezone=auto`;

        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[WeatherService] Open-Meteo HTTP ${response.status}`);
            return null;
        }

        const data: OpenMeteoResponse = await response.json();
        const { temperature_2m, apparent_temperature, weather_code } = data.current;
        const { condition, icon } = mapWmoCode(weather_code);
        const maxTemp = data.daily?.temperature_2m_max?.[0];
        const minTemp = data.daily?.temperature_2m_min?.[0];
        const rainChance = computeNearTermRainChance(data);

        return {
            temp: `${Math.round(temperature_2m)}°C`,
            heatIndex: typeof apparent_temperature === 'number' ? `${Math.round(apparent_temperature)}°C` : undefined,
            rainChance,
            lowTemp: typeof minTemp === 'number' ? `${Math.round(minTemp)}°C` : undefined,
            highTemp: typeof maxTemp === 'number' ? `${Math.round(maxTemp)}°C` : undefined,
            condition,
            icon,
        };
    } catch (error) {
        console.warn('[WeatherService] Open-Meteo fetch failed:', error);
        return null;
    }
}

// ==================== Cache ====================

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cachedWeather: WeatherData | null = null;
let cacheTimestamp = 0;
let cacheKey = '';

function getCacheKey(lat: number, lng: number): string {
    // Round to 2 decimal places so nearby coords share cache
    return `${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

// ==================== Public API ====================

/**
 * Fetch current weather for the given coordinates.
 *
 * Returns cached data if available and fresh (< 10 min).
 * Returns `null` on network errors — callers should handle gracefully.
 */
export async function fetchWeather(
    latitude: number,
    longitude: number,
): Promise<WeatherData | null> {
    const key = getCacheKey(latitude, longitude);

    // Return cached data if still fresh
    if (cachedWeather && key === cacheKey && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
        return cachedWeather;
    }

    const weather =
        (await fetchWeatherFromWeatherApi(latitude, longitude))
        || (await fetchWeatherFromOpenMeteo(latitude, longitude));

    if (!weather) {
        return cachedWeather; // Return stale cache on provider/network failure
    }

    // Update cache
    cachedWeather = weather;
    cacheTimestamp = Date.now();
    cacheKey = key;

    return weather;
}

// ==================== Background Image URLs ====================

/**
 * Unsplash background images keyed by weather condition.
 * Used by dashboard headers for the ImageBackground component.
 */
export const weatherBackgroundImages: Record<string, string> = {
    'Sunny': 'https://images.pexels.com/photos/912110/pexels-photo-912110.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'Cloudy': 'https://images.pexels.com/photos/531756/pexels-photo-531756.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'Rainy': 'https://images.pexels.com/photos/459451/pexels-photo-459451.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'Thunder': 'https://images.pexels.com/photos/1118873/pexels-photo-1118873.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'Foggy': 'https://images.pexels.com/photos/167699/pexels-photo-167699.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
    'Snowy': 'https://images.pexels.com/photos/688660/pexels-photo-688660.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
};
