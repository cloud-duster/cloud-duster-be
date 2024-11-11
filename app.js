import dotenv from "dotenv";
dotenv.config();

import AWS from "@aws-sdk/client-s3";
import cors from "cors";
import express from "express";
import multer from "multer";
import multerS3 from "multer-s3";
import mysql from "mysql";
import { nanoid } from "nanoid";

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
const connection = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
})

connection.connect();

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.NCLOUD_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
      const fileId = nanoid();
      const type = file.mimetype.split("/")[1];
      const fileName = `${fileId}.${type}`;
      console.log(fileName);
      cb(null, fileName);
    },
    acl: "public-read", // 업로드된 파일의 접근 권한 설정
  }),
});

app.use(cors({ origin: '*' }));

app.set("port", process.env.PORT || 3000);

app.get("/", (req, res) => {
  res.send("Hello, Express");
});

// 파일 업로드 엔드포인트
app.post("/image", upload.single("image"), async (req, res) => {
  try {
    console.log("res", res);
    res.status(200).json({
      message: "File uploaded successfully!",
      fileLocation: req.file.location, // S3에 저장된 파일의 URL
    });
  } catch (error) {
    return res.status(400).send("No file uploaded.");
  }
});

app.listen(app.get("port"), () => {
  console.log(app.get("port"), "번 포트에서 대기 중");
});
