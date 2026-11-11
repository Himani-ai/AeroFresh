#!/usr/bin/env python3
"""Bath VOC research-only baseline. Not compatible with AeroFresh MQ-135."""
import argparse,json
from pathlib import Path
import pandas as pd
from sklearn.tree import DecisionTreeClassifier,export_text
from sklearn.metrics import accuracy_score,balanced_accuracy_score,classification_report,confusion_matrix
F=["TGS20","TGS02","SGP"]; N={1:"unripe",2:"ripe",3:"beyond_ripe",4:"overripe",5:"gone_off"}
def main():
 p=argparse.ArgumentParser(description=__doc__); p.add_argument("--train",type=Path,required=True); p.add_argument("--test",type=Path,required=True); p.add_argument("--out",type=Path,default=Path("tinyml/reports/voc_baseline")); a=p.parse_args()
 tr,te=pd.read_csv(a.train),pd.read_csv(a.test)
 for name,d in [("train",tr),("test",te)]:
  miss=set(F+["ripeness_stage_id"])-set(d.columns)
  if miss: raise ValueError(f"{name} missing {sorted(miss)}")
  if d[F+["ripeness_stage_id"]].isna().any().any(): raise ValueError(f"{name} has missing values")
 m=DecisionTreeClassifier(max_depth=4,min_samples_leaf=100,class_weight="balanced",random_state=42).fit(tr[F],tr.ripeness_stage_id.astype(int))
 y=te.ripeness_stage_id.astype(int); pred=m.predict(te[F]); a.out.mkdir(parents=True,exist_ok=True)
 r={"track":"research_only","dataset":"Bath VOC","features":F,"warning":"TGS2620/TGS2602/SGP40 are not MQ-135; do not flash on AeroFresh ESP32.","model":"DecisionTreeClassifier(max_depth=4,min_samples_leaf=100,class_weight=balanced)","train_rows":len(tr),"test_rows":len(te),"tree_depth":int(m.get_depth()),"leaf_count":int(m.get_n_leaves()),"accuracy":float(accuracy_score(y,pred)),"balanced_accuracy":float(balanced_accuracy_score(y,pred)),"classification_report":classification_report(y,pred,labels=[1,2,3,4,5],target_names=[N[i] for i in range(1,6)],output_dict=True,zero_division=0),"confusion_matrix_labels_1_to_5":confusion_matrix(y,pred,labels=[1,2,3,4,5]).tolist(),"tree":export_text(m,feature_names=F),"evaluation_note":"Supplied sample-level split; time-adjacent observations from the same test may appear in both train and test."}
 (a.out/"metrics.json").write_text(json.dumps(r,indent=2)); (a.out/"tree.txt").write_text(r["tree"]); print(json.dumps({k:r[k] for k in ["accuracy","balanced_accuracy","tree_depth","leaf_count"]},indent=2))
if __name__=="__main__": main()
