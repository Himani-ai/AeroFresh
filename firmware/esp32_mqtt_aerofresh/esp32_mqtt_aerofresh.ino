/*
 * AeroFresh ESP32 -> FreeMQTT public broker publisher (prototype transport).
 * Board: ESP32 Dev Module (Arduino IDE)
 * Sensors: DHT22 module, MQ-135 analog output, LDR voltage divider.
 *
 * FreeMQTT is a shared public broker. This sketch uses plain MQTT/TCP on
 * port 1883 for the easiest prototype connection. Do not send private data.
 * For production, use a private broker with authenticated TLS.
 *
 * IMPORTANT: use a voltage divider/level conditioning on MQ-135 AO so ESP32
 * ADC pin never exceeds 3.3 V. Never connect a 5 V analog output directly.
 * Copy secrets.h.example to secrets.h and add your own Wi-Fi credentials.
 */
#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>
#include "secrets.h"

#define DHT_PIN 4
#define DHT_TYPE DHT22
#define MQ135_PIN 34
#define LDR_PIN 35

static const char *DEVICE_ID = "aerofresh-esp32-01";
static const char *MQTT_TOPIC = "aerofresh/himani-ai/device01/telemetry";
static const uint32_t PUBLISH_INTERVAL_MS = 15000;
static const uint32_t WIFI_RETRY_MS = 10000;

WiFiClient networkClient;
PubSubClient mqtt(networkClient);
DHT dht(DHT_PIN, DHT_TYPE);
uint32_t lastPublish = 0;
uint32_t lastWifiAttempt = 0;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection pending; retrying.");
  }
}

bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Syncing UTC clock");
  time_t now = time(nullptr);
  uint32_t started = millis();
  while (now < 1700000000 && millis() - started < 15000) {
    delay(400);
    Serial.print(".");
    now = time(nullptr);
  }
  Serial.println();
  return now >= 1700000000;
}

bool connectMQTT() {
  if (mqtt.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;
  String clientId = String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("Connecting MQTT to %s:%u ...\n", MQTT_HOST, MQTT_PORT);
  if (mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.printf("MQTT connected. Publishing to %s\n", MQTT_TOPIC);
    return true;
  }
  Serial.printf("MQTT connect failed, state=%d\n", mqtt.state());
  return false;
}

bool makeTimestamp(char *buffer, size_t length) {
  time_t now = time(nullptr);
  if (now < 1700000000) return false;
  struct tm utc;
  gmtime_r(&now, &utc);
  return strftime(buffer, length, "%Y-%m-%dT%H:%M:%SZ", &utc) > 0;
}

void publishTelemetry() {
  if (!mqtt.connected()) return;
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT22 read failed; skipping this sample.");
    return;
  }

  int gasAdc = analogRead(MQ135_PIN);
  int ldrAdc = analogRead(LDR_PIN);
  char timestamp[25];
  if (!makeTimestamp(timestamp, sizeof(timestamp))) {
    Serial.println("UTC clock not synchronized; skipping publish.");
    return;
  }

  char payload[256];
  snprintf(payload, sizeof(payload),
    "{\"device_id\":\"%s\",\"timestamp\":\"%s\",\"temperature\":%.1f,\"humidity\":%.1f,\"gas_adc\":%d,\"ldr_adc\":%d}",
    DEVICE_ID, timestamp, temperature, humidity, gasAdc, ldrAdc);

  if (mqtt.publish(MQTT_TOPIC, payload, false)) {
    Serial.print("Published: ");
    Serial.println(payload);
  } else {
    Serial.println("MQTT publish failed.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  analogReadResolution(12);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
  analogSetPinAttenuation(LDR_PIN, ADC_11db);
  dht.begin();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);
  connectWiFi();
  if (WiFi.status() == WL_CONNECTED) syncClock();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiAttempt > WIFI_RETRY_MS) {
    lastWifiAttempt = millis();
    connectWiFi();
  }
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqtt.connected()) connectMQTT();
    mqtt.loop();
    if (mqtt.connected() && millis() - lastPublish >= PUBLISH_INTERVAL_MS) {
      lastPublish = millis();
      publishTelemetry();
    }
  }
  delay(10);
}
