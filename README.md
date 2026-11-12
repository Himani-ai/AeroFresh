# AeroFresh — IoT Food-Storage Risk Analytics

AeroFresh is a responsive, static frontend prototype for an environmental monitoring and food-storage risk analytics engineering project. It is built with HTML5, CSS3 and vanilla JavaScript, with Chart.js for interactive charts and Lucide icons.

**Current status: demo by default, with optional live MQTT.** The site can receive validated ESP32 telemetry over secure WebSockets when configured in the System Information screen. No broker, credentials or hardware are included in this repository. Demo readings remain synthetic until a live connection is established.

## Project structure

```text
aerofresh/
├── index.html
├── style.css
├── script.js
└── README.md
```

## Run locally

1. Download or clone this repository.
2. Open `index.html` directly in a modern browser. No Node.js, build step or backend is required.
3. For a local static server (optional), run `python -m http.server 8000` from this folder and open `http://localhost:8000`.

Chart.js and Lucide are loaded from public CDNs, and the font is loaded from Google Fonts. An internet connection is needed for those external assets. The dashboard itself is static and its demo logic runs in the browser.

## Features in this prototype

- Responsive desktop sidebar and mobile navigation drawer.
- Overview, Live Monitoring, Historical Analytics, Anomaly Detection, Risk Analysis, Ask AeroFresh and System Information views.
- DHT22 temperature / humidity, MQ-135 gas response and LDR light-level monitoring.
- Demo-only storage door open / close controls; live commands require an active MQTT connection and status telemetry confirmation.
- Browser-local edge archive using IndexedDB, with a rolling seven-day retention window.
- Chart.js time-series charts, time-range selector and a sample correlation matrix.
- Experimental 0–100 environmental risk indicator with a separate documented calculation function.
- Simulated anomaly and system alerts.
- Local keyword-based demo assistant.
- MQTT.js WSS adapter with browser-local configuration, validation, reconnect, connection states and stale-data detection.

## Demo data and risk model

The clearly marked `DEMO CONFIGURATION` at the top of `script.js` contains the demo latest values, random seed, refresh interval and MQTT settings. The generated history is synthetic and intended only for UI testing.

`calculateEnvironmentalRisk(reading, history)` is intentionally separate from rendering. It combines illustrative temperature deviation, humidity deviation, relative gas-response variation and persistence weights. The output is an experimental environmental indicator, **not** a scientifically validated food-spoilage probability, a food-safety measurement or a substitute for food-handling guidance. Thresholds and weights must be validated against calibrated sensor data and appropriate food-storage studies before any real-world use.

The MQ-135 and LDR fields are raw ADC readings, not calibrated gas concentration or illuminance. Sensor warm-up, calibration, analog front-end design and environmental cross-sensitivity must be considered during hardware integration.

## GitHub repository and Pages deployment

1. Sign in to GitHub and choose **New repository**.
2. Name it `aerofresh` (or another repository name), choose Public or Private, and create it.
3. Upload `index.html`, `style.css`, `script.js` and `README.md` to the repository root. Keep the filenames and relative paths unchanged.
4. Open the repository's **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select branch `main` and folder `/ (root)`, then save.
7. Wait for the Pages deployment workflow to finish. The published URL will be shown in the Pages settings and usually follows `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.
8. Open the published URL. Test navigation, mobile layout, charts, time ranges, alert filters and the demo assistant.

All local asset references are relative (`style.css`, `script.js`), so the site supports GitHub Pages repository subpaths. The external libraries are loaded from CDN URLs.

## Testing checklist

- [ ] Open `index.html` locally and confirm the dashboard renders.
- [ ] Confirm the top bar and sensor cards explicitly say DEMO.
- [ ] Navigate through all seven sidebar sections.
- [ ] Resize to mobile width and open/close the navigation drawer.
- [ ] Change the analytics range (1 hour, 6 hours, 24 hours, 7 days).
- [ ] Filter the alert list by severity.
- [ ] Try the suggested Ask AeroFresh questions.
- [ ] Open and close the storage door in demo mode and confirm the page labels the action as simulated.
- [ ] Confirm DHT22, MQ-135 and LDR are displayed as sensors.
- [ ] Confirm local archive records appear and records older than seven days are purged.
- [ ] Confirm browser console shows MQTT disabled unless you deliberately configure it.
- [ ] Repeat the same checks on the GitHub Pages URL.

## Future ESP32 + MQTT integration

### Example message schema

This is a **documented example schema only**. It is not a claim about the current firmware payload:

```json
{
  "device_id": "aerofresh-esp32-01",
  "timestamp": "2026-10-31T08:30:00Z",
  "temperature": 28.4,
  "humidity": 61.2,
  "gas_adc": 1240,
  "ldr_adc": 1860,
  "door_state": "closed"
}
```

### Live MQTT configuration

The future adapter lives in `script.js`:

Use **System Information → MQTT integration configuration**:

1. Choose a broker that supports TLS-secured WebSockets and enter its `wss://` URL, topic and device ID.
2. Use dedicated, revocable credentials: read-only access to the telemetry topic and publish-only access to its `/door/command` subtopic.
3. Optionally remember settings in browser local storage. Passwords are never written to source code.
4. Click **Connect live MQTT**. The dashboard changes to live mode only after connection and subscription succeed.
5. Test malformed JSON, wrong device IDs, missing required sensor fields, reconnects and stale readings before connecting hardware.

