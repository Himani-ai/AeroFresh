# Hardware collection protocol

One row per observation, timestamp in UTC. Keep sample interval, sensor position, enclosure, banana distance, ventilation, warm-up and ADC configuration consistent.

- banana_id: unique independent banana/bunch; do not reuse across independent samples.
- session_id: one continuous monitoring run; new ID after restarting/repositioning.
- mq135_adc and ldr_adc: raw ESP32 ADC values; confirm board attenuation and actual ADC behavior.
- temperature_c and humidity_pct: DHT22 readings.
- stage_id: visual label 1 unripe, 2 ripe, 3 beyond-ripe, 4 overripe, 5 gone-off.

Collect multiple independent bananas/bunches, multiple sessions, all five stages where practical, and more than one storage condition. Do not use one banana per class because banana identity becomes confounded with class. Record the visual label at each timestamp; do not silently interpolate labels.
