'use strict';

const express = require('express'),
      mariadb = require('mariadb'),
      bodyParser = require('body-parser'),
      morgan = require('morgan'),
      Queue = require('bull'),
      Arena = require('bull-arena');

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
const txQueue = new Queue(queueNames[1], REDIS_URL);

app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(require('method-override')());

const port = process.env.PORT || 50080;

let router = express.Router();
router.use((req, res, next) => {
  // Log
  // console.log(req.host, req.port, req.url);
  next();
});

const validateRequest = async (body) => {
  return new Promise(async (resolve, reject) => {
    try {
      let dbconn, rows;
      dbconn = await pool.getConnection();
      for (let i=0; i<body.length; i++) {
        rows = await dbconn.query('SELECT * FROM wallet_send_list WHERE no=?', [body[i].dbid]);
        if (!rows.length) {
          dbconn.end();
          return reject(new Error(`dbid(${body[i].dbid}) was not found`));
        }

        if (rows[0].status != STATUS.EMPTY) {
          dbconn.end();
          return reject(new Error(`dbid(${body[i].dbid}) status is not EMPTY(status:${rows[0].status})`));
        }

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
    job = await reqQueue.add(req.body[i]);
    joblist.push(job.id);
  }

  return res.status(201).json({
    message: `create new queues(len: ${req.body.length})`,
    joblist: joblist.toString(),
    data: req.body
  });
})

router.route('/request/:id')
.get(async (req, res) => {
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

const arena = Arena({
  queues: queueNames.map(q => ({
      name: q,
      hostId: 'redis',
      redis: {
        port: config.REDIS_PORT,
        host: config.REDIS_HOST
      }
  })),
}, {
  basePath: '/arena',
  disableListen: true
});

app.use('/', arena);

var server = app.listen( port, () => {
  console.log('Listening on port ' + server.address().port);
});
