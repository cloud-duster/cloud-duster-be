import mongoose from 'mongoose';

const photoStatsSchema = new mongoose.Schema({
  deletedPhotoCount: {
    type: Number,
    default: 0,
    required: true
  },
  peopleCount: {
    type: Number,
    default: 0,
    required: true
  },
  totalPhotoSize: {
    type: Number,
    default: 0,
    required: true
  }
}, {
  versionKey: false
});

photoStatsSchema.statics.getStats = async function() {
  let stats = await this.findOne();
  if (!stats) {
    stats = await this.create({ 
      deletedPhotoCount: 0,
      peopleCount: 0,
      totalPhotoSize: 0
    });
  }
  return stats;
};

export default mongoose.model('PhotoStats', photoStatsSchema);
