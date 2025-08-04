<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { AccelerometerReading, LocationData, PotholeEvent, DrivingSession, SessionStatus } from '../lib/types';
  import { SensorManager, detectPothole, calculateSeverity, generateEventId, exportSessionData, calculateDistance } from '../lib/utils/sensors';

  // Session state
  let sessionStatus: SessionStatus = 'idle';
  let currentSession: DrivingSession | null = null;
  let sensorManager: SensorManager;
  let permissionsGranted = false;
  let permissionDetails = {
    accelerometer: false,
    location: false
  };

  // Current readings
  let currentAccelerometer: AccelerometerReading | null = null;
  let currentLocation: LocationData | null = null;
  let currentSpeed = 0; // km/h

  // Session stats
  let eventsCount = 0;
  let confirmedPotholes = 0;
  let falsePositives = 0;
  let sessionDuration = '00:00:00';
  let totalDistance = 0; // km

  // UI state
  let lastLocation: LocationData | null = null;
  let sessionStartTime = 0;
  let sessionTimer: number;

  onMount(async () => {
    sensorManager = new SensorManager();

    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered');
      } catch (error) {
        console.error('Service Worker registration failed:', error);
      }
    }
  });

  onDestroy(() => {
    if (sessionStatus === 'active') {
      stopSession();
    }
    if (sessionTimer) {
      clearInterval(sessionTimer);
    }
  });

  async function requestPermissions() {
    permissionsGranted = await sensorManager.requestPermissions();

    // Update permission details for better user feedback
    permissionDetails = {
      accelerometer: sensorManager.accelerometerPermission,
      location: sensorManager.locationPermission
    };

    if (!permissionsGranted) {
      alert('Motion sensor access is required for pothole detection. Please grant permissions first.');
    }
  }

  function startSession() {
    if (!permissionDetails.accelerometer && !permissionsGranted) {
      alert('Motion sensor access is required for pothole detection. Please grant permissions first.');
      return;
    }

    sessionStatus = 'active';
    sessionStartTime = Date.now();

    currentSession = {
      id: generateEventId(),
      startTime: sessionStartTime,
      endTime: null,
      events: [],
      totalDistance: 0,
      averageSpeed: 0
    };

    eventsCount = 0;
    confirmedPotholes = 0;
    falsePositives = 0;
    totalDistance = 0;

    // Start session timer
    sessionTimer = setInterval(updateSessionTimer, 1000);

    // Start sensors
    sensorManager.startAccelerometer(handleAccelerometerData);
    sensorManager.startLocationTracking(handleLocationData);
  }

  function stopSession() {
    if (!currentSession) return;

    sessionStatus = 'idle';
    currentSession.endTime = Date.now();

    // Calculate session stats
    const duration = (currentSession.endTime - currentSession.startTime) / 1000 / 60; // minutes
    currentSession.averageSpeed = duration > 0 ? (totalDistance / duration) * 60 : 0; // km/h
    currentSession.totalDistance = totalDistance;

    // Stop sensors
    sensorManager.stopAllSensors();

    // Clear timer
    if (sessionTimer) {
      clearInterval(sessionTimer);
    }

    // Auto-download session data
    exportSessionData(currentSession);

    // Reset session
    currentSession = null;
    currentAccelerometer = null;
    currentLocation = null;
    currentSpeed = 0;
    sessionDuration = '00:00:00';
  }

  function handleAccelerometerData(reading: AccelerometerReading) {
    currentAccelerometer = reading;

    if (detectPothole(reading) && currentLocation && currentSession) {
      const event: PotholeEvent = {
        id: generateEventId(),
        timestamp: reading.timestamp,
        accelerometer: reading,
        location: currentLocation,
        speed: currentLocation.speed,
        label: 'pothole_detected',
        userConfirmed: null, // Not yet confirmed
        severity: calculateSeverity(reading)
      };

      currentSession.events.push(event);
      eventsCount = currentSession.events.length;

      // Provide haptic feedback if available
      if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
    }
  }

  function handleLocationData(location: LocationData) {
    currentLocation = location;

    // Update speed (convert from m/s to km/h)
    if (location.speed !== null) {
      currentSpeed = Math.round(location.speed * 3.6);
    }

    // Calculate distance if we have a previous location
    if (lastLocation && currentSession) {
      const distance = calculateDistance(
        lastLocation.latitude,
        lastLocation.longitude,
        location.latitude,
        location.longitude
      );
      totalDistance += distance / 1000; // Convert to km
      currentSession.totalDistance = totalDistance;
    }

    lastLocation = location;
  }

  function confirmPothole(eventId: string) {
    if (!currentSession) return;

    const event = currentSession.events.find(e => e.id === eventId);
    if (event) {
      event.userConfirmed = true;
      event.label = 'pothole_confirmed';
      confirmedPotholes++;
      // Trigger reactivity
      currentSession.events = [...currentSession.events];
    }
  }

  function markFalsePositive(eventId: string) {
    if (!currentSession) return;

    const event = currentSession.events.find(e => e.id === eventId);
    if (event) {
      event.userConfirmed = false;
      event.label = 'false_positive';
      falsePositives++;
      // Trigger reactivity
      currentSession.events = [...currentSession.events];
    }
  }

  function updateSessionTimer() {
    if (sessionStartTime > 0) {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;

      sessionDuration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  function formatAcceleration(value: number): string {
    return value.toFixed(2);
  }

  function formatCoordinate(value: number): string {
    return value.toFixed(6);
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'high': return 'from-red-500 to-red-600';
      case 'medium': return 'from-orange-500 to-orange-600';
      case 'low': return 'from-yellow-500 to-yellow-600';
      default: return 'from-gray-500 to-gray-600';
    }
  }

  function getEventStatusColor(event: PotholeEvent): string {
    if (event.userConfirmed === true) return 'border-green-500 bg-green-900 bg-opacity-30';
    if (event.userConfirmed === false) return 'border-red-500 bg-red-900 bg-opacity-30';
    return 'border-yellow-500 bg-yellow-900 bg-opacity-20';
  }
</script>
<div class="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900 p-2 md:p-4 flex items-start md:items-center justify-center md:py-8">
  <div class="w-full max-w-md bg-gray-800 backdrop-blur-sm bg-opacity-90 rounded-2xl shadow-2xl overflow-hidden border border-gray-700 md:max-h-[90vh] md:overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
    <!-- Header -->
    <div class="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
      <div class="flex items-center justify-center mb-2">
        <div class="w-8 h-8 bg-white rounded-full flex items-center justify-center mr-3">
          <svg class="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <h1 class="text-2xl font-bold">Pothole Detector</h1>
      </div>
      <div class="text-center">
        <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white bg-opacity-20 backdrop-blur-sm">
          <div class="w-2 h-2 rounded-full mr-2 {sessionStatus === 'active' ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}"></div>
          {sessionStatus === 'active' ? 'Recording' : sessionStatus === 'idle' ? 'Ready' : 'Paused'}
        </span>
      </div>
    </div>

    <!-- Permissions Section -->
    {#if !permissionsGranted}
      <div class="p-6 bg-gradient-to-br from-slate-700 via-gray-700 to-slate-800 border-l-4 border-blue-500">
        <div class="flex items-start">
          <div class="flex-shrink-0">
            <svg class="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-0.257-0.257A6 6 0 1118 8zM2 8a8 8 0 1016 0A8 8 0 002 8zm6-2.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM10 12a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
            </svg>
          </div>
          <div class="ml-3">
            <p class="text-base text-gray-200 leading-relaxed mb-4">
              This app needs access to your device's sensors to detect potholes effectively.
            </p>
            <button
              on:click={requestPermissions}
              class="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:from-blue-600 hover:to-purple-600 transition-all duration-200 transform hover:scale-105 shadow-lg flex items-center"
            >
              <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/>
              </svg>
              Grant Permissions
            </button>
          </div>
        </div>
      </div>
    {:else}
      <!-- Permission Status -->
      <div class="p-6 bg-gradient-to-r from-green-900 via-emerald-900 to-teal-900 border-l-4 border-emerald-500">
        <div class="text-sm">
          <div class="flex items-center mb-3">
            <svg class="w-5 h-5 text-emerald-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
            <span class="text-emerald-200 font-medium">Permissions Status</span>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between p-2 bg-black bg-opacity-20 rounded-lg">
              <span class="flex items-center">
                <div class="w-3 h-3 rounded-full mr-3 {permissionDetails.accelerometer ? 'bg-emerald-400' : 'bg-red-400'}"></div>
                <span class="text-emerald-100">Motion Sensors</span>
              </span>
              <span class="text-xs px-2 py-1 rounded-full {permissionDetails.accelerometer ? 'bg-emerald-600 text-emerald-100' : 'bg-red-600 text-red-100'}">
                {permissionDetails.accelerometer ? 'Active' : 'Denied'}
              </span>
            </div>
            <div class="flex items-center justify-between p-2 bg-black bg-opacity-20 rounded-lg">
              <span class="flex items-center">
                <div class="w-3 h-3 rounded-full mr-3 {permissionDetails.location ? 'bg-emerald-400' : 'bg-yellow-400'}"></div>
                <span class="text-emerald-100">Location</span>
              </span>
              <span class="text-xs px-2 py-1 rounded-full {permissionDetails.location ? 'bg-emerald-600 text-emerald-100' : 'bg-yellow-600 text-yellow-100'}">
                {permissionDetails.location ? 'Active' : 'Limited'}
              </span>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Session Controls -->
    <div class="p-6">
      <div class="space-y-4">
        {#if sessionStatus === 'idle'}
          <button
            on:click={startSession}
            disabled={!permissionDetails.accelerometer}
            class="w-full bg-gradient-to-r from-emerald-500 to-green-500 text-white py-4 px-6 rounded-xl font-semibold text-lg disabled:from-gray-600 disabled:to-gray-700 disabled:text-gray-400 hover:from-emerald-600 hover:to-green-600 transition-all duration-200 transform hover:scale-105 disabled:hover:scale-100 shadow-lg disabled:shadow-none flex items-center justify-center"
          >
            <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
            </svg>
            Start Session
          </button>
          {#if !permissionDetails.accelerometer}
            <div class="text-center p-3 bg-gray-700 rounded-lg">
              <p class="text-sm text-gray-300">Motion sensor access required</p>
            </div>
          {/if}
        {:else}
          <button
            on:click={stopSession}
            class="w-full bg-gradient-to-r from-red-500 to-rose-500 text-white py-4 px-6 rounded-xl font-semibold text-lg hover:from-red-600 hover:to-rose-600 transition-all duration-200 transform hover:scale-105 shadow-lg flex items-center justify-center"
          >
            <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd"/>
            </svg>
            End Session
          </button>
        {/if}
      </div>
    </div>

    <!-- Session Stats -->
    {#if sessionStatus === 'active'}
      <div class="p-6 bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 border-t border-gray-600">
        <h2 class="text-xl font-bold mb-4 text-white flex items-center">
          <svg class="w-6 h-6 mr-2 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
          </svg>
          Live Statistics
        </h2>
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gradient-to-br from-blue-600 to-blue-700 p-4 rounded-xl text-center shadow-lg">
            <div class="text-3xl font-bold text-white mb-1">{sessionDuration}</div>
            <div class="text-blue-200 text-sm font-medium">Duration</div>
          </div>
          <div class="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 rounded-xl text-center shadow-lg">
            <div class="text-3xl font-bold text-white mb-1">{totalDistance.toFixed(2)}</div>
            <div class="text-emerald-200 text-sm font-medium">Distance (km)</div>
          </div>
          <div class="bg-gradient-to-br from-orange-600 to-orange-700 p-4 rounded-xl text-center shadow-lg">
            <div class="text-3xl font-bold text-white mb-1">{eventsCount}</div>
            <div class="text-orange-200 text-sm font-medium">Events Detected</div>
          </div>
          <div class="bg-gradient-to-br from-purple-600 to-purple-700 p-4 rounded-xl text-center shadow-lg">
            <div class="text-3xl font-bold text-white mb-1">{confirmedPotholes}</div>
            <div class="text-purple-200 text-sm font-medium">Confirmed</div>
          </div>
        </div>
      </div>

      <!-- Events Timeline -->
      {#if sessionStatus === 'active' && currentSession}
        <div class="p-6 bg-gradient-to-br from-gray-800 to-gray-900 border-t border-gray-600">
          <h2 class="text-xl font-bold mb-4 text-white flex items-center">
            <svg class="w-6 h-6 mr-2 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
            </svg>
            Event Timeline ({currentSession.events.length})
          </h2>

          <div class="relative min-h-32 max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            <!-- Vertical Timeline Line -->
            <div class="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 via-cyan-400 to-blue-600"></div>

            <!-- Start Session Marker -->
            <div class="relative flex items-start space-x-4 mb-6">
              <div class="flex-shrink-0 relative z-10">
                <div class="w-12 h-12 rounded-full flex items-center justify-center border-4 bg-blue-500 border-blue-400 shadow-lg">
                  <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
                  </svg>
                </div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="bg-blue-600 bg-opacity-40 backdrop-blur-sm rounded-xl p-4 border border-blue-500 shadow-lg">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-white font-semibold text-sm">🚗 Session Started</span>
                    <span class="text-blue-200 text-xs">
                      {new Date(currentSession.startTime).toLocaleTimeString()}
                    </span>
                  </div>
                  <div class="text-blue-200 text-xs">
                    Monitoring for potholes... Drive safely!
                  </div>
                </div>
              </div>
            </div>

            <!-- Events -->
            {#if currentSession.events.length > 0}
              <div class="space-y-4 pb-4">
                {#each [...currentSession.events].reverse() as event, index (event.id)}
                  <div class="relative flex items-start space-x-4">
                    <!-- Timeline Node -->
                    <div class="flex-shrink-0 relative z-10">
                      <div class="w-12 h-12 rounded-full flex items-center justify-center border-4
                        {event.userConfirmed === true ? 'bg-green-500 border-green-400' :
                         event.userConfirmed === false ? 'bg-red-500 border-red-400' :
                         'bg-yellow-500 border-yellow-400'}
                        shadow-lg">
                        {#if event.userConfirmed === true}
                          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                          </svg>
                        {:else if event.userConfirmed === false}
                          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                          </svg>
                        {:else}
                          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
                          </svg>
                        {/if}
                      </div>

                      <!-- Severity Indicator -->
                      <div class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-r {getSeverityColor(event.severity)} border-2 border-gray-800"></div>
                    </div>

                    <!-- Event Content -->
                    <div class="flex-1 min-w-0">
                      <div class="bg-gray-700 bg-opacity-60 backdrop-blur-sm rounded-xl p-4 border border-gray-600 shadow-lg">
                        <!-- Event Header -->
                        <div class="flex items-center justify-between mb-3">
                          <div class="flex items-center space-x-2">
                            <span class="text-white font-semibold capitalize text-sm">Event #{currentSession.events.length - index}</span>
                            <span class="text-xs px-2 py-1 rounded-full bg-gradient-to-r {getSeverityColor(event.severity)} text-white font-medium">
                              {event.severity.toUpperCase()}
                            </span>
                          </div>
                          <span class="text-gray-400 text-xs">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <!-- Event Details -->
                        <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
                          <div class="bg-black bg-opacity-30 rounded-lg p-2">
                            <div class="text-gray-400">Speed</div>
                            <div class="text-white font-mono">
                              {event.speed ? `${Math.round(event.speed * 3.6)} km/h` : 'N/A'}
                            </div>
                          </div>
                          <div class="bg-black bg-opacity-30 rounded-lg p-2">
                            <div class="text-gray-400">Force</div>
                            <div class="text-white font-mono">
                              {Math.sqrt(event.accelerometer.x**2 + event.accelerometer.y**2 + event.accelerometer.z**2).toFixed(1)} m/s²
                            </div>
                          </div>
                        </div>

                        <!-- Confirmation Section -->
                        {#if event.userConfirmed === null}
                          <div class="space-y-2">
                            <div class="text-center text-yellow-300 text-sm font-medium mb-2">
                              🤔 Requires Confirmation
                            </div>
                            <div class="flex space-x-2">
                              <button
                                on:click={() => confirmPothole(event.id)}
                                class="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white py-2 px-3 rounded-lg text-xs font-semibold hover:from-green-600 hover:to-emerald-600 transition-all duration-200 flex items-center justify-center"
                              >
                                <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                                </svg>
                                Pothole
                              </button>
                              <button
                                on:click={() => markFalsePositive(event.id)}
                                class="flex-1 bg-gradient-to-r from-red-500 to-rose-500 text-white py-2 px-3 rounded-lg text-xs font-semibold hover:from-red-600 hover:to-rose-600 transition-all duration-200 flex items-center justify-center"
                              >
                                <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                                </svg>
                                False
                              </button>
                            </div>
                          </div>
                        {:else}
                          <!-- Confirmation Status -->
                          <div class="text-center py-2">
                            {#if event.userConfirmed}
                              <div class="flex items-center justify-center text-green-400 text-sm">
                                <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                                </svg>
                                <span class="font-semibold">✅ Confirmed Pothole</span>
                              </div>
                            {:else}
                              <div class="flex items-center justify-center text-red-400 text-sm">
                                <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                                </svg>
                                <span class="font-semibold">❌ False Positive</span>
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <!-- No Events Yet -->
              <div class="relative flex items-start space-x-4 mt-6">
                <div class="flex-shrink-0 relative z-10">
                  <div class="w-12 h-12 rounded-full flex items-center justify-center border-4 border-dashed border-gray-500 bg-gray-600 bg-opacity-50">
                    <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                    </svg>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="bg-gray-600 bg-opacity-30 backdrop-blur-sm rounded-xl p-4 border border-dashed border-gray-500">
                    <div class="text-center">
                      <div class="text-gray-400 text-sm font-medium mb-1">👁️ Waiting for events...</div>
                      <div class="text-gray-500 text-xs">
                        Drive over bumps or potholes to see detections appear here
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Current Readings -->
      <div class="p-6 bg-gradient-to-br from-gray-800 to-gray-900 border-t border-gray-600">
        <h2 class="text-xl font-bold mb-4 text-white flex items-center">
          <svg class="w-6 h-6 mr-2 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm1 5a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clip-rule="evenodd"/>
            <path d="M2 13.692V16a2 2 0 002 2h12a2 2 0 002-2v-2.308A24.974 24.974 0 0110 15c-2.796 0-5.487-.46-8-1.308z"/>
          </svg>
          Live Sensor Data
        </h2>

        <!-- Speed -->
        <div class="mb-6 p-5 bg-gradient-to-br from-cyan-600 to-blue-600 rounded-xl text-center shadow-lg">
          <div class="text-4xl font-bold text-white mb-2">{currentSpeed}</div>
          <div class="text-cyan-200 text-sm font-medium uppercase tracking-wide">Speed (km/h)</div>
        </div>

        <!-- Accelerometer -->
        {#if currentAccelerometer}
          <div class="mb-6 p-5 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl border border-gray-600 shadow-lg">
            <h3 class="font-bold mb-4 text-white flex items-center">
              <svg class="w-5 h-5 mr-2 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"/>
              </svg>
              Accelerometer (m/s²)
            </h3>
            <div class="grid grid-cols-3 gap-3">
              <div class="bg-gradient-to-br from-red-500 to-red-600 p-3 rounded-lg text-center">
                <div class="font-mono text-lg font-bold text-white">{formatAcceleration(currentAccelerometer.x)}</div>
                <div class="text-red-200 text-xs font-medium">X-Axis</div>
              </div>
              <div class="bg-gradient-to-br from-green-500 to-green-600 p-3 rounded-lg text-center">
                <div class="font-mono text-lg font-bold text-white">{formatAcceleration(currentAccelerometer.y)}</div>
                <div class="text-green-200 text-xs font-medium">Y-Axis</div>
              </div>
              <div class="bg-gradient-to-br from-blue-500 to-blue-600 p-3 rounded-lg text-center">
                <div class="font-mono text-lg font-bold text-white">{formatAcceleration(currentAccelerometer.z)}</div>
                <div class="text-blue-200 text-xs font-medium">Z-Axis</div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Location -->
        {#if currentLocation}
          <div class="mb-6 p-5 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl border border-gray-600 shadow-lg">
            <h3 class="font-bold mb-4 text-white flex items-center">
              <svg class="w-5 h-5 mr-2 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
              </svg>
              GPS Location
            </h3>
            <div class="space-y-2">
              <div class="flex justify-between p-2 bg-black bg-opacity-20 rounded-lg">
                <span class="text-gray-300 text-sm">Latitude:</span>
                <span class="font-mono text-white text-sm">{formatCoordinate(currentLocation.latitude)}</span>
              </div>
              <div class="flex justify-between p-2 bg-black bg-opacity-20 rounded-lg">
                <span class="text-gray-300 text-sm">Longitude:</span>
                <span class="font-mono text-white text-sm">{formatCoordinate(currentLocation.longitude)}</span>
              </div>
              <div class="flex justify-between p-2 bg-black bg-opacity-20 rounded-lg">
                <span class="text-gray-300 text-sm">Accuracy:</span>
                <span class="font-mono text-white text-sm">{currentLocation.accuracy.toFixed(0)}m</span>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Instructions -->
    <div class="p-6 bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 border-t border-gray-600">
      <h2 class="text-xl font-bold mb-4 text-white flex items-center">
        <svg class="w-6 h-6 mr-2 text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
        </svg>
        How to Use
      </h2>
      <div class="space-y-3">
        <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
          <div class="flex-shrink-0 w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center mr-3 mt-0.5">
            <span class="text-white text-sm font-bold">1</span>
          </div>
          <div>
            <p class="text-white font-medium">Grant Permissions</p>
            <p class="text-gray-300 text-sm">Allow access to motion sensors and location</p>
          </div>
        </div>
        <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
          <div class="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center mr-3 mt-0.5">
            <span class="text-white text-sm font-bold">2</span>
          </div>
          <div>
            <p class="text-white font-medium">Start Session</p>
            <p class="text-gray-300 text-sm">Tap the start button before you begin driving</p>
          </div>
        </div>
        <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
          <div class="flex-shrink-0 w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center mr-3 mt-0.5">
            <span class="text-white text-sm font-bold">3</span>
          </div>
          <div>
            <p class="text-white font-medium">Confirm Events</p>
            <p class="text-gray-300 text-sm">Use the buttons to confirm real potholes or mark false positives</p>
          </div>
        </div>
        <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
          <div class="flex-shrink-0 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center mr-3 mt-0.5">
            <span class="text-white text-sm font-bold">4</span>
          </div>
          <div>
            <p class="text-white font-medium">End & Download</p>
            <p class="text-gray-300 text-sm">Stop the session to automatically download your data</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>