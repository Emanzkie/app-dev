"""
KinderCura ML Trainer
=====================
Trains a RandomForestClassifier on uploaded screening datasets to predict
risk categories (Low / Medium / High) for child developmental assessments.

Usage:
    python ml/trainer.py --input <dataset_path> --output <model_dir>

Exit codes:
    0  Training completed successfully  (metrics JSON on stdout)
    1  Training failed                  (error  JSON on stdout)
"""

import argparse
import json
import os
import sys
import traceback
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

# ── Column configuration ────────────────────────────────────────────────
REQUIRED_SCORE_COLUMNS = [
    "communication_score",
    "social_score",
    "cognitive_score",
    "motor_score",
    "overall_score",
]

OPTIONAL_COLUMNS = ["age_months", "gender"]

# The target we want to predict.  We accept either a pre-labelled
# "risk_category" column (Low / Medium / High) **or** a numeric
# "consultation_needed" column (0/1) that we map to risk levels using the
# overall_score when available.
TARGET_COLUMN = "risk_category"
FALLBACK_TARGET = "consultation_needed"


# ── Helpers ──────────────────────────────────────────────────────────────
def fail(message: str):
    """Print an error payload and exit with code 1."""
    print(json.dumps({"success": False, "error": message}))
    sys.exit(1)


def derive_risk_category(row):
    """Derive a risk category from individual scores when no explicit label
    exists.  Uses the same thresholds the Node.js rule-based engine uses
    (≥70 → Low, 40-69 → Medium, <40 → High) applied to the *lowest*
    domain score so a single weak area can flag the child."""
    scores = [
        row.get("communication_score", 100),
        row.get("social_score", 100),
        row.get("cognitive_score", 100),
        row.get("motor_score", 100),
    ]
    minimum = min(scores)
    if minimum < 40:
        return "High"
    if minimum < 70:
        return "Medium"
    return "Low"


def load_dataset(filepath: str) -> pd.DataFrame:
    """Load a CSV or JSON dataset from *filepath* and return a DataFrame."""
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".json":
        return pd.read_json(filepath)
    if ext == ".csv":
        return pd.read_csv(filepath)
    fail(f"Unsupported file extension '{ext}'. Only .csv and .json are accepted.")
    return pd.DataFrame()  # unreachable – keeps linters happy


def validate_columns(df: pd.DataFrame):
    """Ensure every required score column is present in *df*."""
    # Accept both snake_case and camelCase column names from the JS world.
    rename_map = {
        "communicationScore": "communication_score",
        "socialScore": "social_score",
        "cognitiveScore": "cognitive_score",
        "motorScore": "motor_score",
        "overallScore": "overall_score",
        "ageMonths": "age_months",
        "consultationNeeded": "consultation_needed",
        "riskCategory": "risk_category",
    }
    df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns}, inplace=True)

    missing = [c for c in REQUIRED_SCORE_COLUMNS if c not in df.columns]
    if missing:
        fail(
            f"Dataset is missing required columns: {', '.join(missing)}. "
            f"Expected columns: {', '.join(REQUIRED_SCORE_COLUMNS)}"
        )


