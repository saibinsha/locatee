require('dotenv').config();

const dns = require('dns');

// Fix querySrv ECONNREFUSED on some ISPs
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();

const PORT = process.env.PORT || 5000;


// =========================================================
// ENVIRONMENT VARIABLES
// =========================================================

const MONGO_URL = process.env.MONGO_URL;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || '6677';


// =========================================================
// CHECK MONGO URL
// =========================================================

if (!MONGO_URL) {

  console.error(
    'ERROR: MONGO_URL environment variable is missing.'
  );

  process.exit(1);

}


// =========================================================
// EXPRESS
// =========================================================

app.use(
  express.json({
    limit: '1mb'
  })
);


// Serve index.html, CSS, JS, images, etc.
app.use(
  express.static(__dirname)
);


let client;
let db;
let col;


// =========================================================
// ADMIN SESSIONS
// =========================================================
//
// Temporary in-memory tokens.
//
// Restarting Render/server automatically invalidates
// all existing admin sessions.
//

const adminSessions = new Map();


// Token lifetime: 2 hours
const ADMIN_SESSION_TIME = 2 * 60 * 60 * 1000;


// =========================================================
// MONGODB CONNECTION
// =========================================================

(async () => {

  try {

    client = new MongoClient(
      MONGO_URL,
      {
        serverSelectionTimeoutMS: 15000
      }
    );

    await client.connect();

    db = client.db('tracker');

    col = db.collection('locations');

    console.log('MongoDB connected');

    app.listen(
      PORT,
      () => {

        console.log(
          `Server running on port ${PORT}`
        );

      }
    );

  } catch (e) {

    console.error(
      'Mongo error:',
      e.message
    );


    if (
      e.message.includes('querySrv') ||
      e.message.includes('ECONNREFUSED')
    ) {

      console.error(
        'Possible DNS problem, blocked SRV lookup, or MongoDB cluster issue.'
      );

    }


    process.exit(1);

  }

})();


// =========================================================
// HELPER: GET IP
// =========================================================

function getIP(req) {

  const forwarded =
    req.headers['x-forwarded-for'];


  if (forwarded) {

    return forwarded
      .split(',')[0]
      .trim();

  }


  return (
    req.socket.remoteAddress ||
    null
  );

}


// =========================================================
// HELPER: ADMIN TOKEN
// =========================================================

function getAdminToken(req) {

  const authorization =
    req.headers.authorization || '';


  if (
    !authorization.startsWith(
      'Bearer '
    )
  ) {

    return null;

  }


  return authorization
    .substring(7)
    .trim();

}


// =========================================================
// ADMIN AUTH MIDDLEWARE
// =========================================================

function requireAdmin(req, res, next) {

  const token =
    getAdminToken(req);


  if (!token) {

    return res.status(401).json({
      ok: false,
      error: 'Admin authentication required'
    });

  }


  const session =
    adminSessions.get(token);


  if (!session) {

    return res.status(401).json({
      ok: false,
      error: 'Invalid admin session'
    });

  }


  // Check expiration
  if (
    Date.now() - session.createdAt >
    ADMIN_SESSION_TIME
  ) {

    adminSessions.delete(token);

    return res.status(401).json({
      ok: false,
      error: 'Admin session expired'
    });

  }


  next();

}


// =========================================================
// 1. ADMIN LOGIN
// =========================================================
//
// Password is checked on the server.
// The frontend never gets the actual password.
//

app.post(
  '/api/admin/login',
  (req, res) => {

    try {

      const password =
        String(
          req.body?.password || ''
        );


      if (
        password !==
        String(ADMIN_PASSWORD)
      ) {

        return res.status(401).json({

          ok: false,

          error:
            'Invalid admin password'

        });

      }


      // Generate secure random token

      const token =
        crypto.randomBytes(32)
          .toString('hex');


      adminSessions.set(
        token,
        {
          createdAt: Date.now()
        }
      );


      res.json({

        ok: true,

        token: token,

        expiresIn:
          ADMIN_SESSION_TIME

      });


    } catch (e) {

      console.error(
        'Admin login error:',
        e.message
      );


      res.status(500).json({

        ok: false

      });

    }

  }
);


// =========================================================
// 2. PAGE OPEN LOG
// =========================================================
//
// This records that the webpage was opened.
// It DOES NOT contain GPS coordinates.
//

app.post(
  '/api/page-open',
  async (req, res) => {

    try {

      const data =
        req.body || {};


      const log = {

        event:
          'page_opened',

        permission:
          null,

        lat:
          null,

        lon:
          null,

        acc:
          null,

        alt:
          null,

        speed:
          null,

        heading:
          null,

        userAgent:
          data.userAgent ||
          req.headers['user-agent'] ||
          null,

        language:
          data.language ||
          null,

        screen:
          data.screen ||
          null,

        ip:
          getIP(req),

        received:
          new Date()

      };


      const result =
        await col.insertOne(log);


      res.json({

        ok: true,

        id:
          result.insertedId

      });


    } catch (e) {

      console.error(
        'Page-open error:',
        e.message
      );


      res.status(500).json({

        ok: false

      });

    }

  }
);


// =========================================================
// 3. LOCATION PERMISSION STATUS
// =========================================================
//
// Saves:
//
// granted
// denied
// unavailable
// timeout
// unsupported
//
// No GPS coordinates are stored here.
//

