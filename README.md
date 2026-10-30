# AeroFresh — IoT Food-Storage Risk Analytics

AeroFresh is a responsive, static frontend prototype for an environmental monitoring and food-storage risk analytics engineering project. It is built with HTML5, CSS3 and vanilla JavaScript, with Chart.js for interactive charts and Lucide icons.

**Current status: demo-only.** The site does not connect to an ESP32, MQTT broker, database, AI model or physical sensor. All initial readings, historical series and alerts are synthetic interface-test data. The particulate sensor is shown as planned / not installed.

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
- DHT22 temperature / humidity and MQ-135 raw ADC demo sensor cards.
- GP2Y1014 particulate placeholder (no reading until installed).
- Chart.js time-series charts, time-range selector and a sample correlation matrix.
- Experimental 0–100 environmental risk indicator with a separate documented calculation function.
- Simulated anomaly and system alerts.
- Local keyword-based demo assistant; no AI model is connected.
- Isolated MQTT adapter boundary, disabled by default.

## Demo data and risk model

The clearly marked `DEMO CONFIGURATION` at the top of `script.js` contains the demo latest values, random seed, refresh interval and MQTT settings. The generated history is synthetic and intended only for UI testing.

`calculateEnvironmentalRisk(reading, history)` is intentionally separate from rendering. It combines illustrative temperature deviation, humidity deviation, relative gas-response variation and persistence weights. The output is an experimental environmental indicator, **not** a scientifically validated food-spoilage probability, a food-safety measurement or a substitute for food-handling guidance. Thresholds and weights must be validated against calibrated sensor data and appropriate food-storage studies before any real-world use.

The MQ-135 field is raw ADC response, not a gas concentration. Sensor warm-up, calibration, analog front-end design and environmental cross-sensitivity must be considered during hardware integration.

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
- [ ] Confirm GP2Y1014 is displayed as planned / no data.
- [ ] Confirm browser console shows MQTT disabled unless you deliberately configure it.
- [ ] Repeat the same checks on the GitHub Pages URL.

## Future ESP32 + MQTT integration

### Example message schema

This is a **documented example schema only**. It is not a claim about the current firmware payload:

```json
{
  "device_id": "aerofresh-esp32-01",
  "timestamp": "2026-10-29T10:30:00Z",
  "temperature": 28.4,
  "humidity": 61.2,
  "gas_adc": 1240
}
```

### Integration boundary

The future adapter lives in `script.js`:

- `DEMO_CONFIG.mqtt` holds the broker URL, topic and connection options.
- `initMqttAdapter()` refuses to connect unless `enabled` is true and a broker URL is provided.
- `connectMqtt()` creates the MQTT.js client over secure WebSockets (WSS), subscribes to the configured topic and handles reconnect, offline, close and error events.
- Incoming JSON is parsed and passed to `handleIncomingReading(payload)`.
- `handleIncomingReading()` validates required numeric fields and timestamp before adding a normalized reading to the history and refreshing the UI.

To enable it later:

1. Choose an MQTT broker that supports TLS-secured WebSockets.
2. Define a topic and a stable JSON payload contract in the ESP32 firmware.
3. Load MQTT.js in `index.html` (for example, a pinned MQTT.js browser bundle from a trusted CDN or a locally hosted bundle).
4. Configure `DEMO_CONFIG.mqtt.brokerUrl` and `topic`, then set `enabled: true`.
5. Supply credentials through an appropriately designed authentication flow; do not commit secrets.
6. Test invalid messages, missing fields, timestamp handling, reconnect behavior and broker authorization.
7. Add a true connection-state UI before representing hardware as online. The current dashboard deliberately stays labeled as demo until this UI is completed.

**Security warning:** a public static website cannot keep embedded credentials secret. Browser-side MQTT requires narrowly scoped, revocable credentials with read-only access to only the required topic, rate limits and TLS/WSS. Never put administrator credentials, private tokens or long-lived secrets in a public GitHub repository. For production, prefer a backend relay/API that authenticates devices, validates messages and serves authorized data to the frontend.

### Suggested payload extension

When GP2Y1014 is installed and calibrated, agree on a documented field name and units (for example, `particulate_ug_m3` only if the sensor conversion is validated). Do not silently interpret raw voltage or ADC counts as a calibrated particulate concentration.

## Future analytics and assistant

Python, Pandas and machine-learning analytics are planned future work, not currently implemented. A production data pipeline could persist validated telemetry, calculate derived features server-side, version model outputs and expose authenticated APIs. The Ask AeroFresh interface currently uses local keyword matching; replace `answerQuestion()` with a call to a secure backend endpoint when an assistant service is available. Never expose API keys in frontend JavaScript.

## Technology and hosting notes

- HTML5, CSS3, vanilla JavaScript
- Chart.js 4 (CDN)
- Lucide icons (CDN)
- GitHub Pages static hosting
- No build process or backend required for the demo

## License

Add a license file if you intend to publish or reuse this project under explicit terms.
