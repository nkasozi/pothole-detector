# Pothole Detector PWA

A Progressive Web App designed to log driving data for pothole detection using Svelte and Tailwind CSS.

## Features

### Core Functionality
- **Session Management**: Start/End Session buttons to control data logging periods
- **Accelerometer Detection**: Uses phone's accelerometer to detect vertical jolts that signify potential potholes
- **Speed Monitoring**: Records vehicle speed using the Geolocation API
- **Voice Confirmation**: Web Speech API allows users to verbally confirm pothole events by saying "pothole"
- **Data Logging**: All significant events logged with timestamp, sensor readings, speed, and labels
- **Auto Export**: Automatically downloads collected data as JSON-formatted .txt file at session end

### Progressive Web App Features
- **Offline Capability**: Service worker enables offline functionality
- **Mobile-First Design**: Responsive design optimized for mobile devices
- **Install Prompt**: Can be installed on mobile devices as a native-like app
- **Real-time Monitoring**: Live display of current sensor readings and session statistics

## Getting Started

### Prerequisites
- Node.js 18+
- Modern web browser with sensor API support
- HTTPS (required for sensor APIs to work)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd pothole-detector-svelte
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
npm run preview
```

## Usage

1. **Grant Permissions**: On first use, grant access to device sensors (accelerometer, GPS, microphone)
2. **Start Session**: Tap "Start Session" before beginning your drive
3. **Drive Normally**: Keep your phone stable while driving
4. **Voice Confirmation**: Say "pothole" within 5 seconds of a detected event to confirm it
5. **End Session**: Tap "End Session" to stop logging and automatically download data
6. **Review Data**: Open the downloaded JSON file to analyze detected events

## Data Format

The exported data includes:
- Session metadata (start/end times, total distance, average speed)
- Individual events with:
  - Timestamp
  - Accelerometer readings (x, y, z)
  - GPS coordinates and speed
  - Event severity (low/medium/high)
  - Voice confirmation status
  - Event label (detected/confirmed/false_positive)

## Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Partial support (no speech recognition)
- **Safari**: iOS 13+ required for device motion permissions

## Permissions Required

- **Motion Sensors**: For accelerometer data
- **Location**: For GPS coordinates and speed
- **Microphone**: For voice confirmation feature

## Technical Details

- Built with SvelteKit and TypeScript
- Styled with Tailwind CSS
- Service Worker for PWA functionality
- Real-time sensor data processing
- Automatic data export in JSON format

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on mobile devices
5. Submit a pull request

## License

MIT License - see LICENSE file for details