Required telemetry fields are `device_id`, UTC ISO `timestamp`, `temperature` (-40 to 85 °C), `humidity` (0 to 100 %), `gas_adc` (0 to 4095) and `ldr_adc` (0 to 4095). These map to the DHT22, MQ-135 and LDR readings. Include `door_state` as `open` or `closed` in telemetry to confirm actuator state.

When MQTT is connected, door commands publish JSON to `<telemetry-topic>/door/command`, for example `{"device_id":"aerofresh-esp32-01","command":"door.set","door_state":"open","timestamp":"2026-10-31T08:30:00Z"}`. The interface waits for a telemetry message containing the confirmed `door_state`; it does not treat command delivery as proof the door moved. Without an active connection, the buttons only change the local demo state. Saved MQTT settings do not auto-connect on page load.

**Security warning:** a public static website cannot keep embedded credentials secret. Browser-side MQTT requires narrowly scoped, revocable credentials with read access only to the telemetry topic and publish access only to the door-command topic, rate limits and TLS/WSS. Never put administrator credentials, private tokens or long-lived secrets in a public GitHub repository. For production, prefer a backend relay/API that authenticates devices, validates messages and serves authorized data to the frontend. The controller must enforce its own physical safety limits and validate every command.

## Edge archive and assistant

The Edge data archive stores sampled demo or MQTT sensor readings in browser IndexedDB. It imports the initial demo history when the archive is empty, then stores at most one new sample per minute. Entries older than seven days are removed on startup and every minute while the page is open. Data remains in that browser and is not stored on the ESP32 or sent to a server. The Ask AeroFresh interface uses local keyword matching; replace `answerQuestion()` with a secure backend endpoint when an assistant service is available. Never expose API keys in frontend JavaScript.

## Technology and hosting notes

- HTML5, CSS3, vanilla JavaScript
- Chart.js 4 (CDN)
- Lucide icons (CDN)
- GitHub Pages static hosting
- No build process or backend required for the demo

## License

Add a license file if you intend to publish or reuse this project under explicit terms.


## Banana ripeness research data

A reproducible preprocessing workflow and data dictionary for the University of Bath banana-ripeness VOC and TPHiS datasets are available in [datasets/banana-ripeness](datasets/banana-ripeness/README.md). The script at [scripts/preprocess_banana_data.py](scripts/preprocess_banana_data.py) validates feature/label indices, preserves the source train/test split, adds the five published ripeness labels, and writes cleaned CSVs plus a quality report.

Source: Callaghan & Martinez Hernandez (2025), University of Bath Research Data Archive, DOI [10.15125/BATH-01459](https://doi.org/10.15125/BATH-01459), CC BY 4.0.

**Research-data caveat:** the Bath VOC channels are TGS2620, TGS2602 and SGP40 (not MQ-135); TPHiS contains BME280 and spectral readings (not DHT22/MQ-135). These are offline research features, not AeroFresh ESP32 telemetry. Collect and validate paired local banana observations before claiming that a model trained on this external data predicts from the project's MQ-135.


## TinyML banana-ripeness experiments

A lightweight two-track workflow is documented in [tinyml/README.md](tinyml/README.md): a Bath VOC research baseline and a separate ESP32 hardware-specific pipeline for MQ-135, DHT22 and LDR. The research baseline is **not compatible** with the MQ-135. The hardware trainer exports a compact C++ decision-tree header only after real, labelled AeroFresh readings are collected. See the CSV template and collection protocol under `tinyml/data/hardware_template/`.

## ESP32 MQTT live connection

The ESP32 publisher sketch, installation list, broker setup, wiring defaults and payload contract are in [firmware/esp32_mqtt_aerofresh/README.md](firmware/esp32_mqtt_aerofresh/README.md). The current prototype configuration uses plain MQTT/TCP on port 1883 from the ESP32 to the documented shared public broker, then MQTT over secure WebSockets (WSS) from the browser. This is a learning/demo setup only: the device-to-broker hop is not encrypted, and the shared broker does not provide the per-device access restrictions expected for deployment. Do not send private data or credentials through it. For a secure deployment, move both clients to a private broker with authenticated TLS and separate publish-only / subscribe-only credentials. Install Arduino IDE 2.x, Espressif ESP32 board package, PubSubClient, Adafruit DHT sensor library and Adafruit Unified Sensor. WiFi is included in the ESP32 core.

**Hardware safety:** MQ-135 modules are commonly powered at 5 V. Never connect an analog output that can exceed 3.3 V directly to an ESP32 ADC pin; use a suitable voltage divider/conditioning circuit. The sketch defaults are GPIO4 (DHT22), GPIO34 (MQ-135 AO) and GPIO35 (LDR divider midpoint); change them to match the actual wiring. Do not commit `secrets.h` or broker credentials.
