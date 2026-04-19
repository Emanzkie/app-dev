// QuestionSet model
// Groups multiple custom questions created together in one session/batch
// Allows pediatricians to assign multiple questions at once to a child

const mongoose = require('mongoose');
const Counter = require('./Counter');

// Schema definition for a question set (batch)
const questionSetSchema = new mongoose.Schema(
    {
        // Numeric id for easy frontend reference
        id: { type: Number, unique: true, index: true },
        pediatricianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        title: { type: String, trim: true, default: 'Question Set' },
        description: { type: String, trim: true, default: '' },
        // Total number of questions in this set at creation time
        questionCount: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true, collection: 'questionsets' }
);

questionSetSchema.pre('validate', async function (next) {
    if (!this.isNew || this.id != null) return next();
    try {
        const counter = await Counter.findOneAndUpdate(
            { _id: 'question_sets' },
            { $inc: { seq: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        this.id = counter.seq;
        next();
    } catch (err) {
        next(err);
    }
});

module.exports = mongoose.models.QuestionSet || mongoose.model('QuestionSet', questionSetSchema);