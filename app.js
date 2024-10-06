import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import multer from "multer";
import { nanoid } from "nanoid";
import cors from "cors";
import mysql from "mysql";
import sharp from "sharp";
import heicConvert from "heic-convert";

const app = express();

// 이미지 저장을 위한 object storage 연동
// const s3 = new AWS.S3({
const s3 = new S3Client({
  credentials: {
    accessKeyId: process.env.NCLOUD_ACCESS_KEY,
    secretAccessKey: process.env.NCLOUD_SECRET_ACCESS_KEY,
  },
  endpoint: process.env.NCLOUD_S3_ENDPOINT,
  region: "kr-standard",
  s3ForcePathStyle: true,
  signatureVersion: "v4",
});

const storage = multer.memoryStorage();
const upload = multer({storage: storage});

// 데이터 저장을 위한 mysql 연결
const db = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

db.connect(err => {
  if (err) {
    console.error('Error connectiong to the database: ', err);
    return;
  }
  console.log('Connected to the MySQL server.');
});

// TODO: 시간은 점점 늘려가서 적절한 시간을 찾을 것
// 주기적으로 dummy query 실행(예시: 10분마다) 
setInterval(() => {
  db.query('SELECT 1', (err, results) => {
    if (err) {
      console.error('Error sending keep-alive query: ', err);
    } else {
      console.log('Keep-alive query successful: ', results);
    }
  });
}, 600000); // 600000 밀리초 = 10분

app.use(cors());

app.set("port", process.env.PORT || 3000);

app.get("/", (req, res) => {
  res.send("Hello, Express");
});

// 추억 보내기(저장하기)
app.post("/memory", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({msg: 'No file uploaded'}); 
  }

  const nickname = req.body.nickname;
  const message = req.body.message;
  const location = req.body.location;
  const size = req.body.size;

  const fileId = nanoid();
  const type = req.file.mimetype.split("/")[1];
  const fileName = `${fileId}.${type}`;

  try {
    let imageBuffer;

    if (type === 'png' || type === 'jpeg' || type === 'jpg') imageBuffer = req.file.buffer;
    else {
      console.log("heic")
      imageBuffer = await heicConvert({
        buffer: req.file.buffer,
        format: 'JPEG',
        quality: 0.8  // JPEG 품질 조정
      });      
    }

    // Sharp로 이미지 크기 줄이기 및 압축
    // await를 사용하여, 이미지가 처리될 때까지 기다림 
    const compressedImageBuffer = await sharp(imageBuffer)
      .resize(800) // 이미지 너비 800px로 조정
      .jpeg({quality: 80})  // JPEG 포맷으로 압축
      .toBuffer();
    
    // S3에 업로드하기 위한 파라미터 설정
    const uploadParams = {
      Bucket: process.env.NCLOUD_BUCKET_NAME,
      Key: fileName,
      Body: compressedImageBuffer,
      ContentType: 'JPEG',
      ACL: "public-read", // 업로드된 파일의 접근 권한 설정
    };

    const command = new PutObjectCommand(uploadParams);

    // 업로드 진행
    const data = await s3.send(command);

    const imageUrl = `https://${process.env.NCLOUD_BUCKET_NAME}.kr.object.ncloudstorage.com/${fileName}`

    const sql = 'INSERT INTO memory (nickname, image_url, message, location, size) VALUES (?, ?, ?, ?, ?)';
    db.query(sql, [nickname, imageUrl, message, location, size], (err) => {
      if(err) {
        return res.status(500).json({msg: 'Database error', error: err});
      }
      res.status(201).json({msg: 'Memory added'});
    });
  } catch (error) {
    return res.status(500).json({msg: 'Error uploading image to S3', error: error.message}) 
  }
});

// 모든 추억 불러오기
app.get("/memories", async(req, res) => {
  const {location, date, cursorCreatedAt, cursorId, limit = 10} = req.query;

  let sql = `SELECT * FROM memory WHERE 1=1`; // 기본적으로 true인 조건 추가
  let params = [];

  if (date) {
    if (date === 'TODAY') {
      sql += ` AND created_at >= CURDATE()`;
    } else if (date === 'YESTERDAY') {
      sql += ` AND created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND created_at < CURDATE()`;
    } else if (date === 'DBY') {
      sql += ` AND created_at >= DATE_SUB(CURDATE(), INTERVAL 2 DAY) AND created_at < DATE_SUB(CURDATE(), INTERVAL 1 DAY)`;
    }
  }
  
  if (location) {
    sql += ` AND location = ?`;
    params.push(location);
  } 

  if (cursorCreatedAt && cursorId) {
    sql += ` WHERE (created_at = ? AND id < ?)`;
    params.push(cursorCreatedAt, cursorId); 
  }

  sql += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(parseInt(limit));

  db.query(sql, params, (error, results) => {
    if (error) {
      return res.status(500).send('Database error');
    }
       
    const nextCursor = results.length ? {
      createdAt: results[results.length - 1].created_at, 
      id: results[results.length - 1].id
    } : null;

    res.json({
      items: results,
      nextCursor    
    });
  });
});

// 개별 추억 불러오기
app.get("/memories/:id", (req, res) => {
  const id = req.params.id;

  const sql = 'SELECT * FROM memory WHERE id = ?';
  db.query(sql, [parseInt(id)], (error, result) => {
    if (error) {
      console.error(error);
      return res.status(500).send('Database error');
    }

    res.json({
      result
    });
  });
});

app.listen(app.get("port"), () => {
  console.log(app.get("port"), "번 포트에서 대기 중");
});