app.post(
  '/api/location-status',
  async (req, res) => {

    try {

      const data =
        req.body || {};


      const allowedStatuses = [

        'granted',

        'denied',

        'unavailable',

        'timeout',

        'unsupported'

      ];


      let permission =
        data.permission ||
        'unknown';


      if (
        !allowedStatuses.includes(
          permission
        )
      ) {

        permission =
          'unknown';

      }


      const log = {

        event:
          'location_permission',

        permission:
          permission,

        lat:
          null,

        lon:
          null,

        acc:
          null,

        alt:
          null,

        speed:
          null,

        heading:
          null,

        userAgent:
          data.userAgent ||
          req.headers['user-agent'] ||
          null,

        ip:
          getIP(req),

        received:
          new Date()

      };


      const result =
        await col.insertOne(log);


      res.json({

        ok: true,

        id:
          result.insertedId

      });


    } catch (e) {

      console.error(
        'Permission status error:',
        e.message
      );


      res.status(500).json({

        ok: false

      });

    }

  }
);


// =========================================================
// 4. RECEIVE REAL GPS LOCATION
// =========================================================
//
// Coordinates are accepted here only when the browser
// has granted geolocation permission.
//

app.post(
  '/loc',
  async (req, res) => {

    try {

      const data =
        req.body || {};


      const lat =
        Number(data.lat);


      const lon =
        Number(data.lon);


      // Validate coordinates

      if (

        !Number.isFinite(lat) ||

        !Number.isFinite(lon) ||

        lat < -90 ||

        lat > 90 ||

        lon < -180 ||

        lon > 180

      ) {

        return res.status(400).json({

          ok: false,

          error:
            'Invalid coordinates'

        });

      }


      const fix = {

        event:
          'location_received',

        permission:
          'granted',


        // REAL GPS COORDINATES

        lat:
          lat,

        lon:
          lon,


        acc:
          data.acc != null
            ? Number(data.acc)
            : null,


        alt:
          data.alt != null
            ? Number(data.alt)
            : null,


        speed:
          data.speed != null
            ? Number(data.speed)
            : null,


        heading:
          data.heading != null
            ? Number(data.heading)
            : null,


        // Browser information

        ua:
          data.ua ||
          req.headers['user-agent'] ||
          null,


        ip:
          getIP(req),


        // Client timestamp

        clientTime:
          data.time
            ? new Date(data.time)
            : null,


        // Server timestamp

        received:
          new Date()

      };


      const result =
        await col.insertOne(fix);


      res.json({

        ok: true,

        id:
          result.insertedId

      });


    } catch (e) {

      console.error(
        'Location error:',
        e.message
      );


      res.status(500).json({

        ok: false

      });

    }

  }
);


// =========================================================
// 5. ADMIN - GET ALL LOGS
// =========================================================
//
// PROTECTED BY ADMIN PASSWORD/TOKEN.
//

app.get(
  '/api/locations',
  requireAdmin,
  async (req, res) => {

    try {

      const logs =
        await col
          .find({})
          .sort({
            _id: -1
          })
          .limit(500)
          .toArray();


      res.json(logs);


    } catch (e) {

      console.error(
        'Admin logs error:',
        e.message
      );


      res.status(500).json({

        ok: false,

        error:
          'Failed to load logs'

      });

    }

  }
);


// =========================================================
// 6. ADMIN - DELETE ONE LOG
// =========================================================
//
// DELETE /api/locations/:id
//

app.delete(
  '/api/locations/:id',
  requireAdmin,
  async (req, res) => {

    try {

      const id =
        req.params.id;


      if (
        !ObjectId.isValid(id)
      ) {

        return res.status(400).json({

          ok: false,

          error:
            'Invalid log ID'

        });

      }


      const result =
        await col.deleteOne({

          _id:
            new ObjectId(id)

        });


      if (
        result.deletedCount === 0
      ) {

        return res.status(404).json({

          ok: false,

          error:
            'Log not found'

        });

      }


      res.json({

        ok: true,

        deletedCount:
          result.deletedCount

      });


    } catch (e) {

      console.error(
        'Delete log error:',
        e.message
      );


      res.status(500).json({

        ok: false,

        error:
          'Failed to delete log'

      });

    }

  }
);


// =========================================================
// 7. ADMIN - DELETE ALL LOGS
// =========================================================
//
// DELETE /api/locations
//

app.delete(
  '/api/locations',
  requireAdmin,
  async (req, res) => {

    try {

      const result =
        await col.deleteMany({});


      res.json({

        ok: true,

        deletedCount:
          result.deletedCount

      });


    } catch (e) {

      console.error(
        'Delete all logs error:',
        e.message
      );


      res.status(500).json({

        ok: false,

        error:
          'Failed to delete logs'

      });

    }

  }
);


// =========================================================
// 8. ADMIN LOGOUT
// =========================================================
//
// Removes the current temporary token.
//

app.post(
  '/api/admin/logout',
  requireAdmin,
  (req, res) => {

    const token =
      getAdminToken(req);


    if (token) {

      adminSessions.delete(
        token
      );

    }


    res.json({

      ok: true

    });

  }
);


// =========================================================
// 9. HEALTH CHECK
// =========================================================

app.get(
  '/health',
  (req, res) => {

    res.json({

      ok:
        true,

      server:
        'running',

      mongodb:
        !!col,

      time:
        new Date().toISOString()

    });

  }
);


// =========================================================
// CLEAN SHUTDOWN
// =========================================================

process.on(
  'SIGINT',
  async () => {

    console.log(
      'Shutting down...'
    );


    try {

      if (client) {

        await client.close();

      }

    } finally {

      process.exit(0);

    }

  }
);


process.on(
  'SIGTERM',
  async () => {

    console.log(
      'SIGTERM received...'
    );


    try {

      if (client) {

        await client.close();

      }

    } finally {

      process.exit(0);

    }

  }
);