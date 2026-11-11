# ESP32 MQTT connection setup

## Architecture

- ESP32 publishes to the broker using MQTT over TLS (TCP 8883).
- The AeroFresh browser dashboard subscribes using MQTT over secure WebSockets (WSS).
- Both use the same broker hostname, credentials (prefer separate accounts), and topic: `aerofresh/telemetry`.

For a simple managed broker, HiveMQ Cloud Starter is a straightforward choice. Its current quick-start guide documents secure WebSocket access on port 8884. Check your cluster's own connection details; do not assume every broker uses the same WSS path/port. See https://docs.hivemq.com/hivemq-cloud/quick-start-guide.html.

## Install

1. Install **Arduino IDE 2.x**.
2. In Arduino IDE → Settings → Additional Boards Manager URLs, add Espressif's official ESP32 package URL: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
3. Open Boards Manager, search **esp32**, install **esp32 by Espressif Systems**. Select your exact ESP32 board (for a common DevKit, choose **ESP32 Dev Module**).
4. Open Library Manager and install:
   - **PubSubClient** by Nick O'Leary
   - **DHT sensor library** by Adafruit
   - **Adafruit Unified Sensor** by Adafruit
5. `WiFi.h`, `WiFiClientSecure.h`, `time.h` are provided by the ESP32 core; do not install separate libraries for them.
6. Open `esp32_mqtt_aerofresh.ino`. Copy `secrets.h.example` to `secrets.h` in the same sketch folder and fill Wi-Fi, broker username/password, host and the broker root CA certificate. The real `secrets.h` is gitignored.
7. Choose the correct board and COM/USB port, upload, then open Serial Monitor at **115200 baud**.

## Pin defaults in the sketch

| Signal | ESP32 pin | Notes |
|---|---:|---|
| DHT22 DATA | GPIO 4 | DHT22 module; confirm module supply and pinout |
| MQ-135 AO | GPIO 34 | Analog input only; output must be divided/conditioned to max 3.3 V |
| LDR divider midpoint | GPIO 35 | Use LDR + fixed resistor as a divider between 3.3 V and GND |
| Grounds | GND | All sensor and ESP32 grounds common |

Change the constants in the sketch if your physical wiring uses different GPIOs. Do not connect the MQ-135 module's 5 V analog output directly to an ESP32 pin. Check the module output range with a multimeter and use a suitable resistor divider/conditioning circuit. Never power the ESP32 ADC pin above 3.3 V.

## Broker settings

Create a managed broker/cluster and a unique username/password with publish permission only to `aerofresh/telemetry` for the ESP32. Create a second dashboard credential with subscribe/read permission only to that topic if the provider supports topic ACLs.

For HiveMQ Cloud:
- ESP32 host: the cluster hostname (e.g. `xxxx.s1.eu.hivemq.cloud`), port **8883**, TLS.
- Dashboard WSS URL: `wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt`.
- Topic: `aerofresh/telemetry`.
- Device ID: `aerofresh-esp32-01`.
- The host and credentials are shown in your cluster's connection details. The cluster's WSS client / Troubleshooting tab is useful to verify a subscription before connecting the ESP32.

Do not paste a normal `mqtts://...` address or port 8883 into the browser form. The browser requires the broker's WSS listener URL. ESP32 firmware uses the TCP/TLS host + port instead.

## Dashboard connection

1. Deploy/open the AeroFresh site over HTTPS (GitHub Pages is fine).
2. Open **System → MQTT integration configuration**.
3. Enter the WSS URL, topic and device ID; enter the dashboard's read-only username/password.
4. Press **Connect live MQTT**. It should show broker connected; the display switches to LIVE only after the first valid ESP32 payload.
5. Upload/run the ESP32 sketch. Serial Monitor should print each published JSON message and the dashboard should update.
6. Leave **Remember settings** unchecked on shared/public computers. Only non-secret broker URL/topic/device ID/username are stored locally; password is never saved. The browser session must enter the password again after reload.

## Payload contract

Required fields: `device_id`, `timestamp` (UTC ISO-8601 ending in Z), `temperature` (°C), `humidity` (%RH), `gas_adc` (0–4095), `ldr_adc` (0–4095). Optional: `dust_raw`, `aqi`, `tvoc`, `eco2`. Missing optional sensors remain unavailable.

Example:
```json
{"device_id":"aerofresh-esp32-01","timestamp":"2026-11-11T08:30:00Z","temperature":28.4,"humidity":61.2,"gas_adc":1240,"ldr_adc":2100}
```

## Troubleshooting

- Browser says MQTT.js unavailable: check internet access and the mqtt.js CDN request in DevTools.
- WebSocket fails but ESP32 connects: WSS port/path is wrong or blocked. Verify the provider's WSS endpoint (HiveMQ Cloud Starter: 8884 and /mqtt) and test from the provider's WebSocket client.
- MQTT auth failure: regenerate credentials and ensure browser user has subscribe ACL and ESP32 user has publish ACL.
- ESP32 TLS fails: ensure system time synchronized and CA PEM matches the broker's current certificate chain; do not switch to `setInsecure()` as a permanent fix.
- ESP32 publishes but dashboard ignores data: topic and device_id must match exactly; JSON keys and ranges must follow the contract.
- MQ-135 reading stuck or saturated: check warm-up, AO voltage divider, ADC pin and grounding. ADC counts are raw response, not ppm.
