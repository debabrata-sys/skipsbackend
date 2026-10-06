const multer=require('multer');
const aws=require('aws-sdk');
const multerS3=require('multer-s3');
aws.config.update({
  accessKey: process.env.AWS_ACCESS_KEY_ID, // process.env.AWS_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // process.env.AWS_SECRET_ACCESS_KEY || "",
  region: 'us-east-2'
});

const s3=new aws.S3({});

exports.upload = multer({
  storage: multerS3({
      s3: s3,
      bucket: 'campustech1',
      key: function (req, file, cb) {
          //console.log(file);
          cb(null, Date.now().toString() + '-' + file.originalname); //use Date.now() for unique file keys
      }
  })
});