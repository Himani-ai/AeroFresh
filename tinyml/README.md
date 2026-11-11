# AeroFresh TinyML — dual track

Two deliberately separate paths:

## A. Bath VOC research baseline

Run:
`python -m pip install -r tinyml/requirements-tinyml.txt`
`python tinyml/scripts/train_voc_baseline.py --train data/processed/voc_train.csv --test data/processed/voc_test.csv --out tinyml/reports/voc_baseline`

A depth-4 decision tree was trained on the supplied Bath VOC split. Test accuracy: **85.07%**; balanced accuracy: **85.07%**; depth 4; 16 leaves. See `reports/voc_baseline_metrics.json`. This is a research benchmark only: TGS2620/TGS2602/SGP40 channels are not MQ-135, so do not flash this model on AeroFresh hardware. The source split is sample-level and may place time-adjacent observations from the same monitoring tests on both sides.

## B. Actual AeroFresh hardware model

Collect labelled readings using `data/hardware_template/aerofresh_readings_template.csv`, then run:
`python tinyml/scripts/train_hardware_tinyml.py --csv my_labelled_readings.csv --out tinyml/firmware --report tinyml/reports/hardware_metrics.json`

Required inputs: MQ-135 raw ADC, DHT22 temperature, DHT22 humidity, LDR raw ADC. Each row needs stage_id (1–5), banana_id and session_id. The trainer holds out whole banana IDs, then emits a compact C++ decision-tree header. It refuses to run without at least two banana groups and enough classes in both partitions. Two groups are a technical minimum only; target 10–20+ independent bananas/bunches, multiple sessions and balanced classes.

Firmware call after training: `aerofresh_predict_stage(mq135Raw, temperatureC, humidityPct, ldrRaw)`.

This is a small decision tree, not TensorFlow Lite Micro. No hardware model is included yet: actual labelled ESP32 readings are still required. MQ-135 ADC is not ppm and requires warm-up, stable analog design and calibration. A ripeness estimate is not a food-safety test.
