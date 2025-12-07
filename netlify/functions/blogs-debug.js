// netlify/functions/blobs-debug.js

let getStoreSafe = null;
let connectLambdaSafe = null;

try {
  ({ getStore: getStoreSafe, connectLambda: connectLambdaSafe } = require('@netlify/blobs'));
} catch (e) {
  console.warn('[blobs-debug] Failed to require @netlify/blobs', e);
}

exports.handler = async (event) => {
  // For Lambda-compat mode, connect blobs to this function's context
  if (connectLambdaSafe) {
    try {
      connectLambdaSafe(event);
    } catch (e) {
      console.warn('[blobs-debug] connectLambda failed', e);
    }
  }

  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Case 1: require failed
    if (!getStoreSafe) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          step: 'require',
          message: '@netlify/blobs could not be required. Is it installed in package.json?'
        })
      };
    }

    let store;
    try {
      store = getStoreSafe('promo-campaigns');
    } catch (e) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          step: 'getStore',
          message: 'getStore threw an error (likely environment not configured)',
          error: e.message || String(e)
        })
      };
    }

    try {
      const testKey = 'debug-key';
      const testValue = `hello-${Date.now()}`;

      await store.set(testKey, testValue);
      const readBack = await store.get(testKey);

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          step: 'roundtrip',
          message: 'Successfully wrote and read a blob in store promo-campaigns',
          written: testValue,
          readBack
        })
      };
    } catch (e) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          step: 'set/get',
          message: 'Failed when calling store.set / store.get',
          error: e.message || String(e)
        })
      };
    }
  } catch (err) {
    console.error('[blobs-debug] unexpected error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        step: 'unknown',
        message: 'Unhandled error in blobs-debug',
        error: err.message || String(err)
      })
    };
  }
};
