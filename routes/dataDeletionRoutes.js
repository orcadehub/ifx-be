import express from 'express';
import crypto from 'crypto';

const router = express.Router();
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;

// helper to verify signed request
function verifySignedRequest(signedRequest) {
  const [encodedSig, payload] = signedRequest.split('.');
  const expectedSig = crypto
    .createHmac('sha256', APP_SECRET)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return encodedSig === expectedSig;
}

router.post('/data-deletion', (req, res) => {
    res.send("Hello")
  const signedRequest = req.body.signed_request;

//   if (!verifySignedRequest(signedRequest)) {
//     return res.status(400).json({ error: 'Invalid signed request' });
//   }

//   // Extract user_id from payload
//   const payload = JSON.parse(
//     Buffer.from(signedRequest.split('.')[1], 'base64').toString('utf8')
//   );

//   const userId = payload.user_id;

//   // Delete the user's data here...
//   console.log('Delete data for user:', userId);

  res.json({
    url: `http://localhost:4000/api/deletion-status/${userId}`
  });
});


// Serve a basic HTML response for deletion status
router.get('/deletion-status/:userId', (req, res) => {
  const { userId } = req.params;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>Deletion Status</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background-color: #f5f5f5; }
          h2 { color: #2c3e50; }
          p { font-size: 1rem; color: #555; }
        </style>
      </head>
      <body>
        <h2>Data Deletion Request Received</h2>
        <p>User ID: <strong>${userId}</strong></p>
        <p>Your data deletion request has been processed.</p>
        <p>If you have questions, contact us at <a href="mailto:support@yourdomain.com">support@yourdomain.com</a>.</p>
      </body>
    </html>
  `);
});



export default router;
