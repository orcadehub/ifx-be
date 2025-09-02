import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();
const router = express.Router();

// Redirect to Google OAuth
router.get("/auth/google", (req, res) => {
  const { userType } = req.query;
  const redirectURI = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&response_type=code&scope=openid%20email%20profile&state=${userType}&access_type=offline&prompt=consent`;
  res.redirect(redirectURI);
});

// Google OAuth Callback Route (Updated to include YouTube details)
router.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const userRole = state || "influencer";

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    // Step 1: Exchange code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    // console.log("🔑 Token Response:", tokenData);

    const accessToken = tokenData.access_token;
    const idToken = tokenData.id_token;

    if (!accessToken) {
      return res.status(400).json({
        error: "Failed to retrieve access token",
        details: tokenData,
      });
    }

    // Step 2: Fetch Google user profile
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      console.error("Profile Fetch Error:", errorText);
      return res.status(profileRes.status).json({
        error: "Failed to retrieve Google profile.",
        details: errorText,
      });
    }

    const googleProfile = await profileRes.json();
    // console.log("👤 Google Profile:", googleProfile);

    const {
      id: googleId,
      name: fullname,
      email,
      picture: profilePic,
    } = googleProfile;

    if (!googleId || !email) {
      return res.status(400).json({ error: "Incomplete Google profile data" });
    }

    // Step 3: Fetch YouTube channel data (requires youtube.readonly scope)
    let youtubeData = { items: [] };
    let youtubeChannelId = null;
    let youtubeChannelTitle = null;
    let youtubeVideos = { items: [] };
    try {
      const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&mine=true&access_token=${accessToken}`
      );

      if (!channelRes.ok) {
        const errorData = await channelRes.json().catch(() => ({}));
        console.warn("YouTube Channel Fetch Warning:", errorData);
        // Could be permission denied if scope not granted
        if (errorData.error?.errors?.[0]?.reason === 'insufficientPermissions') {
          console.warn("YouTube scope not granted; skipping YouTube data.");
        } else {
          throw new Error(errorData.error?.message || 'Unknown channel error');
        }
      } else {
        youtubeData = await channelRes.json();
        if (youtubeData.items && youtubeData.items.length > 0) {
          const channel = youtubeData.items[0];
          youtubeChannelId = channel.id;
          youtubeChannelTitle = channel.snippet.title;
          // Store full channel data in youtubeData

          // Step 4: Fetch recent uploads/videos
          const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
          if (uploadsPlaylistId && uploadsPlaylistId !== 'HL') { // 'HL' means no uploads playlist
            const videosRes = await fetch(
              `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10&access_token=${accessToken}`
            );

            if (videosRes.ok) {
              youtubeVideos = await videosRes.json();
            } else {
              const errorData = await videosRes.json().catch(() => ({}));
              console.warn("YouTube Videos Fetch Warning:", errorData);
            }
          }
        } else {
          console.warn("No YouTube channel found for the user.");
        }
      }
    } catch (ytErr) {
      console.warn("Failed to fetch YouTube data:", ytErr.message);
      youtubeData = { items: [], error: ytErr.message };
      youtubeVideos = { items: [], error: ytErr.message };
    }

    // Step 5: Check if user exists
    const existingUserRes = await pool.query(
      "SELECT * FROM users WHERE google_id = $1 OR email = $2",
      [googleId, email]
    );

   let user;
if (existingUserRes.rows.length === 0) {
  // New user insert (handle phone as required by schema; set a placeholder value here - consider updating schema to allow NULL or DEFAULT for OAuth flows)
  const phone = 'oauth_not_provided'; // TODO: Provide a unique phone or adjust schema (e.g., make phone nullable or add default)
  const ytProfilePic = youtubeData.items && youtubeData.items.length > 0 
    ? (youtubeData.items[0].snippet.thumbnails?.default?.url || profilePic) 
    : profilePic;
  
  const insertRes = await pool.query(
    `INSERT INTO users (google_id, fullname, email, phone, profile_pic, yt_id, yt_username, yt_profile_pic, yt_access_token, 
                       password, role, data, posts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 
             jsonb_set(COALESCE(data, '{}'::jsonb), '{youtube}', to_jsonb($12::json), true),
             jsonb_set(COALESCE(posts, '{}'::jsonb), '{youtube}', to_jsonb($13::json), true))
     RETURNING *`,
    [googleId, fullname, email, phone, profilePic, youtubeChannelId, youtubeChannelTitle, ytProfilePic, accessToken, 
     "google_default", userRole, youtubeData, youtubeVideos]
  );
  user = insertRes.rows[0];
  // console.log("🆕 New User Created:", user);
} else {
  user = existingUserRes.rows[0];
  // Update existing user
  const ytProfilePic = youtubeData.items && youtubeData.items.length > 0 
    ? (youtubeData.items[0].snippet.thumbnails?.default?.url || profilePic) 
    : profilePic;
  await pool.query(
    `UPDATE users 
     SET google_id = $1, 
         profile_pic = $2,
         yt_id = $3,
         yt_username = $4,
         yt_profile_pic = $5,
         yt_access_token = $6,
         data = jsonb_set(COALESCE(data, '{}'::jsonb), '{youtube}', to_jsonb($7::json), true),
         posts = jsonb_set(COALESCE(posts, '{}'::jsonb), '{youtube}', to_jsonb($8::json), true)
     WHERE id = $9`,
    [googleId, profilePic, youtubeChannelId, youtubeChannelTitle, ytProfilePic, accessToken, youtubeData, youtubeVideos, user.id]
  );
  // console.log("✅ Existing User Found & Updated:", user);
}
    // Step 6: Generate JWT
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Step 7: Redirect to frontend with token
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
    const redirectUrl = `${frontendURL}/dashboard/google?token=${encodeURIComponent(
      jwtToken
    )}&name=${encodeURIComponent(user.fullname)}&email=${encodeURIComponent(
      user.email
    )}&role=${encodeURIComponent(user.role)}&profilePic=${encodeURIComponent(
      user.profile_pic
    )}`;

    // console.log("🔁 Redirecting to frontend with token...");
    res.redirect(redirectUrl);
  } catch (err) {
    // console.error("❌ Google Auth Error:", err);
    res.status(500).json({
      error: "Google authentication failed.",
      message: err.message,
      stack: err.stack,
    });
  }
});

export default router;
