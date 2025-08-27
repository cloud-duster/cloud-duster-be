import mongoose from 'mongoose';

const memorySchema = new mongoose.Schema({
  nickname: {
    type: String,
    required: true
  },
  image_url: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  location: {
    type: String,
    enum: ['MOUNTAIN', 'SEA', 'SKY'],
    required: true
  },
  size: {
    type: Number,
    required: true
  }
}, {
  timestamps: true,
  versionKey: false
});

export default mongoose.model('Memory', memorySchema);