def prepare_features(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Build the feature matrix X and target vector y.

    Strict validation: rows with *any* missing critical score are dropped
    entirely – we never train on incomplete health data.
    """
    # ── 1. Ensure target exists ──────────────────────────────────────────
    if TARGET_COLUMN in df.columns:
        df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(str).str.strip().str.title()
        valid_labels = {"Low", "Medium", "High"}
        df = df[df[TARGET_COLUMN].isin(valid_labels)].copy()
        if df.empty:
            fail("No valid risk_category labels found. Expected: Low, Medium, High.")
    elif FALLBACK_TARGET in df.columns:
        # Derive risk category from scores + consultation_needed
        df[TARGET_COLUMN] = df.apply(derive_risk_category, axis=1)
    else:
        # Derive purely from scores
        df[TARGET_COLUMN] = df.apply(derive_risk_category, axis=1)

    # ── 2. Drop rows with missing critical scores ────────────────────────
    before = len(df)
    df = df.dropna(subset=REQUIRED_SCORE_COLUMNS).copy()
    after = len(df)
    if after == 0:
        fail("All rows have missing critical score values. Cannot train.")
    if after < 10:
        fail(
            f"Only {after} valid rows after removing incomplete data. "
            "At least 10 rows are needed for a meaningful model."
        )
    dropped = before - after
    # (we log dropped count in metadata but don't fail)

    # ── 3. Build feature columns ─────────────────────────────────────────
    feature_cols = list(REQUIRED_SCORE_COLUMNS)  # always present

    if "age_months" in df.columns:
        df["age_months"] = pd.to_numeric(df["age_months"], errors="coerce")
        if df["age_months"].notna().sum() > 0:
            df["age_months"] = df["age_months"].fillna(df["age_months"].median())
            feature_cols.append("age_months")

    if "gender" in df.columns:
        le = LabelEncoder()
        df["gender_encoded"] = le.fit_transform(df["gender"].astype(str).str.lower().str.strip())
        feature_cols.append("gender_encoded")

    X = df[feature_cols].astype(float)
    y = df[TARGET_COLUMN]

    return X, y, feature_cols, dropped


# ── Main training routine ────────────────────────────────────────────────
def train(input_path: str, output_dir: str):
    # Load & validate
    df = load_dataset(input_path)
    validate_columns(df)
    X, y, feature_cols, rows_dropped = prepare_features(df)

    # Encode target labels → integers for the classifier
    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y)
    class_names = list(label_encoder.classes_)  # e.g. ['High', 'Low', 'Medium']

    # Train/test split
    test_size = 0.2
    if len(X) < 20:
        test_size = 0.3  # slightly more test data for tiny datasets

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_encoded, test_size=test_size, random_state=42, stratify=y_encoded
    )

    # Train
    clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=None,
        min_samples_split=2,
        random_state=42,
        class_weight="balanced",  # handle imbalanced risk categories
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    # Evaluate
    y_pred = clf.predict(X_test)
    accuracy = float(accuracy_score(y_test, y_pred))
    precision = float(precision_score(y_test, y_pred, average="weighted", zero_division=0))
    recall = float(recall_score(y_test, y_pred, average="weighted", zero_division=0))
    f1 = float(f1_score(y_test, y_pred, average="weighted", zero_division=0))

    # Feature importances
    importances = dict(zip(feature_cols, [round(float(v), 4) for v in clf.feature_importances_]))

    # Save model artifact (includes the classifier + label encoder + feature list)
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    model_filename = f"kindercura_model_{timestamp}.joblib"
    model_path = os.path.join(output_dir, model_filename)

    artifact = {
        "classifier": clf,
        "label_encoder": label_encoder,
        "feature_columns": feature_cols,
        "class_names": class_names,
    }
    joblib.dump(artifact, model_path)

    # Build per-class report for the admin UI
    report = classification_report(y_test, y_pred, target_names=class_names, output_dict=True, zero_division=0)
    per_class = {}
    for cls_name in class_names:
        if cls_name in report:
            per_class[cls_name] = {
                "precision": round(report[cls_name]["precision"], 4),
                "recall": round(report[cls_name]["recall"], 4),
                "f1": round(report[cls_name]["f1-score"], 4),
                "support": int(report[cls_name]["support"]),
            }

    # Output metrics as JSON on stdout for the Node.js bridge
    result = {
        "success": True,
        "model_path": model_path.replace("\\", "/"),
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "feature_importances": importances,
        "per_class_metrics": per_class,
        "class_names": class_names,
        "training_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "total_rows": int(len(X)),
        "rows_dropped": int(rows_dropped),
        "features_used": feature_cols,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    print(json.dumps(result))


# ── CLI entry point ──────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KinderCura ML Trainer")
    parser.add_argument("--input", required=True, help="Path to the dataset file (CSV or JSON)")
    parser.add_argument("--output", required=True, help="Directory to save the trained model")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        fail(f"Input file not found: {args.input}")

    try:
        train(args.input, args.output)
    except SystemExit:
        raise
    except Exception as exc:
        # Catch-all: never let the trainer crash without a parseable message
        print(json.dumps({
            "success": False,
            "error": f"Training failed: {exc}",
            "traceback": traceback.format_exc(),
        }))
        sys.exit(1)
