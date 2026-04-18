/**
 * Weather Service — Open-Meteo Integration
 *
 * Uses the free Open-Meteo API (no API key required) to fetch
 * current weather conditions based on GPS coordinates.
 *
 * Endpoint: https://api.open-meteo.com/v1/forecast
 * Docs:     https://open-meteo.com/en/docs
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
        temperature_2m: number;
        apparent_temperature?: number;
        weather_code: number;
    };
    daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
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

// ==================== Cache ====================

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

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
 * Returns cached data if available and fresh (< 15 min).
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

    try {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&current=temperature_2m,apparent_temperature,weather_code` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
            `&forecast_days=1` +
            `&timezone=auto`;

        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[WeatherService] HTTP ${response.status}`);
            return cachedWeather; // Return stale cache on error
        }

        const data: OpenMeteoResponse = await response.json();
        const { temperature_2m, apparent_temperature, weather_code } = data.current;
        const { condition, icon } = mapWmoCode(weather_code);
        const maxTemp = data.daily?.temperature_2m_max?.[0];
        const minTemp = data.daily?.temperature_2m_min?.[0];
        const precipitationProbabilityMax = data.daily?.precipitation_probability_max?.[0];

        const weather: WeatherData = {
            temp: `${Math.round(temperature_2m)}°C`,
            heatIndex: typeof apparent_temperature === 'number' ? `${Math.round(apparent_temperature)}°C` : undefined,
            rainChance: typeof precipitationProbabilityMax === 'number' ? `${Math.round(precipitationProbabilityMax)}%` : undefined,
            lowTemp: typeof minTemp === 'number' ? `${Math.round(minTemp)}°C` : undefined,
            highTemp: typeof maxTemp === 'number' ? `${Math.round(maxTemp)}°C` : undefined,
            condition,
            icon,
        };

        // Update cache
        cachedWeather = weather;
        cacheTimestamp = Date.now();
        cacheKey = key;

        return weather;
    } catch (error) {
        console.warn('[WeatherService] Fetch failed:', error);
        return cachedWeather; // Return stale cache on network error
    }
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
