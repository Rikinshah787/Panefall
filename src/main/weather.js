// Live weather from Open-Meteo (https://open-meteo.com): free for non-commercial use, no API
// key, no account. Turns the conditions at a place into a Panefall scene: which weather,
// how heavy, and which way the wind pushes it across the screen.
//
// The only data that leaves the computer is the latitude/longitude of the place the user
// picked (and the text they type into the place search).
const { EventEmitter } = require('events');

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REFRESH_MS = 15 * 60 * 1000;

// WMO weather interpretation codes -> [description, scene, intensity 0..1]
const CODES = {
  0: ['Clear', 'clear', 0],
  1: ['Mostly clear', 'clear', 0],
  2: ['Partly cloudy', 'clear', 0],
  3: ['Overcast', 'clear', 0],
  45: ['Fog', 'clear', 0],
  48: ['Freezing fog', 'clear', 0],
  51: ['Light drizzle', 'rain', 0.12],
  53: ['Drizzle', 'rain', 0.22],
  55: ['Heavy drizzle', 'rain', 0.32],
  56: ['Freezing drizzle', 'rain', 0.2],
  57: ['Freezing drizzle', 'rain', 0.3],
  61: ['Light rain', 'rain', 0.3],
  63: ['Rain', 'rain', 0.55],
  65: ['Heavy rain', 'rain', 0.9],
  66: ['Freezing rain', 'rain', 0.45],
  67: ['Freezing rain', 'rain', 0.75],
  71: ['Light snow', 'snow', 0.25],
  73: ['Snow', 'snow', 0.5],
  75: ['Heavy snow', 'snow', 0.85],
  77: ['Snow grains', 'snow', 0.2],
  80: ['Rain showers', 'rain', 0.4],
  81: ['Rain showers', 'rain', 0.65],
  82: ['Violent rain showers', 'rain', 0.95],
  85: ['Snow showers', 'snow', 0.45],
  86: ['Heavy snow showers', 'snow', 0.8],
  95: ['Thunderstorm', 'storm', 0.7],
  96: ['Thunderstorm with hail', 'storm', 0.85],
  99: ['Thunderstorm with hail', 'storm', 0.95],
};

function describe(code) {
  const [description, weather, intensity] = CODES[code] || ['Unknown', 'clear', 0];
  return { description, weather, intensity };
}

/** What to show when it is dry outside: blossoms in spring, leaves in autumn (hemisphere-aware). */
function seasonalWeather(date, latitude) {
  let month = date.getMonth(); // 0 = January
  if (latitude < 0) month = (month + 6) % 12;
  if (month >= 2 && month <= 4) return 'blossoms';
  if (month >= 8 && month <= 10) return 'leaves';
  return 'clear';
}

/** Wind as a sideways push on screen: -1 (to the left) .. 1 (to the right). */
function screenWind(speedKmh, fromDegrees) {
  const toward = ((fromDegrees + 180) * Math.PI) / 180; // meteorological direction is where it comes FROM
  return Math.max(-1, Math.min(1, (Math.sin(toward) * speedKmh) / 40));
}

async function getJson(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Open-Meteo answered HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timed out reaching Open-Meteo');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function searchPlaces(query) {
  const q = String(query || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const data = await getJson(`${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  return (data.results || []).map((r) => ({
    name: r.name,
    region: r.admin1 || '',
    country: r.country || '',
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

async function fetchWeather(location, units = 'celsius') {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    forecast_hours: '12',
    timezone: 'auto',
    temperature_unit: units,
    wind_speed_unit: 'kmh',
  });
  const data = await getJson(`${FORECAST_URL}?${params}`);
  const current = data.current;
  const now = describe(current.weather_code);
  const h = data.hourly || {};
  const hourly = (h.time || []).map((time, i) => ({
    time, // local time at the place, e.g. "2026-11-07T14:00"
    temperature: h.temperature_2m[i],
    code: h.weather_code[i],
    precipitationProbability: h.precipitation_probability ? h.precipitation_probability[i] : null,
    ...describe(h.weather_code[i]),
  }));
  return {
    location,
    units,
    temperature: current.temperature_2m,
    code: current.weather_code,
    description: now.description,
    isDay: current.is_day === 1,
    scene: { weather: now.weather, intensity: now.intensity },
    wind: {
      speed: current.wind_speed_10m,
      direction: current.wind_direction_10m,
      screen: screenWind(current.wind_speed_10m, current.wind_direction_10m),
    },
    hourly,
    fetchedAt: Date.now(),
  };
}

/** Keeps the weather for one place fresh. Emits 'update' (data) and 'error' (message). */
class WeatherService extends EventEmitter {
  constructor() {
    super();
    this.location = null;
    this.units = 'celsius';
    this.timer = null;
    this.data = null;
  }

  configure(location, units) {
    const changed = JSON.stringify([location, units]) !== JSON.stringify([this.location, this.units]);
    this.location = location;
    this.units = units;
    if (changed) {
      this.data = null;
      this.refresh();
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    this.refresh();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async refresh() {
    if (!this.location) return;
    const { location, units } = this;
    try {
      const data = await fetchWeather(location, units);
      if (location !== this.location || units !== this.units) return; // changed while we waited
      this.data = data;
      this.emit('update', data);
    } catch (err) {
      this.emit('error', err.message);
    }
  }
}

module.exports = { WeatherService, searchPlaces, fetchWeather, seasonalWeather, screenWind, describe };
