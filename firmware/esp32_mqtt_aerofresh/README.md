# AeroFresh ESP32 + FreeMQTT setup

## Connection architecture

- ESP32 publishes MQTT over TCP to `broker.freemqtt.com:1883`.
- AeroFresh website subscribes over secure WebSockets at `wss://broker.freemqtt.com:8084/mqtt`.
- Topic: `aerofresh/himani-ai/device01/telemetry`.
- Device ID: `aerofresh-esp32-01`.
- Public broker credentials: username `freemqtt`, password `public`.

These are the public connection details currently published by [FreeMQTT](https://www.freemqtt.com/). The broker is shared and intended only for learning, testing and prototyping. Assume messages/topics are visible to other users; do not publish personal data, Wi-Fi credentials or private information. Its service has no uptime guarantee and may restart. The shared public username is not a dedicated per-device account and does not demonstrate the issue's required publish-only ESP32 and subscribe-only dashboard permissions. Treat it strictly as a temporary integration test endpoint.

**Transport note:** this prototype uses unencrypted MQTT/TCP on port 1883 from the ESP32 to avoid hardcoding an unverified CA certificate. The browser uses WSS. Browser-to-broker traffic is encrypted, but the ESP32-to-broker hop is not. This does not satisfy an end-to-end secure transport requirement. Use a private broker with TLS on the device connection, verified CA trust, and separate least-privilege credentials before treating broker security as complete.

## 1. Install software

1. Install Arduino IDE 2.x.
2. In Arduino IDE → Settings → Additional Boards Manager URLs, add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
3. Open Boards Manager, search `esp32`, and install **esp32 by Espressif Systems**.
4. Select your actual board (for a common DevKit, **ESP32 Dev Module**).
5. In Library Manager install:
   - **PubSubClient** by Nick O'Leary
   - **DHT sensor library** by Adafruit
   - **Adafruit Unified Sensor**

## 2. Prepare Wi-Fi credentials

1. Open the folder `firmware/esp32_mqtt_aerofresh`.
2. Make a copy of `secrets.h.example` named `secrets.h` in the same folder.
3. Replace `YOUR_WIFI_NAME` and `YOUR_WIFI_PASSWORD` with your Wi-Fi name and password.
4. Save `secrets.h`. It is excluded from Git by `.gitignore`; never upload it to GitHub or share it in chat.

Use a 2.4 GHz Wi-Fi network; classic ESP32 boards generally do not support 5 GHz Wi-Fi.

## 3. Check wiring before powering

| Signal | ESP32 pin | Notes |
|---|---:|---|
| DHT22 DATA | GPIO 4 | Confirm module pinout and supply |
| MQ-135 AO | GPIO 34 | Use a divider/conditioning circuit; ADC input must stay at or below 3.3 V |
| LDR divider midpoint | GPIO 35 | LDR + fixed resistor divider between 3.3 V and GND |
| Grounds | GND | All grounds common |

**Never connect MQ-135 AO directly if it can exceed 3.3 V.** Many MQ-135 modules run at 5 V and their analog output can exceed the ESP32 ADC limit. Check with a multimeter and add suitable voltage division/conditioning.

## 4. Upload firmware

1. Open `esp32_mqtt_aerofresh.ino` in Arduino IDE.
2. Select the correct board and COM/USB port.
3. Click Upload.
4. Open Serial Monitor at **115200 baud**.
5. Look for Wi-Fi connected, MQTT connected, and periodic `Published:` JSON messages.

The sketch publishes every 15 seconds. It sends `device_id`, UTC `timestamp`, `temperature`, `humidity`, `gas_adc`, and `ldr_adc`.

## 5. Connect the AeroFresh website

1. Open the deployed AeroFresh website over HTTPS.
2. Go to **System Information → MQTT integration configuration**.
3. The form defaults should already show the FreeMQTT WSS URL, topic and device ID:
   - WSS URL: `wss://broker.freemqtt.com:8084/mqtt`
   - Topic: `aerofresh/himani-ai/device01/telemetry`
   - Device ID: `aerofresh-esp32-01`
   - Username: `freemqtt`
   - Password: `public`
4. Click **Connect live MQTT**.
5. Wait for the first valid ESP32 payload. The dashboard remains in demo mode until real telemetry arrives.

## 6. Test without hardware (optional)

Use any MQTT client that supports WebSockets to publish a test JSON message to the exact topic above. Set the same username/password. The website should switch to LIVE only after receiving a payload whose `device_id` matches and whose fields validate. A test message is not a physical sensor reading.

## Troubleshooting

- **WebSocket fails:** confirm exact WSS URL including port `8084` and path `/mqtt`; try again later because this is a public best-effort broker.
- **ESP32 Wi-Fi fails:** confirm 2.4 GHz Wi-Fi and credentials in local `secrets.h`.
- **MQTT connection fails:** check host `broker.freemqtt.com`, TCP port `1883`, username/password, and Serial Monitor error state.
- **Dashboard connects but no live data:** verify exact topic and device ID; the ESP32 and website must use the same topic.
- **DHT22 read fails:** check VCC, GND, DATA wiring and module pinout.
- **MQ-135 ADC is saturated:** check warm-up, AO voltage divider, ADC pin and common ground. ADC counts are raw response, not ppm.
