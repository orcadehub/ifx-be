import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "../config/db.js";

dotenv.config();
const router = express.Router();

// Redirect to Facebook OAuth
router.get("/auth/facebook", (req, res) => {
  const { userType } = req.query;
  const fbLoginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&scope=public_profile,email&state=${userType}`;
  res.redirect(fbLoginUrl);
});

// Facebook OAuth Callback
router.get("/auth/facebook/callback", async (req, res) => {
  const { code, state } = req.query;
  const userRole = state || "influencer"; // Extract user role (from frontend)

  console.log("Received Facebook callback. Code:", code, "State:", state);
  console.log("User Role:", userRole);

  try {
    // Log environment variables used for Facebook API call
    console.log("FB_APP_ID:", process.env.FB_APP_ID);
    console.log("FB_REDIRECT_URI:", process.env.FB_REDIRECT_URI);
    // Be cautious logging secrets in production logs, but for debugging, it's necessary here
    console.log("FB_APP_CODE (Client Secret - first few chars):", process.env.FB_APP_CODE ? process.env.FB_APP_CODE.substring(0, 5) + '...' : 'Not set');

    const facebookTokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.FB_APP_ID}&redirect_uri=${process.env.FB_REDIRECT_URI}&client_secret=${process.env.FB_APP_CODE}&code=${code}`;
    console.log("Attempting to fetch Facebook access token from URL:", facebookTokenUrl); // Log the full URL

    const tokenRes = await fetch(facebookTokenUrl);

    // IMPORTANT: Log the response status and body from Facebook's API
    console.log("Response status from Facebook token exchange:", tokenRes.status);
    const tokenResponseText = await tokenRes.text(); // Read the response body as text first
    console.log("Response body from Facebook token exchange:", tokenResponseText);

    // If the response is not OK (e.g., 400), we'll likely have the error details in the body
    if (!tokenRes.ok) {
        console.error("Facebook Token Exchange Failed: Non-OK HTTP status received.");
        // The error details from Facebook are in tokenResponseText
        try {
            const errorJson = JSON.parse(tokenResponseText);
            console.error("Facebook Error Details (parsed JSON):", errorJson);
             // Return the actual status code from Facebook
            return res.status(tokenRes.status).json({ error: "Failed to exchange code with Facebook.", details: errorJson });
        } catch (parseError) {
            console.error("Failed to parse Facebook error response as JSON:", parseError);
             // Return the actual status code from Facebook and the raw text
            return res.status(tokenRes.status).json({ error: "Failed to exchange code with Facebook.", details: tokenResponseText });
        }
    }

    // If the response is OK, parse it as JSON
    let tokenJson;
    try {
        tokenJson = JSON.parse(tokenResponseText); // Use the already read text
        console.log("Successfully parsed Facebook token response JSON:", tokenJson);
    } catch (parseError) {
        console.error("Failed to parse successful Facebook token response as JSON:", parseError);
         return res.status(500).json({ error: "Failed to parse Facebook token response." });
    }


    const accessToken = tokenJson.access_token;
    console.log("Received access token (first few chars):", accessToken ? accessToken.substring(0, 5) + '...' : 'None');


    // 2. Fetch user profile from Facebook
    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`;
    console.log("Attempting to fetch Facebook profile from URL:", profileUrl); // Log profile URL

    const profileRes = await fetch(profileUrl);

     console.log("Response status from Facebook profile fetch:", profileRes.status);
    const profileResponseText = await profileRes.text(); // Read response body as text
    console.log("Response body from Facebook profile fetch:", profileResponseText);


    if (!profileRes.ok) {
         console.error("Facebook Profile Fetch Failed: Non-OK HTTP status received.");
         try {
            const errorJson = JSON.parse(profileResponseText);
            console.error("Facebook Profile Fetch Error Details (parsed JSON):", errorJson);
            return res.status(profileRes.status).json({ error: "Failed to retrieve Facebook profile.", details: errorJson });
         } catch (parseError) {
             console.error("Failed to parse Facebook profile error response as JSON:", parseError);
             return res.status(profileRes.status).json({ error: "Failed to retrieve Facebook profile.", details: profileResponseText });
         }
    }

    let fbProfile;
    try {
        fbProfile = JSON.parse(profileResponseText); // Use the already read text
        console.log("Successfully parsed Facebook profile JSON:", fbProfile);
    } catch (parseError) {
         console.error("Failed to parse successful Facebook profile response as JSON:", parseError);
         return res.status(500).json({ error: "Failed to parse Facebook profile response." });
    }


    if (!fbProfile.id || !fbProfile.name) {
      console.error("Missing id or name in Facebook profile.");
      return res.status(400).json({ error: "Failed to retrieve Facebook profile." });
    }

    const fbId = fbProfile.id;
    const fullname = fbProfile.name;
    const email = fbProfile.email || `${fbId}@facebook.com`; // fallback if email not provided
    const profilePic = fbProfile.picture?.data?.url || "";
    console.log("Extracted Facebook Profile Info - ID:", fbId, "Fullname:", fullname, "Email:", email);

    // 3. Check if user already exists (Logging around database operations)
    console.log("Checking for existing user with fb_id:", fbId, "or email:", email);
    const existingUserRes = await pool.query(
      "SELECT * FROM users WHERE fb_id = $1 OR email = $2",
      [fbId, email]
    );
    console.log("Existing user query result rows:", existingUserRes.rows.length);


    let user;

    if (existingUserRes.rows.length === 0) {
      // 4. Create a new user
      console.log("No existing user found. Creating new user with role:", userRole);
      const insertRes = await pool.query(
        `INSERT INTO users (fb_id, fullname, email, profile_pic, password, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [fbId, fullname, email, profilePic, "facebook_default", userRole]
      );
      user = insertRes.rows[0];
      console.log("New user created with ID:", user.id);
    } else {
      // 5. Existing user - optionally update fb_id and profile pic
      user = existingUserRes.rows[0];
      console.log("Existing user found with ID:", user.id, ". Updating fb_id and profile pic.");

      await pool.query(
        `UPDATE users SET fb_id = $1, profile_pic = $2 WHERE id = $3`,
        [fbId, profilePic, user.id]
      );
       console.log("Existing user updated.");
    }

    // 6. Generate JWT token
    console.log("Generating JWT token for user ID:", user.id);
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    console.log("JWT token generated (first few chars):", jwtToken ? jwtToken.substring(0, 5) + '...' : 'None');


    // 7. Redirect to frontend with token
    const frontendURL = process.env.FRONTEND_URL || "http://localhost:5173";
    console.log("Redirecting to frontend URL:", `${frontendURL}/login`);
    res.redirect(`${frontendURL}/login`);

  } catch (err) {
    console.error("Caught a general Facebook Auth Error:", err);
    res.status(500).json({ error: "Something went wrong during Facebook login." });
  }
});


export default router;
