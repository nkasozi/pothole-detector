export type CacheStrategy =
  | {
      ttl: number;
      swr: number;
    }
  | {
      ttl: number;
    }
  | {
      swr: number;
    };

export type AccelerateInfo = {
  cacheStatus: "ttl" | "swr" | "miss" | "none";
  lastModified: Date;
  region: string;
  requestId: string;
  signature: string;
};

export type Quote = {
  id: number;
  quote: string;
  createdAt: string;
};

export type QuoteResult = {
  data: Quote;
  info: AccelerateInfo;
  time: number;
};

export type QuoteCacheType = "SWR" | "TTL" | "No caching" | "TTL + SWR";

// New types for pothole detection
export interface AccelerometerReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface LocationData {
  latitude: number;
  longitude: number;
  speed: number | null; // in m/s
  accuracy: number;
  timestamp: number;
}

export interface PotholeEvent {
  id: string;
  timestamp: number;
  accelerometer: AccelerometerReading;
  location: LocationData;
  speed: number | null;
  label: 'pothole_detected' | 'pothole_confirmed' | 'false_positive';
  voiceConfirmed: boolean;
  severity: 'low' | 'medium' | 'high';
}

export interface DrivingSession {
  id: string;
  startTime: number;
  endTime: number | null;
  events: PotholeEvent[];
  totalDistance: number;
  averageSpeed: number;
}

export type SessionStatus = 'idle' | 'active' | 'paused';
