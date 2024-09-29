import dotenv from "dotenv";
dotenv.config();

import express from "express";
import AWS from "@aws-sdk/client-s3";
import multer from "multer";
import multerS3 from "multer-s3";
import { nanoid } from "nanoid";
import cors from "cors";
import mysql from "mysql";

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

db.connect();

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

  const sql = 'INSERT INTO memory (nickname, image_url, message, location, size) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [nickname, imageUrl, message, location, size], (err) => {
    if(err) {
      return res.status(500).json({msg: 'Database error', error: err});
    }
    res.status(201).json({msg: 'Memory added'});
  });
});

app.get("/memories", async(req, res) => {
  const {cursorCreatedAt, cursorId, limit = 10} = req.query;

  let sql = `SELECT * FROM memory`;
  let params = [];
  
  if (cursorCreatedAt && cursorId) {
    sql += ` WHERE (created_at = ? AND id < ?)`;
    params.push(cursorCreatedAt, cursorId); 
  }

  sql += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(parseInt(limit));


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

app.listen(app.get("port"), () => {
  console.log(app.get("port"), "번 포트에서 대기 중");
});
