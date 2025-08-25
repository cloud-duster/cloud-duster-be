import dotenv from "dotenv";
import cors from "cors";
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import express from "express";
import mongoose from "mongoose";
import Memory from "./models/Memory.js";

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
app.post("/memory", async (req, res) => {
  try {
    const { nickname, image, text, location, size } = req.body;
    
    if (!nickname || !image || !text || !location || size === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['MOUNTAIN', 'SEA', 'SKY'].includes(location)) {
      return res.status(400).json({ error: 'Invalid location. Must be one of: MOUNTAIN, SEA, SKY' });
    }

    const memory = new Memory({
      nickname,
      image_url: image,
      message: text,
      location,
      size: Number(size)
    });

    await memory.save();
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

// 서버 시작
app.listen(app.get("port"), () => {
  console.log(`✅ 서버가 ${app.get("port")}번 포트에서 실행 중입니다.`);
  console.log(`📡 MongoDB 상태: ${mongoose.connection.readyState === 1 ? '연결됨' : '연결 안됨'}`);
});
