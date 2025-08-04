import type { AccelerometerReading, LocationData, PotholeEvent, DrivingSession } from '../types';

// Pothole detection threshold (in m/s²)
const POTHOLE_THRESHOLD = 15; // Adjust based on testing

// TypeScript declarations for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export class SensorManager {
  private _accelerometerPermission = false;
  private _locationPermission = false;
  private _microphonePermission = false;
  private watchId: number | null = null;
  private accelerometerInterval: number | null = null;
  private speechRecognition: any = null;

  get accelerometerPermission(): boolean {
    return this._accelerometerPermission;
  }

  get locationPermission(): boolean {
    return this._locationPermission;
  }

  get microphonePermission(): boolean {
    return this._microphonePermission;
  }

  async requestPermissions(): Promise<boolean> {
    // Request accelerometer permission
    try {
      if ('DeviceMotionEvent' in window && typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const motionPermission = await (DeviceMotionEvent as any).requestPermission();
        this._accelerometerPermission = motionPermission === 'granted';
      } else {
        this._accelerometerPermission = true; // Assume granted on non-iOS devices
      }
    } catch (error) {
      console.warn('Accelerometer permission failed:', error);
      this._accelerometerPermission = false;
    }

    // Request location permission
    try {
      if ('geolocation' in navigator) {
        await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            { timeout: 10000, enableHighAccuracy: false }
          );
        });
        this._locationPermission = true;
      }
    } catch (error) {
      console.warn('Location permission failed:', error);
      // Still allow the app to work without location
      this._locationPermission = 'geolocation' in navigator; // Mark as available even if permission denied
    }

    // Request microphone permission for speech recognition
    try {
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop()); // Stop the stream immediately
        this._microphonePermission = true;
      }
    } catch (error) {
      console.warn('Microphone permission failed:', error);
      this._microphonePermission = false;
    }

    // Return true if we have at least accelerometer (core functionality)
    const hasEssentialPermissions = this._accelerometerPermission;

    if (!hasEssentialPermissions) {
      console.error('Essential permissions (accelerometer) not granted');
    }

    return hasEssentialPermissions;
  }

  startAccelerometer(callback: (reading: AccelerometerReading) => void): void {
    if (!this._accelerometerPermission) return;

    const handleMotion = (event: DeviceMotionEvent) => {
      if (event.accelerationIncludingGravity) {
        const reading: AccelerometerReading = {
          x: event.accelerationIncludingGravity.x || 0,
          y: event.accelerationIncludingGravity.y || 0,
          z: event.accelerationIncludingGravity.z || 0,
          timestamp: Date.now()
        };
        callback(reading);
      }
    };

    window.addEventListener('devicemotion', handleMotion);
  }

  startLocationTracking(callback: (location: LocationData) => void): void {
    if (!this._locationPermission || !('geolocation' in navigator)) return;

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const location: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          speed: position.coords.speed,
          accuracy: position.coords.accuracy,
          timestamp: Date.now()
        };
        callback(location);
      },
      (error) => {
        console.warn('Location tracking error:', error);
        // Provide a fallback location or disable location-based features
        switch(error.code) {
          case error.PERMISSION_DENIED:
            console.warn('User denied location access');
            break;
          case error.POSITION_UNAVAILABLE:
            console.warn('Location information is unavailable');
            break;
          case error.TIMEOUT:
            console.warn('Location request timed out');
            break;
        }
      },
      options
    );
  }

  startSpeechRecognition(callback: (transcript: string) => void): void {
    if (!this._microphonePermission) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = false;
      this.speechRecognition.lang = 'en-US';

      this.speechRecognition.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
        callback(transcript);
      };

      this.speechRecognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
      };

      this.speechRecognition.start();
    }
  }

  stopAllSensors(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.accelerometerInterval !== null) {
      clearInterval(this.accelerometerInterval);
      this.accelerometerInterval = null;
    }

    if (this.speechRecognition) {
      this.speechRecognition.stop();
      this.speechRecognition = null;
    }

    window.removeEventListener('devicemotion', () => {});
  }
}

export function detectPothole(reading: AccelerometerReading): boolean {
  // Calculate magnitude of acceleration vector
  const magnitude = Math.sqrt(reading.x * reading.x + reading.y * reading.y + reading.z * reading.z);

  // Check if magnitude exceeds threshold (indicating a sudden jolt)
  return magnitude > POTHOLE_THRESHOLD;
}

export function calculateSeverity(reading: AccelerometerReading): 'low' | 'medium' | 'high' {
  const magnitude = Math.sqrt(reading.x * reading.x + reading.y * reading.y + reading.z * reading.z);

  if (magnitude > 25) return 'high';
  if (magnitude > 20) return 'medium';
  return 'low';
}

export function generateEventId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function exportSessionData(session: DrivingSession): void {
  const dataStr = JSON.stringify(session, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

  const exportFileDefaultName = `pothole-session-${new Date().toISOString().split('T')[0]}.txt`;

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}
