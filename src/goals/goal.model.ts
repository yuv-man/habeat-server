import mongoose, { Schema } from 'mongoose';
import { IGoal } from '../types/interfaces';

const goalSchema = new Schema({
    id: { type: mongoose.Schema.Types.ObjectId, required: true, default: new mongoose.Types.ObjectId() },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    goal: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    targetDate: { type: Date, required: true },
    startDate: { type: Date, required: true },
    progress: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, enum: ['active', 'completed', 'archived', 'deleted'] },
    target: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Goal = mongoose.model<IGoal>('Goal', goalSchema);

export { Goal };