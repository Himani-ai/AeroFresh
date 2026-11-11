# ESP32 model header

The hardware trainer generates `aerofresh_model.h` only after real labelled board data is supplied. No fabricated header is committed.

Include the generated header in the Arduino ESP32 sketch and call:
`uint8_t stage = aerofresh_predict_stage(mq135Raw, dhtTemperatureC, dhtHumidityPct, ldrRaw);`

Input order is MQ-135 ADC, DHT22 temperature °C, DHT22 humidity %, LDR ADC. Output is stage ID 1–5. Verify ADC ranges and generated thresholds against live readings before relying on the result.
