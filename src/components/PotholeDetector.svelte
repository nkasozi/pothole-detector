<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type {
    AccelerometerReading,
    LocationData,
    PotholeEvent,
    DrivingSession,
    SessionStatus,
  } from "../lib/types";
  import {
    SensorManager,
    detectPothole,
    calculateSeverity,
    generateEventId,
    exportSessionData,
    calculateDistance,
  } from "../lib/utils/sensors";

  // Session state
  let sessionStatus: SessionStatus = "idle";
  let currentSession: DrivingSession | null = null;
  let sensorManager: SensorManager;
  let permissionsGranted = false;
  let permissionDetails = {
    accelerometer: false,
    location: false,
  };

  // Current readings
  let currentAccelerometer: AccelerometerReading | null = null;
  let currentLocation: LocationData | null = null;
  let currentSpeed = 0; // km/h

  // Session stats
  let eventsCount = 0;
  let confirmedPotholes = 0;
  let falsePositives = 0;
  let sessionDuration = "00:00:00";
  let totalDistance = 0; // km

  // UI state
  let lastLocation: LocationData | null = null;
  let sessionStartTime = 0;
  let sessionTimer: number;

  // Google Maps Navigation
  let routePlanned = false;
  let mapInitialized = false;
  let startAddress = "";
  let startCoords: { lat: number; lng: number } | null = null;
  let startSuggestions: google.maps.places.AutocompletePrediction[] = [];
  let showStartSuggestions = false;
  let destinationAddress = "";
  let destinationCoords: { lat: number; lng: number } | null = null;
  let destinationSuggestions: google.maps.places.AutocompletePrediction[] = [];
  let showDestinationSuggestions = false;
  let autocompleteService: google.maps.places.AutocompleteService | null = null;
  let placesService: google.maps.places.PlacesService | null = null;
  let searchInput: HTMLInputElement;

  // Full Google Maps SDK variables
  let map: google.maps.Map | null = null;
  let directionsService: google.maps.DirectionsService | null = null;
  let directionsRenderer: google.maps.DirectionsRenderer | null = null;
  let mapContainer: HTMLElement;
  let currentLocationMarker: google.maps.Marker | null = null;
  let potholeMarkers: google.maps.Marker[] = [];
  let navigationStarted = false;

  const GOOGLE_API_KEY = "AIzaSyDQLELMbxd-S1RIWw_zCWt6TD_QaqpdsM4";

  // Reactive statements for map management
  $: if (map && currentLocation) {
    updateCurrentLocationMarker();
  }

  // Initialize map when container is available
  $: if (mapContainer && !map && typeof google !== "undefined") {
    initializeMap();
  }

  // Automatically trigger route planning when both coordinates are available
  $: if (startCoords && destinationCoords && map && !routePlanned) {
    planRoute();
  }

  // Reactive statements to ensure UI updates
  $: if (currentSession) {
    eventsCount = currentSession.events.length;
    confirmedPotholes = currentSession.events.filter(
      (e) => e.userConfirmed === true
    ).length;
    falsePositives = currentSession.events.filter(
      (e) => e.userConfirmed === false
    ).length;
  }

  // Check if location is available for route planning
  $: routePlanned = currentLocation !== null && destinationCoords !== null;

  // Initialize Google Places API and Maps SDK
  function initializeGoogleMaps() {
    // Only run in browser
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    // Load the Google Maps JavaScript API
    if (typeof google === "undefined") {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places&callback=initMapsCallback`;
      script.async = true;
      script.defer = true;

      // Set up global callback
      (window as any).initMapsCallback = () => {
        autocompleteService = new google.maps.places.AutocompleteService();
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
          draggable: true,
          panel: null,
        });
        console.log("Google Maps API initialized");
        initializeMap();
      };

      document.head.appendChild(script);
    } else if (google.maps?.places) {
      autocompleteService = new google.maps.places.AutocompleteService();
      directionsService = new google.maps.DirectionsService();
      directionsRenderer = new google.maps.DirectionsRenderer({
        draggable: true,
        panel: null,
      });
      console.log("Google Maps API already loaded");
      initializeMap();
    }
  }

  // Initialize the interactive map
  function initializeMap() {
    if (!mapContainer || map) return;

    // Default center (will be updated when location is available)
    const center = currentLocation
      ? { lat: currentLocation.latitude, lng: currentLocation.longitude }
      : { lat: 40.7128, lng: -74.006 }; // NYC default

    map = new google.maps.Map(mapContainer, {
      zoom: 15,
      center: center,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      zoomControl: true,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }],
        },
      ],
    });

    if (directionsRenderer) {
      directionsRenderer.setMap(map);
    }

    mapInitialized = true;
    console.log("Interactive map initialized");
  }

  // Search for places using Google Places API
  async function searchPlaces(query: string, isDestination: boolean = true) {
    if (!autocompleteService || !query || query.length < 3) {
      if (isDestination) {
        destinationSuggestions = [];
        showDestinationSuggestions = false;
      } else {
        startSuggestions = [];
        showStartSuggestions = false;
      }
      return;
    }

    try {
      const request: google.maps.places.AutocompletionRequest = {
        input: query,
        types: ["geocode", "establishment"],
        // No country restrictions - search worldwide
      };

      autocompleteService.getPlacePredictions(
        request,
        (predictions, status) => {
          if (
            status === google.maps.places.PlacesServiceStatus.OK &&
            predictions
          ) {
            if (isDestination) {
              destinationSuggestions = predictions;
              showDestinationSuggestions = true;
            } else {
              startSuggestions = predictions;
              showStartSuggestions = true;
            }
          } else {
            if (isDestination) {
              destinationSuggestions = [];
              showDestinationSuggestions = false;
            } else {
              startSuggestions = [];
              showStartSuggestions = false;
            }
          }
        }
      );
    } catch (error) {
      console.error("Places API error:", error);
      if (isDestination) {
        destinationSuggestions = [];
        showDestinationSuggestions = false;
      } else {
        startSuggestions = [];
        showStartSuggestions = false;
      }
    }
  }

  // Get place details from place ID
  async function getPlaceDetails(
    placeId: string
  ): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      // Only run in browser
      if (typeof window === "undefined" || typeof document === "undefined") {
        resolve(null);
        return;
      }

      if (!google?.maps?.places) {
        resolve(null);
        return;
      }

      // Create a temporary map element for PlacesService
      const mapDiv = document.createElement("div");
      const map = new google.maps.Map(mapDiv, {
        center: { lat: 0, lng: 0 },
        zoom: 1,
      });
      const service = new google.maps.places.PlacesService(map);

      const request: google.maps.places.PlaceDetailsRequest = {
        placeId: placeId,
        fields: ["geometry"],
      };

      service.getDetails(request, (place, status) => {
        if (
          status === google.maps.places.PlacesServiceStatus.OK &&
          place?.geometry?.location
        ) {
          const location = place.geometry.location;
          resolve({
            lat: location.lat(),
            lng: location.lng(),
          });
        } else {
          console.error("Place details error:", status);
          resolve(null);
        }
      });
    });
  }

  // Handle destination search input
  function handleDestinationInput() {
    searchPlaces(destinationAddress, true);
  }

  // Handle start location search input
  function handleStartInput() {
    searchPlaces(startAddress, false);
  }

  // Select a destination from suggestions
  async function selectDestination(
    prediction: google.maps.places.AutocompletePrediction
  ) {
    destinationAddress = prediction.description;
    showDestinationSuggestions = false;
    routePlanned = false; // Reset route planning state

    try {
      destinationCoords = await getPlaceDetails(prediction.place_id);
      console.log(
        "Destination selected:",
        destinationAddress,
        destinationCoords
      );
    } catch (error) {
      console.error("Error getting place details:", error);
      destinationCoords = null;
    }
  }

  // Select a start location from suggestions
  async function selectStartLocation(
    prediction: google.maps.places.AutocompletePrediction
  ) {
    startAddress = prediction.description;
    showStartSuggestions = false;
    routePlanned = false; // Reset route planning state

    try {
      startCoords = await getPlaceDetails(prediction.place_id);
      console.log("Start location selected:", startAddress, startCoords);
    } catch (error) {
      console.error("Error getting place details:", error);
      startCoords = null;
    }
  }

  // Clear destination
  function clearDestination() {
    destinationAddress = "";
    destinationCoords = null;
    destinationSuggestions = [];
    showDestinationSuggestions = false;
    routePlanned = false;
  }

  // Clear start location
  function clearStartLocation() {
    startAddress = "";
    startCoords = null;
    startSuggestions = [];
    showStartSuggestions = false;
    routePlanned = false;
  }

  // Plan route between start and destination using full Google Maps SDK
  async function planRoute() {
    if (
      !startCoords ||
      !destinationCoords ||
      !directionsService ||
      !directionsRenderer ||
      !map
    ) {
      console.log("Missing requirements for route planning");
      return;
    }

    try {
      const request: google.maps.DirectionsRequest = {
        origin: startCoords,
        destination: destinationCoords,
        travelMode: google.maps.TravelMode.DRIVING,
        avoidTolls: true,
        optimizeWaypoints: true,
      };

      const result = await new Promise<google.maps.DirectionsResult>(
        (resolve, reject) => {
          directionsService!.route(request, (result, status) => {
            if (status === google.maps.DirectionsStatus.OK && result) {
              resolve(result);
            } else {
              reject(new Error(`Directions request failed: ${status}`));
            }
          });
        }
      );

      directionsRenderer.setDirections(result);
      routePlanned = true;

      console.log("Route planned successfully with Google Maps SDK");
      console.log("Distance:", result.routes[0].legs[0].distance?.text);
      console.log("Duration:", result.routes[0].legs[0].duration?.text);

      // Start navigation if both locations are set
      if (navigationStarted) {
        startTurnByTurnNavigation();
      }
    } catch (error) {
      console.error("Error planning route:", error);
      alert("Failed to plan route. Please check your locations and try again.");
    }
  }

  // Start turn-by-turn navigation
  function startTurnByTurnNavigation() {
    if (!map || !directionsRenderer) return;

    navigationStarted = true;

    // Enable turn-by-turn guidance panel
    const directionsPanel = document.getElementById("directions-panel");
    if (directionsPanel) {
      directionsRenderer.setPanel(directionsPanel);
    }

    // Set up navigation-optimized map options
    map.setOptions({
      zoom: 18,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    console.log("Turn-by-turn navigation started");
  }

  // Update current location marker on the map
  function updateCurrentLocationMarker() {
    if (!map || !currentLocation) return;

    // Remove existing marker
    if (currentLocationMarker) {
      currentLocationMarker.setMap(null);
    }

    // Create new marker for current location
    currentLocationMarker = new google.maps.Marker({
      position: {
        lat: currentLocation.latitude,
        lng: currentLocation.longitude,
      },
      map: map,
      title: "Your Location",
      icon: {
        url:
          "data:image/svg+xml;charset=UTF-8," +
          encodeURIComponent(`
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="8" fill="#4285F4" stroke="#ffffff" stroke-width="2"/>
            <circle cx="12" cy="12" r="3" fill="#ffffff"/>
          </svg>
        `),
        scaledSize: new google.maps.Size(24, 24),
        anchor: new google.maps.Point(12, 12),
      },
    });

    // Center map on current location during navigation
    if (navigationStarted) {
      map.setCenter({
        lat: currentLocation.latitude,
        lng: currentLocation.longitude,
      });
    }
  }

  // Add pothole marker to the map
  function addPotholeMarker(event: PotholeEvent) {
    if (!map || !event.location) return;

    const marker = new google.maps.Marker({
      position: { lat: event.location.latitude, lng: event.location.longitude },
      map: map,
      title: `Pothole (${event.severity})`,
      icon: {
        url:
          "data:image/svg+xml;charset=UTF-8," +
          encodeURIComponent(`
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="8" fill="#FF4444" stroke="#ffffff" stroke-width="2"/>
            <text x="10" y="14" text-anchor="middle" fill="white" font-size="12" font-weight="bold">!</text>
          </svg>
        `),
        scaledSize: new google.maps.Size(20, 20),
        anchor: new google.maps.Point(10, 10),
      },
    });

    // Add info window
    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div>
          <h3>Pothole Detected</h3>
          <p>Severity: ${event.severity}</p>
          <p>Speed: ${event.speed ? Math.round(event.speed * 3.6) : "Unknown"} km/h</p>
          <p>Time: ${new Date(event.timestamp).toLocaleTimeString()}</p>
        </div>
      `,
    });

    marker.addListener("click", () => {
      infoWindow.open(map, marker);
    });

    potholeMarkers.push(marker);
  }

  // Get user's current location and prefill start address
  async function getCurrentLocationForStart() {
    // First ensure we have location permissions
    if (!permissionDetails.location) {
      await enableLocation();
      return; // enableLocation will start location tracking
    }

    if (navigator.geolocation) {
      try {
        const position = await new Promise<GeolocationPosition>(
          (resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 300000,
            });
          }
        );

        const { latitude, longitude } = position.coords;
        startCoords = { lat: latitude, lng: longitude };

        // Reverse geocode to get address
        if (typeof window !== "undefined" && window.google) {
          const geocoder = new google.maps.Geocoder();
          const response = await new Promise<google.maps.GeocoderResponse>(
            (resolve, reject) => {
              geocoder.geocode(
                { location: { lat: latitude, lng: longitude } },
                (results, status) => {
                  if (status === "OK" && results) {
                    resolve({ results });
                  } else {
                    reject(new Error("Geocoding failed"));
                  }
                }
              );
            }
          );

          if (response.results && response.results[0]) {
            startAddress = response.results[0].formatted_address;
          }
        }

        console.log(
          "Current location set as start:",
          startAddress,
          startCoords
        );
      } catch (error) {
        console.error("Error getting current location:", error);
        // If getCurrentPosition fails, try enabling location services
        await enableLocation();
      }
    }
  }

  // Handle click outside to close suggestions
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      !target.closest(".destination-input-container") &&
      !target.closest(".start-input-container")
    ) {
      showDestinationSuggestions = false;
      showStartSuggestions = false;
    }
  }

  onMount(async () => {
    sensorManager = new SensorManager();

    // Only run browser-specific code in the browser
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      // Register service worker
      if ("serviceWorker" in navigator) {
        try {
          await navigator.serviceWorker.register("/sw.js");
          console.log("Service Worker registered");
        } catch (error) {
          console.error("Service Worker registration failed:", error);
        }
      }

      // Initialize Google Maps API
      initializeGoogleMaps();

      // Add click outside handler
      document.addEventListener("click", handleClickOutside);

      // Try to enable location services and get current location automatically
      try {
        await enableLocation();
      } catch (error) {
        console.log("Auto-enable location failed, user can enable manually");
      }
    }
  });

  onDestroy(() => {
    if (sessionStatus === "active") {
      stopSession();
    }
    if (sessionTimer) {
      clearInterval(sessionTimer);
    }
    // Remove click outside handler (only in browser)
    if (typeof document !== "undefined") {
      document.removeEventListener("click", handleClickOutside);
    }
  });

  async function requestPermissions() {
    permissionsGranted = await sensorManager.requestPermissions();

    // Update permission details for better user feedback
    permissionDetails = {
      accelerometer: sensorManager.accelerometerPermission,
      location: sensorManager.locationPermission,
    };

    if (!permissionsGranted) {
      alert(
        "Motion sensor access is required for pothole detection. Please grant permissions first."
      );
    }
  }

  // Unified function to enable location (combines permissions + location tracking)
  async function enableLocation() {
    try {
      // First request permissions
      permissionsGranted = await sensorManager.requestPermissions();

      // Update permission details
      permissionDetails = {
        accelerometer: sensorManager.accelerometerPermission,
        location: sensorManager.locationPermission,
      };

      // If location permission was granted, start location tracking to get current location
      if (permissionDetails.location) {
        // Start location tracking temporarily to get current location
        sensorManager.startLocationTracking(handleLocationData);
        console.log("Location tracking started");
      } else {
        alert(
          "Location access is required for navigation features. Please grant location permissions."
        );
      }

      if (!permissionDetails.accelerometer) {
        alert(
          "Motion sensor access is required for pothole detection. Please grant motion sensor permissions."
        );
      }
    } catch (error) {
      console.error("Error enabling location:", error);
      alert(
        "Failed to enable location services. Please check your browser settings."
      );
    }
  }

  function startSession() {
    if (!permissionDetails.accelerometer) {
      alert(
        "Motion sensor access is required for pothole detection. Please enable sensors first."
      );
      return;
    }

    if (!permissionDetails.location) {
      alert(
        "Location access is required for navigation. Please enable location services first."
      );
      return;
    }

    if (!startCoords || !destinationCoords) {
      alert(
        "Please select both start location and destination before starting your session."
      );
      return;
    }

    sessionStatus = "active";
    sessionStartTime = Date.now();

    currentSession = {
      id: generateEventId(),
      startTime: sessionStartTime,
      endTime: null,
      events: [],
      totalDistance: 0,
      averageSpeed: 0,
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

    // Start turn-by-turn navigation
    startTurnByTurnNavigation();
  }

  function stopSession() {
    if (!currentSession) return;

    sessionStatus = "idle";
    currentSession.endTime = Date.now();

    // Calculate session stats
    const duration =
      (currentSession.endTime - currentSession.startTime) / 1000 / 60; // minutes
    currentSession.averageSpeed =
      duration > 0 ? (totalDistance / duration) * 60 : 0; // km/h
    currentSession.totalDistance = totalDistance;

    // Stop sensors
    sensorManager.stopAllSensors();

    // Stop navigation
    navigationStarted = false;

    // Reset map view to normal
    if (map) {
      map.setOptions({
        zoom: 15,
        zoomControl: true,
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: true,
      });

      // Clear directions panel
      if (directionsRenderer) {
        directionsRenderer.setPanel(null);
      }
    }

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
    sessionDuration = "00:00:00";
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
        label: "pothole_detected",
        userConfirmed: null, // Not yet confirmed
        severity: calculateSeverity(reading),
      };

      currentSession.events.push(event);
      eventsCount = currentSession.events.length;

      // Force reactivity by creating a new reference
      currentSession = {
        ...currentSession,
        events: [...currentSession.events],
      };

      // Add pothole marker to the map
      addPotholeMarker(event);

      console.log(
        "Pothole detected! Total events:",
        eventsCount,
        "Session events:",
        currentSession.events.length
      );

      // Provide haptic feedback if available
      if ("vibrate" in navigator) {
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

    const event = currentSession.events.find((e) => e.id === eventId);
    if (event) {
      event.userConfirmed = true;
      event.label = "pothole_confirmed";
      confirmedPotholes++;
      // Trigger reactivity
      currentSession.events = [...currentSession.events];
    }
  }

  function markFalsePositive(eventId: string) {
    if (!currentSession) return;

    const event = currentSession.events.find((e) => e.id === eventId);
    if (event) {
      event.userConfirmed = false;
      event.label = "false_positive";
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

      sessionDuration = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
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
      case "high":
        return "from-red-500 to-red-600";
      case "medium":
        return "from-orange-500 to-orange-600";
      case "low":
        return "from-yellow-500 to-yellow-600";
      default:
        return "from-gray-500 to-gray-600";
    }
  }

  function getEventStatusColor(event: PotholeEvent): string {
    if (event.userConfirmed === true)
      return "border-green-500 bg-green-900 bg-opacity-30";
    if (event.userConfirmed === false)
      return "border-red-500 bg-red-900 bg-opacity-30";
    return "border-yellow-500 bg-yellow-900 bg-opacity-20";
  }
</script>

<div
  class="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900 p-2 md:p-4 flex items-start justify-center py-4"
>
  <div
    class="w-full max-w-md lg:max-w-4xl bg-gray-800 backdrop-blur-sm bg-opacity-90 rounded-2xl shadow-2xl border border-gray-700"
  >
    <!-- Header -->
    <div class="bg-blue-500 text-white p-6">
      <div class="flex items-center justify-center mb-2">
        <div
          class="w-8 h-8 bg-white rounded-full flex items-center justify-center mr-3"
        >
          <svg
            class="w-5 h-5 text-blue-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold">Pothole Detector</h1>
      </div>
      <div class="text-center">
        <span
          class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white bg-opacity-20 backdrop-blur-sm"
        >
          <div
            class="w-2 h-2 rounded-full mr-2 {sessionStatus === 'active'
              ? 'bg-green-400 animate-pulse'
              : 'bg-gray-400'}"
          ></div>
          {sessionStatus === "active"
            ? "Recording"
            : sessionStatus === "idle"
              ? "Ready"
              : "Paused"}
        </span>
      </div>
    </div>

    <!-- Permissions Section - Only show if no permissions at all -->
    {#if permissionDetails.accelerometer && permissionDetails.location}
      <div
        class="p-6 bg-gradient-to-r from-green-900 via-emerald-900 to-teal-900 border-l-4 border-emerald-500"
      >
        <div class="text-sm">
          <div class="flex items-center mb-3">
            <svg
              class="w-5 h-5 text-emerald-400 mr-2"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
            <span class="text-emerald-200 font-medium">Permissions Status</span>
          </div>
          <div class="space-y-2">
            <div
              class="flex items-center justify-between p-2 bg-black bg-opacity-20 rounded-lg"
            >
              <span class="flex items-center">
                <div
                  class="w-3 h-3 rounded-full mr-3 {permissionDetails.accelerometer
                    ? 'bg-emerald-400'
                    : 'bg-red-400'}"
                ></div>
                <span class="text-emerald-100">Motion Sensors</span>
              </span>
              <span
                class="text-xs px-2 py-1 rounded-full {permissionDetails.accelerometer
                  ? 'bg-emerald-600 text-emerald-100'
                  : 'bg-red-600 text-red-100'}"
              >
                {permissionDetails.accelerometer ? "Active" : "Denied"}
              </span>
            </div>
            <div
              class="flex items-center justify-between p-2 bg-black bg-opacity-20 rounded-lg"
            >
              <span class="flex items-center">
                <div
                  class="w-3 h-3 rounded-full mr-3 {permissionDetails.location
                    ? 'bg-emerald-400'
                    : 'bg-yellow-400'}"
                ></div>
                <span class="text-emerald-100">Location</span>
              </span>
              <span
                class="text-xs px-2 py-1 rounded-full {permissionDetails.location
                  ? 'bg-emerald-600 text-emerald-100'
                  : 'bg-yellow-600 text-yellow-100'}"
              >
                {permissionDetails.location ? "Active" : "Limited"}
              </span>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Navigation & Maps with Google Places API -->
    <div
      class="p-6 bg-gradient-to-br from-gray-800 to-gray-900 border-4 border-blue-500"
    >
      <h2 class="text-xl font-bold mb-6 text-white flex items-center">
        <svg
          class="w-6 h-6 mr-2 text-blue-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fill-rule="evenodd"
            d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
            clip-rule="evenodd"
          />
        </svg>
        Navigation & Route Planning
      </h2>

      <div
        class="bg-gray-700 bg-opacity-60 backdrop-blur-sm rounded-xl p-4 border border-gray-600 shadow-lg space-y-4 mb-4"
      >
        <!-- Current Location Status -->
        {#if currentLocation}
          <div
            class="p-3 bg-green-900 bg-opacity-30 rounded-lg border border-green-600"
          >
            <div class="flex items-center text-green-400 mb-2">
              <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
              <span class="font-semibold text-sm">Starting Location Ready</span>
            </div>
            <div class="text-green-200 text-xs">
              📍 Current: {currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(
                4
              )}
            </div>
          </div>
        {:else}
          <div
            class="p-3 bg-yellow-900 bg-opacity-30 rounded-lg border border-yellow-600"
          >
            <div class="flex items-center text-yellow-400 mb-2">
              <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
              <span class="font-semibold text-sm">Location Access Required</span
              >
            </div>
            <div class="text-yellow-200 text-xs mb-3">
              Enable location services to use navigation features
            </div>
            <button
              type="button"
              on:click={enableLocation}
              class="bg-yellow-600 hover:bg-yellow-700 text-white py-2 px-3 rounded-lg text-xs transition-colors duration-200"
            >
              Enable Location
            </button>
          </div>
        {/if}

        <!-- Navigation Planning Section -->
        <div class="space-y-6">
          <!-- Start Location Search -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium text-gray-300"
                >Start Location</label
              >
              {#if !startCoords}
                <button
                  type="button"
                  on:click={getCurrentLocationForStart}
                  class="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  Use Current Location
                </button>
              {/if}
            </div>

            <!-- Start Location Input with Autocomplete -->
            <div class="relative start-input-container">
              <input
                type="text"
                bind:value={startAddress}
                on:input={handleStartInput}
                on:focus={() =>
                  (showStartSuggestions = startSuggestions.length > 0)}
                placeholder={startCoords
                  ? "Current location set"
                  : "Search for start location..."}
                class="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-green-500 focus:border-transparent pr-10"
              />

              <!-- Clear button -->
              {#if startAddress}
                <button
                  type="button"
                  on:click={clearStartLocation}
                  class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fill-rule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              {/if}

              <!-- Start Location Autocomplete Suggestions -->
              {#if showStartSuggestions && startSuggestions.length > 0}
                <div
                  class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                >
                  {#each startSuggestions as prediction (prediction.place_id)}
                    <button
                      type="button"
                      class="w-full text-left p-3 hover:bg-gray-700 text-white text-sm border-b border-gray-700 last:border-b-0 transition-colors duration-150"
                      on:click={() => selectStartLocation(prediction)}
                    >
                      <div class="flex items-start">
                        <svg
                          class="w-4 h-4 mr-2 mt-0.5 text-green-400 flex-shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                            clip-rule="evenodd"
                          />
                        </svg>
                        <div class="flex-1">
                          <div class="font-medium text-white">
                            {prediction.structured_formatting?.main_text ||
                              prediction.description}
                          </div>
                          {#if prediction.structured_formatting?.secondary_text}
                            <div class="text-gray-400 text-xs mt-1">
                              {prediction.structured_formatting.secondary_text}
                            </div>
                          {/if}
                        </div>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Start Location Status -->
            {#if startCoords}
              <div
                class="p-3 bg-green-900 bg-opacity-30 rounded-lg border border-green-600"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center text-green-400">
                    <svg
                      class="w-4 h-4 mr-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    <span class="text-sm font-medium">Start Location Set</span>
                  </div>
                  <button
                    type="button"
                    on:click={clearStartLocation}
                    class="text-green-400 hover:text-green-300"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
                <div class="text-sm text-green-300 mt-1 truncate">
                  {startAddress}
                </div>
              </div>
            {/if}
          </div>

          <!-- Destination Search with Google Places API -->
          <div class="space-y-3">
            <label class="block text-sm font-medium text-gray-300"
              >Select Destination</label
            >

            <!-- Search Input with Autocomplete -->
            <div class="relative destination-input-container">
              <input
                bind:this={searchInput}
                type="text"
                bind:value={destinationAddress}
                on:input={handleDestinationInput}
                on:focus={() =>
                  (showDestinationSuggestions =
                    destinationSuggestions.length > 0)}
                placeholder="Search for destination address..."
                class="w-full p-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
              />

              <!-- Clear button -->
              {#if destinationAddress}
                <button
                  type="button"
                  on:click={clearDestination}
                  class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fill-rule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              {/if}

              <!-- Google Places Autocomplete Suggestions -->
              {#if showDestinationSuggestions && destinationSuggestions.length > 0}
                <div
                  class="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-60 overflow-y-auto"
                >
                  {#each destinationSuggestions as prediction (prediction.place_id)}
                    <button
                      type="button"
                      class="w-full text-left p-3 hover:bg-gray-700 text-white text-sm border-b border-gray-700 last:border-b-0 transition-colors duration-150"
                      on:click={() => selectDestination(prediction)}
                    >
                      <div class="flex items-start">
                        <svg
                          class="w-4 h-4 mr-2 mt-0.5 text-blue-400 flex-shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                            clip-rule="evenodd"
                          />
                        </svg>
                        <div class="flex-1">
                          <div class="font-medium text-white">
                            {prediction.structured_formatting?.main_text ||
                              prediction.description}
                          </div>
                          {#if prediction.structured_formatting?.secondary_text}
                            <div class="text-gray-400 text-xs mt-1">
                              {prediction.structured_formatting.secondary_text}
                            </div>
                          {/if}
                        </div>
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Destination Status -->
            {#if destinationCoords}
              <div
                class="p-3 bg-blue-900 bg-opacity-30 rounded-lg border border-blue-600"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center text-blue-400">
                    <svg
                      class="w-4 h-4 mr-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    <span class="font-semibold text-sm">Destination Set</span>
                  </div>
                  <button
                    type="button"
                    on:click={clearDestination}
                    class="text-blue-300 hover:text-white text-xs"
                  >
                    Change
                  </button>
                </div>
                <div class="text-blue-200 text-xs mt-1">
                  🎯 {destinationAddress}
                </div>
              </div>
            {/if}

            <!-- Route Planning Status -->
            {#if startCoords && destinationCoords}
              <div
                class="p-3 bg-purple-900 bg-opacity-30 rounded-lg border border-purple-600"
              >
                <div class="flex items-center text-purple-400">
                  <svg
                    class="w-4 h-4 mr-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <span class="text-sm font-medium">Route Ready</span>
                </div>
                <div class="text-purple-300 text-xs mt-1">
                  From: {startAddress}
                </div>
                <div class="text-purple-300 text-xs">
                  To: {destinationAddress}
                </div>
                <div class="text-purple-200 text-xs mt-1 italic">
                  🗺️ Route displayed in map below
                </div>
              </div>
            {:else if startCoords || destinationCoords}
              <div
                class="p-3 bg-yellow-900 bg-opacity-30 rounded-lg border border-yellow-600"
              >
                <div class="flex items-center text-yellow-400">
                  <svg
                    class="w-4 h-4 mr-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <span class="text-sm">
                    {#if !startCoords}
                      Set start location to plan route
                    {:else}
                      Set destination to plan route
                    {/if}
                  </span>
                </div>
              </div>
            {/if}
          </div>
        </div>
        <!-- End Left Column -->

        <!-- Right Column: Interactive Map (3/5 width on large screens) -->
        <div class="lg:col-span-3">
          <!-- Dynamic Interactive Map - Only shows when route is ready -->
          {#if startCoords && destinationCoords}
            <div class="border-t border-gray-600 pt-4">
              <div
                class="mb-2 p-2 bg-green-900 bg-opacity-30 rounded text-xs text-green-400 flex items-center"
              >
                <svg
                  class="w-4 h-4 mr-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clip-rule="evenodd"
                  />
                </svg>
                📍 Interactive Navigation Map
              </div>

              <!-- Interactive Google Map Container -->
              <div
                class="relative w-full h-[32rem] lg:h-[40rem] bg-gray-800 rounded-lg mb-4 border border-gray-600"
              >
                <div
                  bind:this={mapContainer}
                  class="w-full h-full rounded-lg"
                  id="map"
                ></div>

                <!-- Navigation Controls Overlay -->
                {#if map && !navigationStarted}
                  <div class="absolute top-4 left-4 right-4 z-10">
                    <button
                      on:click={startTurnByTurnNavigation}
                      class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-semibold text-sm shadow-lg flex items-center justify-center transition-colors duration-200"
                    >
                      <svg
                        class="w-5 h-5 mr-2"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clip-rule="evenodd"
                        />
                      </svg>
                      Start Turn-by-Turn Navigation
                    </button>
                  </div>
                {/if}

                <!-- Turn-by-Turn Directions Panel -->
                {#if navigationStarted}
                  <div
                    class="absolute top-4 right-4 w-80 max-h-80 bg-white rounded-lg shadow-xl overflow-hidden z-10"
                  >
                    <div class="bg-blue-600 text-white p-3">
                      <h3 class="font-semibold text-sm">
                        Turn-by-Turn Directions
                      </h3>
                    </div>
                    <div
                      id="directions-panel"
                      class="p-2 text-sm max-h-64 overflow-y-auto"
                    ></div>
                  </div>
                {/if}

                <!-- Map Loading Indicator -->
                {#if !mapInitialized}
                  <div
                    class="absolute inset-0 flex items-center justify-center bg-gray-800"
                  >
                    <div class="text-center">
                      <div
                        class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mx-auto mb-2"
                      ></div>
                      <p class="text-gray-400 text-sm">
                        Loading Interactive Map...
                      </p>
                    </div>
                  </div>
                {/if}
              </div>

              <!-- Route Information -->
              <div class="text-center p-3 bg-blue-900 bg-opacity-30 rounded-lg">
                <div
                  class="flex items-center justify-center text-blue-400 mb-2"
                >
                  <svg
                    class="w-5 h-5 mr-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <span class="font-medium">Interactive Navigation Ready</span>
                </div>
                <p class="text-blue-300 text-sm">
                  🗺️ Route from {startAddress} to {destinationAddress}
                </p>
                <p class="text-blue-200 text-xs mt-1">
                  Full Google Maps with turn-by-turn navigation, real-time
                  traffic, and pothole markers
                </p>
              </div>
            </div>
          {:else}
            <!-- Placeholder when no route is set -->
            <div class="border-t border-gray-600 pt-4">
              <div class="text-center p-6 bg-gray-700 bg-opacity-50 rounded-lg">
                <svg
                  class="w-12 h-12 mx-auto text-gray-400 mb-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                    clip-rule="evenodd"
                  />
                </svg>
                <p class="text-gray-300 text-sm mb-2">No route selected</p>
                <p class="text-gray-400 text-xs">
                  Set both start location and destination to view navigation map
                </p>
              </div>
            </div>
          {/if}
        </div>
        <!-- End Right Column -->
      </div>

      <!-- Session Controls -->
      <div class="p-6 border-4 border-blue-500 mb-4">
        <div class="space-y-4">
          {#if sessionStatus === "idle"}
            <button
              on:click={startSession}
              disabled={!permissionDetails.accelerometer ||
                !startCoords ||
                !destinationCoords}
              class="w-full bg-gradient-to-r from-emerald-500 to-green-500 text-white py-4 px-6 rounded-xl font-semibold text-lg disabled:from-gray-600 disabled:to-gray-700 disabled:text-gray-400 hover:from-emerald-600 hover:to-green-600 transition-all duration-200 transform hover:scale-105 disabled:hover:scale-100 shadow-lg disabled:shadow-none flex items-center justify-center"
            >
              <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clip-rule="evenodd"
                />
              </svg>
              Start Session
            </button>
            {#if !permissionDetails.accelerometer}
              <div class="text-center p-3 bg-gray-700 rounded-lg">
                <p class="text-sm text-gray-300">
                  Motion sensor access required
                </p>
              </div>
            {:else if !startCoords || !destinationCoords}
              <div class="text-center p-3 bg-gray-700 rounded-lg">
                <p class="text-sm text-gray-300">
                  {#if !startCoords && !destinationCoords}
                    Set start location and destination to begin
                  {:else if !startCoords}
                    Set start location to begin
                  {:else}
                    Set destination to begin
                  {/if}
                </p>
              </div>
            {/if}
          {:else}
            <button
              on:click={stopSession}
              class="w-full bg-gradient-to-r from-red-500 to-rose-500 text-white py-4 px-6 rounded-xl font-semibold text-lg hover:from-red-600 hover:to-rose-600 transition-all duration-200 transform hover:scale-105 shadow-lg flex items-center justify-center"
            >
              <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                  clip-rule="evenodd"
                />
              </svg>
              End Session
            </button>
          {/if}
        </div>
      </div>

      <!-- Session Stats -->
      {#if sessionStatus === "active"}
        <div
          class="p-6 bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 border-4 border-blue-500"
        >
          <h2 class="text-xl font-bold mb-4 text-white flex items-center">
            <svg
              class="w-6 h-6 mr-2 text-blue-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"
              />
            </svg>
            Live Statistics
          </h2>
          <div class="grid grid-cols-2 gap-4">
            <div
              class="bg-gradient-to-br from-blue-600 to-blue-700 p-4 rounded-xl text-center shadow-lg"
            >
              <div class="text-3xl font-bold text-white mb-1">
                {sessionDuration}
              </div>
              <div class="text-blue-200 text-sm font-medium">Duration</div>
            </div>
            <div
              class="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 rounded-xl text-center shadow-lg"
            >
              <div class="text-3xl font-bold text-white mb-1">
                {totalDistance.toFixed(2)}
              </div>
              <div class="text-emerald-200 text-sm font-medium">
                Distance (km)
              </div>
            </div>
            <div
              class="bg-gradient-to-br from-orange-600 to-orange-700 p-4 rounded-xl text-center shadow-lg"
            >
              <div class="text-3xl font-bold text-white mb-1">
                {eventsCount}
              </div>
              <div class="text-orange-200 text-sm font-medium">
                Events Detected
              </div>
            </div>
            <div
              class="bg-gradient-to-br from-purple-600 to-purple-700 p-4 rounded-xl text-center shadow-lg"
            >
              <div class="text-3xl font-bold text-white mb-1">
                {confirmedPotholes}
              </div>
              <div class="text-purple-200 text-sm font-medium">Confirmed</div>
            </div>
          </div>
        </div>

        <!-- Events Timeline -->
        {#if sessionStatus === "active" && currentSession}
          <div
            class="p-6 bg-gradient-to-br from-gray-800 to-gray-900 border-4 border-blue-500"
          >
            <h2 class="text-xl font-bold mb-4 text-white flex items-center">
              <svg
                class="w-6 h-6 mr-2 text-amber-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
              Event Timeline ({currentSession.events.length})
              <!-- Debug info -->
              {#if currentSession.events.length !== eventsCount}
                <span class="text-red-400 text-sm ml-2"
                  >[Mismatch: {eventsCount}]</span
                >
              {/if}
            </h2>

            <div
              class="relative min-h-32 max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
            >
              <!-- Vertical Timeline Line -->
              <div
                class="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-400 via-cyan-400 to-blue-600"
              ></div>

              <!-- Start Session Marker -->
              <div class="relative flex items-start space-x-4 mb-6">
                <div class="flex-shrink-0 relative z-10">
                  <div
                    class="w-12 h-12 rounded-full flex items-center justify-center border-4 bg-blue-500 border-blue-400 shadow-lg"
                  >
                    <svg
                      class="w-6 h-6 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div
                    class="bg-blue-600 bg-opacity-40 backdrop-blur-sm rounded-xl p-4 border border-blue-500 shadow-lg"
                  >
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-white font-semibold text-sm"
                        >🚗 Session Started</span
                      >
                      <span class="text-blue-200 text-xs">
                        {new Date(
                          currentSession.startTime
                        ).toLocaleTimeString()}
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
                  <div class="text-xs text-gray-400 mb-2">
                    DEBUG: Showing {currentSession.events.length} events
                  </div>
                  {#each [...currentSession.events].reverse() as event, index (event.id)}
                    <div class="relative flex items-start space-x-4">
                      <!-- Timeline Node -->
                      <div class="flex-shrink-0 relative z-10">
                        <div
                          class="w-12 h-12 rounded-full flex items-center justify-center border-4
                        {event.userConfirmed === true
                            ? 'bg-green-500 border-green-400'
                            : event.userConfirmed === false
                              ? 'bg-red-500 border-red-400'
                              : 'bg-yellow-500 border-yellow-400'}
                        shadow-lg"
                        >
                          {#if event.userConfirmed === true}
                            <svg
                              class="w-6 h-6 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fill-rule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          {:else if event.userConfirmed === false}
                            <svg
                              class="w-6 h-6 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fill-rule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          {:else}
                            <svg
                              class="w-6 h-6 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fill-rule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                clip-rule="evenodd"
                              />
                            </svg>
                          {/if}
                        </div>

                        <!-- Severity Indicator -->
                        <div
                          class="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-r {getSeverityColor(
                            event.severity
                          )} border-2 border-gray-800"
                        ></div>
                      </div>

                      <!-- Event Content -->
                      <div class="flex-1 min-w-0">
                        <div
                          class="bg-gray-700 bg-opacity-60 backdrop-blur-sm rounded-xl p-4 border border-gray-600 shadow-lg"
                        >
                          <!-- Event Header -->
                          <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center space-x-2">
                              <span
                                class="text-white font-semibold capitalize text-sm"
                                >Event #{currentSession.events.length -
                                  index}</span
                              >
                              <span
                                class="text-xs px-2 py-1 rounded-full bg-gradient-to-r {getSeverityColor(
                                  event.severity
                                )} text-white font-medium"
                              >
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
                                {event.speed
                                  ? `${Math.round(event.speed * 3.6)} km/h`
                                  : "N/A"}
                              </div>
                            </div>
                            <div class="bg-black bg-opacity-30 rounded-lg p-2">
                              <div class="text-gray-400">Force</div>
                              <div class="text-white font-mono">
                                {Math.sqrt(
                                  event.accelerometer.x ** 2 +
                                    event.accelerometer.y ** 2 +
                                    event.accelerometer.z ** 2
                                ).toFixed(1)} m/s²
                              </div>
                            </div>
                          </div>

                          <!-- Confirmation Section -->
                          {#if event.userConfirmed === null}
                            <div class="space-y-2">
                              <div
                                class="text-center text-yellow-300 text-sm font-medium mb-2"
                              >
                                🤔 Requires Confirmation
                              </div>
                              <div class="flex space-x-2">
                                <button
                                  on:click={() => confirmPothole(event.id)}
                                  class="flex-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white py-2 px-3 rounded-lg text-xs font-semibold hover:from-green-600 hover:to-emerald-600 transition-all duration-200 flex items-center justify-center"
                                >
                                  <svg
                                    class="w-3 h-3 mr-1"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fill-rule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                  Pothole
                                </button>
                                <button
                                  on:click={() => markFalsePositive(event.id)}
                                  class="flex-1 bg-gradient-to-r from-red-500 to-rose-500 text-white py-2 px-3 rounded-lg text-xs font-semibold hover:from-red-600 hover:to-rose-600 transition-all duration-200 flex items-center justify-center"
                                >
                                  <svg
                                    class="w-3 h-3 mr-1"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fill-rule="evenodd"
                                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                  False
                                </button>
                              </div>
                            </div>
                          {:else}
                            <!-- Confirmation Status -->
                            <div class="text-center py-2">
                              {#if event.userConfirmed}
                                <div
                                  class="flex items-center justify-center text-green-400 text-sm"
                                >
                                  <svg
                                    class="w-4 h-4 mr-2"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fill-rule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                  <span class="font-semibold"
                                    >✅ Confirmed Pothole</span
                                  >
                                </div>
                              {:else}
                                <div
                                  class="flex items-center justify-center text-red-400 text-sm"
                                >
                                  <svg
                                    class="w-4 h-4 mr-2"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fill-rule="evenodd"
                                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                      clip-rule="evenodd"
                                    />
                                  </svg>
                                  <span class="font-semibold"
                                    >❌ False Positive</span
                                  >
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
                    <div
                      class="w-12 h-12 rounded-full flex items-center justify-center border-4 border-dashed border-gray-500 bg-gray-600 bg-opacity-50"
                    >
                      <svg
                        class="w-6 h-6 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div
                      class="bg-gray-600 bg-opacity-30 backdrop-blur-sm rounded-xl p-4 border border-dashed border-gray-500"
                    >
                      <div class="text-center">
                        <div class="text-gray-400 text-sm font-medium mb-1">
                          👁️ Waiting for events...
                        </div>
                        <div class="text-gray-500 text-xs mb-2">
                          Drive over bumps or potholes to see detections appear
                          here
                        </div>
                        <div class="text-red-400 text-xs">
                          DEBUG: Events count shows {eventsCount} but currentSession.events.length
                          is {currentSession.events.length}
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
        <div
          class="p-6 bg-gradient-to-br from-gray-800 to-gray-900 border-4 border-blue-500"
        >
          <h2 class="text-xl font-bold mb-4 text-white flex items-center">
            <svg
              class="w-6 h-6 mr-2 text-cyan-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm1 5a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z"
                clip-rule="evenodd"
              />
              <path
                d="M2 13.692V16a2 2 0 002 2h12a2 2 0 002-2v-2.308A24.974 24.974 0 0110 15c-2.796 0-5.487-.46-8-1.308z"
              />
            </svg>
            Live Sensor Data
          </h2>

          <!-- Speed -->
          <div
            class="mb-6 p-5 bg-gradient-to-br from-cyan-600 to-blue-600 rounded-xl text-center shadow-lg"
          >
            <div class="text-4xl font-bold text-white mb-2">
              {currentSpeed}
            </div>
            <div
              class="text-cyan-200 text-sm font-medium uppercase tracking-wide"
            >
              Speed (km/h)
            </div>
          </div>

          <!-- Accelerometer -->
          {#if currentAccelerometer}
            <div
              class="mb-6 p-5 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl border border-gray-600 shadow-lg"
            >
              <h3 class="font-bold mb-4 text-white flex items-center">
                <svg
                  class="w-5 h-5 mr-2 text-yellow-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"
                  />
                </svg>
                Accelerometer (m/s²)
              </h3>
              <div class="grid grid-cols-3 gap-3">
                <div
                  class="bg-gradient-to-br from-red-500 to-red-600 p-3 rounded-lg text-center"
                >
                  <div class="font-mono text-lg font-bold text-white">
                    {formatAcceleration(currentAccelerometer.x)}
                  </div>
                  <div class="text-red-200 text-xs font-medium">X-Axis</div>
                </div>
                <div
                  class="bg-gradient-to-br from-green-500 to-green-600 p-3 rounded-lg text-center"
                >
                  <div class="font-mono text-lg font-bold text-white">
                    {formatAcceleration(currentAccelerometer.y)}
                  </div>
                  <div class="text-green-200 text-xs font-medium">Y-Axis</div>
                </div>
                <div
                  class="bg-gradient-to-br from-blue-500 to-blue-600 p-3 rounded-lg text-center"
                >
                  <div class="font-mono text-lg font-bold text-white">
                    {formatAcceleration(currentAccelerometer.z)}
                  </div>
                  <div class="text-blue-200 text-xs font-medium">Z-Axis</div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Location -->
          {#if currentLocation}
            <div
              class="mb-6 p-5 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl border border-gray-600 shadow-lg"
            >
              <h3 class="font-bold mb-4 text-white flex items-center">
                <svg
                  class="w-5 h-5 mr-2 text-green-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                    clip-rule="evenodd"
                  />
                </svg>
                GPS Location
              </h3>
              <div class="space-y-2">
                <div
                  class="flex justify-between p-2 bg-black bg-opacity-20 rounded-lg"
                >
                  <span class="text-gray-300 text-sm">Latitude:</span>
                  <span class="font-mono text-white text-sm"
                    >{formatCoordinate(currentLocation.latitude)}</span
                  >
                </div>
                <div
                  class="flex justify-between p-2 bg-black bg-opacity-20 rounded-lg"
                >
                  <span class="text-gray-300 text-sm">Longitude:</span>
                  <span class="font-mono text-white text-sm"
                    >{formatCoordinate(currentLocation.longitude)}</span
                  >
                </div>
                <div
                  class="flex justify-between p-2 bg-black bg-opacity-20 rounded-lg"
                >
                  <span class="text-gray-300 text-sm">Accuracy:</span>
                  <span class="font-mono text-white text-sm"
                    >{currentLocation.accuracy.toFixed(0)}m</span
                  >
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Instructions -->
      <div
        class="p-6 bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 border-4 border-blue-500 rounded-bl-[4px] rounded-br-[4px]"
      >
        <h2 class="text-xl font-bold mb-4 text-white flex items-center">
          <svg
            class="w-6 h-6 mr-2 text-indigo-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fill-rule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clip-rule="evenodd"
            />
          </svg>
          How to Use
        </h2>
        <div class="space-y-3">
          <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
            <div
              class="flex-shrink-0 w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center mr-3 mt-0.5"
            >
              <span class="text-white text-sm font-bold">1</span>
            </div>
            <div>
              <p class="text-white font-medium">Grant Permissions</p>
              <p class="text-gray-300 text-sm">
                Allow access to motion sensors and location
              </p>
            </div>
          </div>
          <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
            <div
              class="flex-shrink-0 w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center mr-3 mt-0.5"
            >
              <span class="text-white text-sm font-bold">2</span>
            </div>
            <div>
              <p class="text-white font-medium">Start Session</p>
              <p class="text-gray-300 text-sm">
                Tap the start button before you begin driving
              </p>
            </div>
          </div>
          <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
            <div
              class="flex-shrink-0 w-8 h-8 bg-orange-600 rounded-full flex items-center justify-center mr-3 mt-0.5"
            >
              <span class="text-white text-sm font-bold">3</span>
            </div>
            <div>
              <p class="text-white font-medium">Confirm Events</p>
              <p class="text-gray-300 text-sm">
                Use the buttons to confirm real potholes or mark false positives
              </p>
            </div>
          </div>
          <div class="flex items-start p-3 bg-black bg-opacity-20 rounded-lg">
            <div
              class="flex-shrink-0 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center mr-3 mt-0.5"
            >
              <span class="text-white text-sm font-bold">4</span>
            </div>
            <div>
              <p class="text-white font-medium">End & Download</p>
              <p class="text-gray-300 text-sm">
                Stop the session to automatically download your data
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
