'use strict';

const express = require('express'),
      mariadb = require('mariadb'),
      bodyParser = require('body-parser'),
      morgan = require('morgan'),
      Queue = require('bull');

const config = require('./environment');

const STATUS = {
  EMPTY: 0,
  PREPARE: 1,
  PENDING: 2,
  COMPLETE: 3,
  ERROR: 5
};

const pool = mariadb.createPool({
  host: config.DB.host,
  port: config.DB.port,
  user: config.DB.user,
  password: config.DB.password,
  database: config.DB.database
});

const app = express();
const REDIS_URL = `redis://${config.REDIS_HOST}:${config.REDIS_PORT}`;
const queueNames = ['RequestTx', 'PendingTx'];

const reqQueue = new Queue(queueNames[0], REDIS_URL);

app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(require('method-override')());

// 기본 Port는 50080
const port = process.env.PORT || 50080;

let router = express.Router();
router.use((req, res, next) => {
  // For Log
  // console.log(req.host, req.port, req.url);
  next();
});

// 전송을 요청했을때에 해당 요청에 문제가 없는지 판단
const validateRequest = async (body) => {
  return new Promise(async (resolve, reject) => {
    try {
      let dbconn, rows;
      dbconn = await pool.getConnection();
      for (let i=0; i<body.length; i++) {
        rows = await dbconn.query('SELECT * FROM wallet_send_list WHERE no=?', [body[i].dbid]);
        // 요청한 내용이 DB에 저장되어 있지 않다면 오류를 발생
        if (!rows.length) {
          dbconn.end();
          return reject(new Error(`dbid(${body[i].dbid}) was not found`));
        }

        // DB의 status의 값이 기본이 아니면 오류 발생
        if (rows[0].status != STATUS.EMPTY) {
          dbconn.end();
          return reject(new Error(`dbid(${body[i].dbid}) status is not EMPTY(status:${rows[0].status})`));
        }

        // DB에 이미 TXID가 존재하면 오류 발생
        if (rows[0].txid) {
          dbconn.end();
          return reject(new Error(`dbid(${body[i].dbid}) status already has txid(${rows[0].txid})`));
        }
      }
      dbconn.end();
    } catch (err) {
      if (dbconn) dbconn.end();
      return reject(err);
    }
    resolve(body.length);
  });
};

// 전송내역을 전달
router.route('/transfer')
.post(async (req, res) => {
  let job;
  let joblist=[];
  if (!req.body.length) {
    return res.status(500).json({
      Error: 'Data format are wrong!'
    });
  }

  try {
    await validateRequest(req.body);
  } catch(err) {
    return res.status(500).json({
      Error: err.message,
    });
  }

  for (var i=0; i<req.body.length; i++) {
    // reqQueue에 내역을 입력
    job = await reqQueue.add(req.body[i]);
    joblist.push(job.id);
  }

  return res.status(201).json({
    message: `create new queues(len: ${req.body.length})`,
    joblist: joblist.toString(),
    data: req.body
  });
})

// :id - DB에 저장된 PrimaryKey
router.route('/request/:id')
.get(async (req, res) => {
  // DB에 저장된 내역을 확인
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    rows = await dbconn.query('SELECT * FROM wallet_send_list WHERE no=?', [req.params.id]);
    dbconn.end();
    if (!rows.length) {
      return res.status(404).json({ Error: `The request(no:${req.params.id}) was not found.` });
    }
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json(rows[0]);
})
.put(async (req, res) => {
  // DB에 저장된 내역을 변경
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    delete req.body.no;
    const columns = Object.keys(req.body);
    const values = Object.values(req.body);
    values.push(req.params.id);
    const sql = "UPDATE wallet_send_list SET " + columns.join("=?, ") + "=? WHERE no=?";
    rows = await dbconn.query(sql, values);
    dbconn.end();
    if (!rows.affectedRows) {
      return res.status(404).json({ Error: `The request(no:${req.params.id}) was not found.` });
    }
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json({ message: 'OK' });
});

// DB에 저장된 모든 내역을 출력
router.route('/tx')
.get(async (req, res) => {
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    rows = await dbconn.query('SELECT * FROM wallet_send_list');
    dbconn.end();
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json(rows);
})

// Pending중인 TX 목록
router.route('/tx/pending')
.get(async (req, res) => {
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    rows = await dbconn.query('SELECT * FROM wallet_send_list WHERE txid != "" and status=?', [STATUS.PENDING]);
    dbconn.end();
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json(rows);
})

// Error TX 목록
router.route('/tx/error')
.get(async (req, res) => {
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    rows = await dbconn.query('SELECT * FROM wallet_send_list WHERE txid != "" and status=?', [STATUS.ERROR]);
    dbconn.end();
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json(rows);
})

router.route('/tx/:hash')
.get(async (req, res) => {
  // TXID를 기준으로 DB에 저장된 내역
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    rows = await dbconn.query('SELECT * FROM wallet_send_list WHERE txid=?', [req.params.hash]);
    dbconn.end();
    if (!rows.length) {
      return res.status(404).json({
        message: `The request(hash:${req.params.hash}) was not found.`
      })
    }
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json(rows[0]);
})
.put(async (req, res) => {
  // TXID를 기준으로 DB내용 수정
  let dbconn, rows;
  try {
    dbconn = await pool.getConnection();
    delete req.body.txid;
    const columns = Object.keys(req.body);
    const values = Object.values(req.body);
    values.push(req.params.hash);
    const sql = "UPDATE wallet_send_list SET " + columns.join("=?, ") + "=? WHERE txid=?";
    rows = await dbconn.query(sql, values);
    dbconn.end();
    if (!rows.affectedRows) {
      return res.status(404).json({ Error: `The request(no:${req.params.id}) was not found.` });
    }
  } catch (err) {
    if (dbconn) dbconn.end();
    return res.status(500).json({
      Error: err.message
    });
  }
  return res.status(200).json({ message: 'OK' });
});

app.use('/api', router);

var server = app.listen( port, () => {
  console.log('Listening on port ' + server.address().port);
});
