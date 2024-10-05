import dotenv from "dotenv";
dotenv.config();

import express from "express";
import AWS from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import { nanoid } from "nanoid";
import cors from "cors";
import mysql from "mysql";
import heicConvert from "heic-convert";

const app = express();

// 이미지 저장을 위한 object storage 연동
const s3 = new AWS.S3({
  credentials: {
    accessKeyId: process.env.NCLOUD_ACCESS_KEY,
    secretAccessKey: process.env.NCLOUD_SECRET_ACCESS_KEY,
  },
  endpoint: process.env.NCLOUD_S3_ENDPOINT,
  region: "kr-standard",
  s3ForcePathStyle: true,
  signatureVersion: "v4",
});

// 데이터 저장을 위한 mysql 연결
const db = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
})

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

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.NCLOUD_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
      const fileId = nanoid();
      const type = file.mimetype.split("/")[1];
      const fileName = `${fileId}.${type}`;
      cb(null, fileName);
    },
    acl: "public-read", // 업로드된 파일의 접근 권한 설정
  }),
});

app.use(cors());

app.set("port", process.env.PORT || 3000);

app.get("/", (req, res) => {
  res.send("Hello, Express");
});

// 추억 보내기(저장하기)
app.post("/memory", upload.single("image"), (req, res) => {
  const nickname = req.body.nickname;
  const imageUrl = req.file.location;
  const message = req.body.message;
  const location = req.body.location;
  const size = req.body.size;

    if (type === 'png' || type === 'jpeg' || type === 'jpg') imageBuffer = req.file.buffer;
    else {
      console.log("heic")
      imageBuffer = await heicConvert({
        buffer: req.file.buffer,
        format: 'JPEG',
        quality: 0.8  // JPEG 품질 조정
      });      
    }
  const sql = 'INSERT INTO memory (nickname, image_url, message, location, size) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [nickname, imageUrl, message, location, size], (err) => {
    if(err) {
      return res.status(500).json({msg: 'Database error', error: err});
    }
    res.status(201).json({msg: 'Memory added'});
  });
});

// 모든 추억 불러오기
app.get("/memories", async(req, res) => {
  const {location, cursorCreatedAt, cursorId, limit = 10} = req.query;

  let sql = `SELECT * FROM memory`;
  let params = [];
  
  if (location) {
    console.log("location: ", location)
    if (cursorCreatedAt && cursorId) {
      sql += ` WHERE (created_at = ? AND id < ?)`;
      params.push(cursorCreatedAt, cursorId); 
    }
  
    sql += ` WHERE location = ? ORDER BY created_at DESC, id DESC LIMIT ?`;
    params.push(location, parseInt(limit));    
  }

  else {
    if (cursorCreatedAt && cursorId) {
      sql += ` WHERE (created_at = ? AND id < ?)`;
      params.push(cursorCreatedAt, cursorId); 
    }

    sql += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
    params.push(parseInt(limit));
  }

  db.query(sql, params, (error, results) => {
    if (error) {
      console.error(error);
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
