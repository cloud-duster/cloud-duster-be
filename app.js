import dotenv from "dotenv";
import cors from "cors";
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import express from "express";
import mongoose from "mongoose";
import Memory from "./models/Memory.js";
import PhotoStats from "./models/PhotoStats.js";

dotenv.config();

// MongoDB 연결 설정
const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MongoDB 연결 실패: MONGODB_URI가 설정되지 않았습니다.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Failed:', error.message);
    process.exit(1);
  }
};

// MongoDB 연결 실행
connectDB();

// MongoDB 연결 이벤트 리스너
mongoose.connection.on('error', (err) => {
  console.error('MongoDB Connection Error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB Disconnected. Trying Again...');
  connectDB();
});

const app = express();

// Cloudinary 설정
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.set("port", process.env.PORT || 3000);

// 파일 업로드를 위한 Multer 설정
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (_, file) => {
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueFileName = `${Date.now()}_${fileName}`;
    
    return {
      folder: 'images',
      allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
      public_id: uniqueFileName.replace(/\.[^/.]+$/, ''),
      resource_type: 'auto',
    };
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB 제한
});

// 기본 라우트
app.get("/", (_, res) => {
  res.json({ 
    message: "Server is running",
    database: mongoose.connection.readyState === 1 ? "MongoDB connected" : "MongoDB not connected"
  });
});

// 이미지 업로드 엔드포인트 (클라이언트에서 이미지 업로드 시 사용)
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.status(200).json({
      image_url: req.file.path,
      size: req.file.size
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Error uploading file to Cloudinary',
      details: error.message 
    });
  }
});

// 추억 저장하기
app.post("/memory", upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    
    const { nickname, message, location, size, amount = 1 } = req.body;
    
    if (!message || !location || size === undefined) {
      // Clean up the uploaded file if validation fails
      if (req.file && req.file.path) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['MOUNTAIN', 'SEA', 'SKY'].includes(location)) {
      // Clean up the uploaded file if validation fails
      if (req.file && req.file.path) {
        await cloudinary.uploader.destroy(req.file.filename);
      }
      return res.status(400).json({ error: 'Invalid location. Must be one of: MOUNTAIN, SEA, SKY' });
    }

    // Get the Cloudinary URL from the uploaded file
    const imageUrl = req.file.path;

    const memory = new Memory({
      nickname: nickname || '익명의 먼지',
      image_url: imageUrl,
      message,
      location,
      size: Number(size)
    });

    await memory.save();
    
    // Update photo stats
    try {
      const stats = await PhotoStats.getStats();
      stats.totalPhotoSize += Number(size) * Number(amount);
      stats.peopleCount = await Memory.distinct('nickname').countDocuments();
      // Increment deletedPhotoCount by the provided amount
      stats.deletedPhotoCount += Number(amount);
      await stats.save();
    } catch (statsError) {
      console.error('Error updating photo stats:', statsError);
      // Don't fail the request if stats update fails
    }
    
    res.status(201).json({ message: "Memory added" });
  } catch (error) {
    console.error('Error saving memory:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// 추억 불러오기 (페이지네이션 지원)
app.get("/memories", async (req, res) => {
  try {
    const { cursorId } = req.query;
    const limit = 10;
    
    let query = {};
    if (cursorId) {
      const cursorDoc = await Memory.findById(cursorId);
      if (cursorDoc) {
        query = {
          $or: [
            { createdAt: { $lt: cursorDoc.createdAt } },
            { 
              createdAt: cursorDoc.createdAt,
              _id: { $lt: cursorDoc._id }
            }
          ]
        };
      }
    }

    const memories = await Memory.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasNext = memories.length > limit;
    const items = hasNext ? memories.slice(0, -1) : memories;
    const nextCursor = hasNext ? {
      id: items[items.length - 1]._id,
      createdAt: items[items.length - 1].createdAt.toISOString()
    } : null;

    res.status(200).json({
      items: items.map(item => ({
        id: item._id,
        nickname: item.nickname,
        image_url: item.image_url,
        message: item.message,
        location: item.location,
        size: item.size,
        created_at: item.createdAt
      })),
      ...(nextCursor && { nextCursor })
    });
  } catch (error) {
    console.error('Error fetching memories:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get single memory by ID
app.get('/memories/:id', async (req, res) => {
  try {
    const memory = await Memory.findById(req.params.id);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    
    res.status(200).json({
      id: memory._id,
      nickname: memory.nickname,
      image_url: memory.image_url,
      message: memory.message,
      location: memory.location,
      size: memory.size,
      created_at: memory.createdAt
    });
  } catch (error) {
    console.error('Error fetching memory:', error);
    res.status(500).json({ error: 'Database error' });
  }
});


// Get cloud cleanup summary
app.get('/cloud-cleanup-summary', async (req, res) => {
  try {
    const stats = await PhotoStats.getStats();
    
    // Calculate average photo size
    const avgPhotoSize = stats.totalPhotoSize > 0 ? 
      stats.totalPhotoSize / (stats.deletedPhotoCount || 1) : 0;

    res.status(200).json({
      deletedPhotoCount: stats.deletedPhotoCount,
      peopleCount: stats.peopleCount,
      avgPhotoSize: parseFloat(avgPhotoSize.toFixed(2)),
      totalPhotoSize: stats.totalPhotoSize
    });
  } catch (error) {
    console.error('Error fetching cloud cleanup summary:', error);
    res.status(500).json({ error: '서버 에러' });
  }
});

// Delete memories older than 3 days
app.post('/batch/cleanup-old-memories', async (req, res) => {
  try {
    // Check Secret Key
    const providedSecret = req.headers['x-batch-secret'];
    if (providedSecret !== process.env.BATCH_JOB_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
    }
    
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    // Find and delete memories older than 3 days
    const result = await Memory.deleteMany({
      createdAt: { $lt: threeDaysAgo }
    });
    
    res.status(200).json({
      message: `Successfully deleted ${result.deletedCount} memories`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error in batch cleanup:', error);
    res.status(500).json({ error: 'Batch cleanup failed' });
  }
});

// 서버 시작
app.listen(app.get("port"), () => {
  console.log(`✅ 서버가 ${app.get("port")}번 포트에서 실행 중입니다.`);
  console.log(`📡 MongoDB 상태: ${mongoose.connection.readyState === 1 ? '연결됨' : '연결 안됨'}`);
});
