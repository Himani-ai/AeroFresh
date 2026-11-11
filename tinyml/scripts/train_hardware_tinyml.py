#!/usr/bin/env python3
"""Train a compact ESP32 decision tree from AeroFresh labelled sensor CSV."""
import argparse,json
from pathlib import Path
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from sklearn.tree import DecisionTreeClassifier,export_text
from sklearn.metrics import accuracy_score,balanced_accuracy_score,classification_report,confusion_matrix
F=["mq135_adc","temperature_c","humidity_pct","ldr_adc"]; REQ=F+["stage_id","banana_id","session_id"]; N={1:"unripe",2:"ripe",3:"beyond_ripe",4:"overripe",5:"gone_off"}
def emit(m,node,indent=2):
 pad=" "*indent
 if m.tree_.feature[node]<0: return pad+f"return {int(m.classes_[m.tree_.value[node][0].argmax()])};"
 f=int(m.tree_.feature[node]); t=float(m.tree_.threshold[node])
 return pad+f"if (x[{f}] <= {t:.9g}f) {{\n"+emit(m,m.tree_.children_left[node],indent+2)+"\n"+pad+"} else {\n"+emit(m,m.tree_.children_right[node],indent+2)+"\n"+pad+"}"
def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument("--csv",type=Path,required=True); p.add_argument("--out",type=Path,default=Path("tinyml/firmware")); p.add_argument("--report",type=Path,default=Path("tinyml/reports/hardware_metrics.json")); p.add_argument("--max-depth",type=int,default=4); p.add_argument("--min-leaf",type=int,default=15); a=p.parse_args()
 d=pd.read_csv(a.csv); miss=set(REQ)-set(d.columns)
 if miss: raise ValueError(f"Missing columns: {sorted(miss)}")
 d=d.dropna(subset=REQ).copy(); d.stage_id=d.stage_id.astype(int)
 if not set(d.stage_id.unique()).issubset(N): raise ValueError("stage_id must be 1..5")
 if d.banana_id.nunique()<2: raise ValueError("Need at least 2 independent banana_id groups for held-out evaluation.")
 ix,jx=next(GroupShuffleSplit(n_splits=1,test_size=.25,random_state=42).split(d[F],d.stage_id,groups=d.banana_id.astype(str))); tr,te=d.iloc[ix],d.iloc[jx]
 if tr.stage_id.nunique()<2 or te.stage_id.nunique()<2: raise ValueError("Group split has too few classes; collect more independent banana groups.")
 m=DecisionTreeClassifier(max_depth=a.max_depth,min_samples_leaf=a.min_leaf,class_weight="balanced",random_state=42).fit(tr[F],tr.stage_id); y=te.stage_id; pred=m.predict(te[F])
 a.out.mkdir(parents=True,exist_ok=True); a.report.parent.mkdir(parents=True,exist_ok=True)
 h="// Generated file; only train on labelled AeroFresh board data.\n#pragma once\n#include <stdint.h>\n// Feature order: MQ135 ADC, DHT22 temp C, DHT22 humidity %, LDR ADC.\nstatic inline uint8_t aerofresh_predict_stage(int mq135_adc,float temperature_c,float humidity_pct,int ldr_adc){\n const float x[4]={(float)mq135_adc,temperature_c,humidity_pct,(float)ldr_adc};\n"+emit(m,0)+"\n}\n"
 (a.out/"aerofresh_model.h").write_text(h)
 r={"track":"hardware_specific","features":F,"labels":N,"rows_total":len(d),"train_rows":len(tr),"test_rows":len(te),"banana_groups_total":int(d.banana_id.nunique()),"train_banana_groups":int(tr.banana_id.nunique()),"test_banana_groups":int(te.banana_id.nunique()),"tree_depth":int(m.get_depth()),"leaf_count":int(m.get_n_leaves()),"accuracy":float(accuracy_score(y,pred)),"balanced_accuracy":float(balanced_accuracy_score(y,pred)),"classification_report":classification_report(y,pred,labels=[1,2,3,4,5],target_names=[N[i] for i in range(1,6)],output_dict=True,zero_division=0),"confusion_matrix_labels_1_to_5":confusion_matrix(y,pred,labels=[1,2,3,4,5]).tolist(),"limitation":"Requires real labelled ESP32 readings; group-held-out metrics can be unstable with few independent bananas."}
 a.report.write_text(json.dumps(r,indent=2)); (a.out/"hardware_tree.txt").write_text(export_text(m,feature_names=F)); print(json.dumps({k:r[k] for k in ["rows_total","banana_groups_total","accuracy","balanced_accuracy","tree_depth","leaf_count"]},indent=2))
if __name__=="__main__": main()
