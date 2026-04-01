const admin  = require('firebase-admin');
const logger = require('./logger');

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    logger.warn('Firebase credentials missing – push notifications disabled');
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    logger.info('Firebase Admin SDK initialized');
    return firebaseApp;
  } catch (err) {
    logger.error('Firebase init failed', { err: err.message });
    return null;
  }
};

// Send a push notification to a single device
const sendPush = async ({ token, title, body, data = {} }) => {
  const app = initFirebase();
  if (!app || !token) return null;

  try {
    const result = await admin.messaging().send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', notification: { sound: 'default', channelId: 'honda_service' } },
      apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
    });
    logger.debug('FCM push sent', { messageId: result });
    return result;
  } catch (err) {
    logger.error('FCM push failed', { err: err.message, token: token.slice(0, 20) });
    return null;
  }
};

// Send to multiple tokens
const sendMulticast = async ({ tokens, title, body, data = {} }) => {
  const app = initFirebase();
  if (!app || !tokens?.length) return null;

  const message = {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    tokens,
  };

  try {
    const result = await admin.messaging().sendEachForMulticast(message);
    logger.debug('FCM multicast sent', { success: result.successCount, failed: result.failureCount });
    return result;
  } catch (err) {
    logger.error('FCM multicast failed', { err: err.message });
    return null;
  }
};

module.exports = { initFirebase, sendPush, sendMulticast };
