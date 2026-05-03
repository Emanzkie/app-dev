// routes/ml.js
// Purpose:
// - ML API endpoints for training models, checking status, making predictions
// - Uses the model_manager bridge to spawn Python processes
// - All training/model endpoints require admin auth
// - Prediction endpoint is available to any authenticated user

const express = require('express');
const router = express.Router();
const path = require('path');

const { authMiddleware, adminOnly } = require('../middleware/auth');
const TrainingDataset = require('../models/TrainingDataset');
const TrainedModel = require('../models/TrainedModel');
const modelManager = require('../ml/model_manager');
const sse = require('../sse');

/**
 * POST /api/ml/train-model
 * Triggers real ML training on a dataset.
 * Body: { datasetId: string }
 */
router.post('/train-model', authMiddleware, adminOnly, async (req, res) => {
  const { datasetId } = req.body;
  if (!datasetId) {
    return res.status(400).json({ error: 'datasetId is required.' });
  }

  try {
    // 1. Check Python environment first
    const envCheck = await modelManager.checkPythonEnvironment();
    if (!envCheck.ok) {
      return res.status(503).json({ error: envCheck.error });
    }

    // 2. Find the dataset
    const dataset = await TrainingDataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found.' });
    }

    if (dataset.status === 'training') {
      return res.status(409).json({ error: 'This dataset is already being trained.' });
    }

    // 3. Resolve dataset file on disk
    const datasetPath = modelManager.resolveDatasetPath(dataset.filePath);
    if (!datasetPath) {
      return res.status(404).json({
        error: `Dataset file not found on disk. Expected at: ${dataset.filePath}`,
      });
    }

    // 4. Mark dataset as training
    dataset.status = 'training';
    dataset.errorMessage = null;
    await dataset.save();

    // 5. Determine next model version
    const lastModel = await TrainedModel.findOne().sort({ version: -1 }).lean();
    const nextVersion = (lastModel?.version || 0) + 1;

    // 6. Create a placeholder TrainedModel doc
    const modelDoc = await TrainedModel.create({
      datasetId: dataset._id,
      version: nextVersion,
      modelPath: '',
      status: 'training',
      trainedBy: req.user.userId,
    });

    // Broadcast that training has started
    sse.broadcast('analytics:update', {
      type: 'ml',
      action: 'training_started',
      datasetId: String(dataset._id),
      modelVersion: nextVersion,
    });

    // 7. Respond immediately — training runs in the background
    res.json({
      success: true,
      message: 'Training started. Check model status for progress.',
      modelId: String(modelDoc._id),
      version: nextVersion,
    });

    // 8. Run training asynchronously
    try {
      const metrics = await modelManager.trainModel(datasetPath);

      // Update TrainedModel with results
      // Deactivate any previous active model
      await TrainedModel.updateMany({ isActive: true }, { $set: { isActive: false } });

      modelDoc.modelPath = metrics.model_path;
      modelDoc.accuracy = metrics.accuracy;
      modelDoc.precision = metrics.precision;
      modelDoc.recall = metrics.recall;
      modelDoc.f1Score = metrics.f1;
      modelDoc.featureImportances = metrics.feature_importances;
      modelDoc.perClassMetrics = metrics.per_class_metrics || {};
      modelDoc.classNames = metrics.class_names || [];
      modelDoc.featuresUsed = metrics.features_used || [];
      modelDoc.trainingSamples = metrics.training_samples;
      modelDoc.testSamples = metrics.test_samples;
      modelDoc.totalRows = metrics.total_rows || 0;
      modelDoc.rowsDropped = metrics.rows_dropped || 0;
      modelDoc.status = 'completed';
      modelDoc.isActive = true;
      await modelDoc.save();

      // Update dataset
      dataset.status = 'trained';
      dataset.trainedBy = req.user.userId;
      dataset.trainedAt = new Date();
      dataset.modelId = modelDoc._id;
      dataset.trainingMetrics = {
        accuracy: metrics.accuracy,
        precision: metrics.precision,
        recall: metrics.recall,
        f1: metrics.f1,
      };
      dataset.trainingSummary =
        `Model v${nextVersion} trained with ${metrics.accuracy * 100}% accuracy. ` +
        `${metrics.training_samples} training / ${metrics.test_samples} test samples. ` +
        `Risk categories: ${(metrics.class_names || []).join(', ')}.`;
      await dataset.save();

      sse.broadcast('analytics:update', {
        type: 'ml',
        action: 'training_completed',
        datasetId: String(dataset._id),
        modelVersion: nextVersion,
        accuracy: metrics.accuracy,
      });
    } catch (trainErr) {
      // Training failed — update records
      console.error('ML training failed:', trainErr.message);
      modelDoc.status = 'failed';
      modelDoc.errorMessage = trainErr.message;
      await modelDoc.save();

      dataset.status = 'failed';
      dataset.errorMessage = trainErr.message;
      dataset.trainingSummary = `Training failed: ${trainErr.message}`;
      await dataset.save();

      sse.broadcast('analytics:update', {
        type: 'ml',
        action: 'training_failed',
        datasetId: String(dataset._id),
        error: trainErr.message,
      });
    }
  } catch (err) {
    console.error('ML train-model endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ml/model-status
 * Returns the currently active model's info and metrics.
 */
router.get('/model-status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const activeModel = await TrainedModel.findOne({ isActive: true })
      .populate('trainedBy', 'firstName lastName')
      .lean();

    if (!activeModel) {
      return res.json({
        success: true,
        hasActiveModel: false,
        model: null,
      });
    }

    res.json({
      success: true,
      hasActiveModel: true,
      model: {
        id: String(activeModel._id),
        version: activeModel.version,
        accuracy: activeModel.accuracy,
        precision: activeModel.precision,
        recall: activeModel.recall,
        f1Score: activeModel.f1Score,
        featureImportances: activeModel.featureImportances,
        perClassMetrics: activeModel.perClassMetrics,
        classNames: activeModel.classNames,
        featuresUsed: activeModel.featuresUsed,
        trainingSamples: activeModel.trainingSamples,
        testSamples: activeModel.testSamples,
        totalRows: activeModel.totalRows,
        status: activeModel.status,
        trainedBy: activeModel.trainedBy
          ? `${activeModel.trainedBy.firstName} ${activeModel.trainedBy.lastName}`
          : 'Admin',
        createdAt: activeModel.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ml/predict
 * Predicts risk category for a set of assessment scores.
 * Body: { communication_score, social_score, cognitive_score, motor_score, overall_score, age_months?, gender? }
 */
router.post('/predict', authMiddleware, async (req, res) => {
  try {
    const activeModel = await TrainedModel.findOne({ isActive: true, status: 'completed' }).lean();

    if (!activeModel || !activeModel.modelPath) {
      return res.status(404).json({
        error: 'No active trained model available. Using rule-based recommendations.',
        fallback: true,
      });
    }

    // Resolve model path (it may be stored as a relative unix-style path)
    let modelPath = activeModel.modelPath;
    if (!path.isAbsolute(modelPath)) {
      modelPath = path.join(__dirname, '..', modelPath);
    }
    // Normalise forward slashes to the OS separator
    modelPath = path.normalize(modelPath);

    const scores = {
      communication_score: req.body.communication_score,
      social_score: req.body.social_score,
      cognitive_score: req.body.cognitive_score,
      motor_score: req.body.motor_score,
      overall_score: req.body.overall_score,
    };

    // Optional fields
    if (req.body.age_months != null) scores.age_months = req.body.age_months;
    if (req.body.gender != null) scores.gender = req.body.gender;

    const prediction = await modelManager.predict(modelPath, scores);

    res.json({
      success: true,
      risk_category: prediction.risk_category,
      consultation_needed: prediction.consultation_needed,
      probabilities: prediction.probabilities,
      model_version: activeModel.version,
    });
  } catch (err) {
    console.error('ML predict error:', err.message);
    res.status(500).json({ error: err.message, fallback: true });
  }
});

/**
 * GET /api/ml/models
 * Lists all trained model versions with metrics and status.
 */
router.get('/models', authMiddleware, adminOnly, async (req, res) => {
  try {
    const models = await TrainedModel.find()
      .sort({ version: -1 })
      .populate('trainedBy', 'firstName lastName')
      .populate('datasetId', 'name originalName')
      .lean();

    res.json({
      success: true,
      models: models.map((m) => ({
        id: String(m._id),
        version: m.version,
        datasetName: m.datasetId?.name || 'Unknown',
        accuracy: m.accuracy,
        precision: m.precision,
        recall: m.recall,
        f1Score: m.f1Score,
        perClassMetrics: m.perClassMetrics,
        classNames: m.classNames,
        trainingSamples: m.trainingSamples,
        testSamples: m.testSamples,
        totalRows: m.totalRows,
        status: m.status,
        isActive: m.isActive,
        trainedBy: m.trainedBy
          ? `${m.trainedBy.firstName} ${m.trainedBy.lastName}`
          : 'Admin',
        errorMessage: m.errorMessage || null,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
