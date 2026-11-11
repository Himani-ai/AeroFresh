# AeroFresh banana-ripeness data preparation

Reproducible preparation notes for the University of Bath VOC and TPHiS banana-ripeness archives.

## Source and attribution

Callaghan, K. & Martinez Hernandez, U. (2025). Dataset for Low-Cost, Multi-Sensor Non-Destructive Banana Ripeness Estimation Using Machine Learning. University of Bath Research Data Archive. DOI: https://doi.org/10.15125/BATH-01459

Dataset: https://researchdata.bath.ac.uk/1459/  
Licence: Creative Commons Attribution 4.0 International (CC BY 4.0). Retain attribution when redistributing.

VOC contains Figaro TGS2620, TGS2602 and Sensirion SGP40 readings (tests 3 and 4). TPHiS contains BME280 internal temperature, pressure and humidity plus 18 spectral channels from the SparkFun TRIAD AS7265x spectrometer (tests 2–5).

## Generated files

- voc_train.csv and voc_test.csv: three VOC features plus ripeness targets.
- tphis_train.csv and tphis_test.csv: temperature, pressure, humidity, 18 spectral channels plus ripeness targets.

Each output includes source_row_index, original feature columns, ripeness_stage_id and ripeness_stage. The generated multi-megabyte CSVs are provided in the downloadable preprocessing bundle rather than committed to Git.

## Official label mapping

| ID | Stage | Appearance |
|---:|---|---|
| 1 | unripe | Whole banana is green |
| 2 | ripe | Whole banana is yellow |
| 3 | beyond_ripe | Yellow with some browning on a minority of visible surface |
| 4 | overripe | Majority of visible surface is brown or has brown spots |
| 5 | gone_off | Whole banana is black or brown |

Source: Callaghan & Martinez Hernandez (2025), IEEE Sensors Journal, Table II, DOI: 10.1109/JSEN.2025.3528250.

## Preprocessing performed

1. Read original x_train, y_train, x_test and y_test files.
2. Verified that feature and label index sequences match exactly, then joined one-to-one.
3. Renamed the source index and target columns.
4. Added human-readable five-stage labels.
5. Checked numeric values, missing values, non-finite values, duplicate keys and class distributions.
6. Preserved the original train/test split and feature values. No imputation or scaling was necessary or applied.

| Split | Rows | Features | Missing | Duplicate indices |
|---|---:|---:|---:|---:|
| VOC train | 18,819 | 3 | 0 | 0 |
| VOC test | 8,066 | 3 | 0 | 0 |
| TPHiS train | 22,865 | 21 | 0 | 0 |
| TPHiS test | 9,800 | 21 | 0 | 0 |

Very small spectral values around 5.88e-39 were retained rather than silently recoded to zero because the supplied metadata does not define a safe replacement.

Do not merge VOC and TPHiS using source_row_index. They are different subset constructions; overlapping index values do not prove row identity.

## AeroFresh limitations

This is external research data, not ESP32 telemetry. VOC uses TGS2620/TGS2602/SGP40, not MQ-135. TPHiS uses BME280 and spectrometry, not your DHT22/MQ-135. Neither set includes LDR events or buzzer states. Do not substitute these channels as if they were your board's sensor values.

Use the files for an offline banana-ripeness research experiment. Collect a separate dataset from your own banana bunch with your MQ-135, DHT22 and LDR, recording visual ripeness at fixed intervals. A model trained on Bath sensors must be independently validated before claiming it predicts from MQ-135.

The archive specifies a balanced random 70% train / 30% test split at sample level. Related time-adjacent observations from the same monitoring tests may occur in both subsets; treat scores as validation on the supplied split, not proof of generalization to a new banana bunch.

## Reproduce

```bash
python -m pip install -r requirements-data.txt
python scripts/preprocess_banana_data.py --voc-zip VOC.zip --tphis-zip TPHiS.zip --output-dir .
```

Fit any scaler only on training data inside a model pipeline. Never fit preprocessing on the entire dataset before evaluating the held-out test split.

## Citation

Callaghan, K., & Martinez Hernandez, U. (2025). Low-Cost, Multisensor Nondestructive Banana Ripeness Estimation Using Machine Learning. IEEE Sensors Journal, 25(5), 8797–8806. https://doi.org/10.1109/JSEN.2025.3528250

Dataset DOI: https://doi.org/10.15125/BATH-01459
