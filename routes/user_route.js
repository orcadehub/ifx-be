import express from "express";
import pool from "../config/db.js";
const router = express.Router();
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();
import authenticateToken from "../middlewares/authMiddleware.js";

const services = [
  {
    id: 1,
    title: "Product Review",
    platform: "YouTube",
    image: "https://picsum.photos/300/180?random=1",
    likes: "180K",
    views: "450K",
    comments: "720",
    shares: "9K",
  },
  {
    id: 2,
    title: "Travel Vlog",
    platform: "Twitter",
    image: "https://picsum.photos/300/180?random=2",
    likes: "220K",
    views: "600K",
    comments: "950",
    shares: "12K",
  },
  {
    id: 3,
    title: "Fitness Challenge",
    platform: "Instagram",
    image: "http://picsum.photos/300/180?random=3",
    likes: "195K",
    views: "520K",
    comments: "830",
    shares: "9K",
  },
  {
    id: 4,
    title: "Cooking Tips",
    platform: "Facebook",
    image: "https://picsum.photos/300/180?random=4",
    likes: "150K",
    views: "430K",
    comments: "600",
    shares: "8K",
  },
  {
    id: 5,
    title: "Unboxing",
    platform: "YouTube",
    image: "https://picsum.photos/300/180?random=5",
    likes: "200K",
    views: "550K",
    comments: "800",
    shares: "11K",
  },
];

// GET /influencers
router.get("/influencers", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // From decoded JWT

    const result = await pool.query(
      `SELECT 
         u.id, 
         u.fullname AS name, 
         u.email, 
         u.phone, 
         u.role, 
         u.fb_access_token,
         u.fb_id,
         u.profile_pic AS profile_pic, 
         u.fb_username AS username, 
         u.category, 
         u.stats, 
         u.prices, 
         u.data, 
         u.posts,
         COALESCE(w.wishlist, '[]'::JSONB) @> to_jsonb(u.id::INTEGER) AS wishlist
       FROM users u
       LEFT JOIN users w ON w.id = $1
       WHERE u.role = 'influencer'`,
      [userId]
    );

    const influencers = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      fb_id: row.fb_id,
      username:
        row.username || (row.email ? row.email.split("@")[0] : "unknown_user"),
      category: row.category || "General",
      profilePic: row.profile_pic || "https://via.placeholder.com/100x100",
      stats: row.stats,
      fb_access_token: row.fb_access_token,
      prices: row.prices || {
        facebook: {
          "Post Image/Video": 0,
          "Reels/Shorts": 0,
          "Story (Image/Video)": 0,
          Polls: 0,
        },
        instagram: {
          "Post Image/Video": 0,
          "Reels/Shorts": 0,
          "Story (Image/Video)": 0,
        },
        youtube: {
          "Short Video (<10m)": 0,
          "Video (>10m)": 0,
        },
        twitter: {
          Post: 0,
          Polls: 0,
        },
        combos: [
          {
            name: "Brand Boost",
            price: 0,
            description: "Perfect for product launches and brand awareness",
            platforms: ["Instagram", "Facebook"],
            services: ["Post Image/Video", "Story"],
          },
          {
            name: "Social Combo",
            price: 0,
            description: "Maximum reach across all major platforms",
            platforms: ["Instagram", "Facebook", "Youtube"],
            services: ["Reels/Shorts", "In-Video Promotion"],
          },
          {
            name: "Video Power Pack",
            price: 0,
            description: "Great for detailed product demos and tutorials",
            platforms: ["Youtube", "Instagram"],
            services: ["In-Video Promotion", "Detailed Product Demo"],
          },
        ],
        custom: [
          {
            name: "In-Video Promotion",
            description:
              "Your brand or product is integrated into one of our videos, making it appear native and trustworthy to viewers.",
            price: 0,
          },
          {
            name: "Visit and Promote at Your Business",
            description:
              "We visit your physical store or office and capture real-time promotional content to build authentic engagement.",
            price: 0,
          },
          {
            name: "Brand Promotion",
            description:
              "Dedicated content crafted to showcase your brand’s story, values, and offerings with maximum impact.",
            price: 0,
          },
        ],
      },
      data: row.data || {
        totalCampaigns: 0,
        avgLikes: 0,
        avgViews: "0",
        avgReach: "0",
        engagement: "0%",
        avgComments: 0,
        avgShares: 0,
        fakeFollowers: "0%",
      },
      posts: row.posts || [],
      wishlist: !!row.wishlist, // Convert to boolean
    }));

    res.status(200).json(influencers);
  } catch (err) {
    console.error("❌ Error fetching influencers:", err);
    res.status(500).json({ message: "❌ Failed to fetch influencers." });
  }
});

// GET /wishlist
router.get("/wishlist", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // from JWT
    // 1. Get the wishlist array for this user
    const userResult = await pool.query(
      `SELECT wishlist 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const wishlist = userResult.rows[0].wishlist || [];
    if (wishlist.length === 0) {
      return res.status(200).json([]); // No influencers
    }

    // 2. Fetch influencers by IDs in wishlist
    const result = await pool.query(
      `SELECT 
         id, 
         fullname AS name, 
         email, 
         profile_pic, 
         data
       FROM users
       WHERE id = ANY($1) AND role = 'influencer'`,
      [wishlist]
    );

    const influencers = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      profilePic: row.profile_pic || "https://via.placeholder.com/100x100",
      data: row.data || {
        totalCampaigns: 0,
        avgLikes: 0,
        avgViews: "0",
        avgReach: "0",
        engagement: "0%",
        avgComments: 0,
        avgShares: 0,
        fakeFollowers: "0%",
      },
    }));

    res.status(200).json(influencers);
  } catch (err) {
    console.error("❌ Error fetching wishlist influencers:", err);
    res
      .status(500)
      .json({ message: "❌ Failed to fetch wishlist influencers." });
  }
});

// GET /user-details/:email  -> fetch by email
router.get("/user-details/:email", async (req, res) => {
  const { email } = req.params;

  // Basic validation for email format (simple regex)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  try {
    const result = await pool.query(
      `SELECT id, fullname, email, role, username, profile_pic
       FROM users
       WHERE email = $1`,
      [email] // parameterized query to prevent SQL injection
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return single user object (not array)
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/user-details/:id - fetch user by numeric id
router.get("/user/:id", async (req, res) => {
  const { id } = req.params;
  console.log("Fetching user by id:", id);

  const parsedId = parseInt(id, 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  try {
    const result = await pool.query(
      `SELECT id, fullname, email, role, username, profile_pic,
              business_name, business_status, service_type, stats, data, posts,
              website, location, price_range, account_status, category
       FROM users
       WHERE id = $1`,
      [parsedId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(result.rows[0]);  // Return single user object
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.put("/update-profile/:email", async (req, res) => {
  const { email } = req.params;
  console.log(email);
  const update = req.body;

  try {
    const keys = Object.keys(update);
    const values = Object.values(update);

    const setClause = keys
      .map((key, index) => `${key} = $${index + 1}`)
      .join(", ");
    const result = await pool.query(
      `UPDATE users SET ${setClause} WHERE email = $${
        keys.length + 1
      } RETURNING *`,
      [...values, email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update user profile by email
router.put("/user/update/:email", authenticateToken, async (req, res) => {
  const { email } = req.params;
  const update = req.body;

  // Ensure the authenticated user can only update their own profile
  if (req.user.email !== email) {
    return res
      .status(403)
      .json({ message: "Unauthorized to update this profile" });
  }

  try {
    const keys = Object.keys(update);
    const values = Object.values(update);

    if (keys.length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    const setClause = keys
      .map((key, index) => `${key} = $${index + 1}`)
      .join(", ");
    const query = `
      UPDATE users 
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
      WHERE email = $${keys.length + 1} 
      RETURNING id, fullname, email, role, updated_at
    `;
    const result = await pool.query(query, [...values, email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /wishlist
router.post("/wishlist", authenticateToken, async (req, res) => {
  const { itemId } = req.body;
  const userId = req.user.id;

  // Validate input
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return res
      .status(400)
      .json({ error: "Invalid itemId: must be a positive integer" });
  }

  try {
    // Ensure wishlist is initialized as an empty JSONB array
    await pool.query(
      `UPDATE users
       SET wishlist = COALESCE(wishlist, '[]'::JSONB)
       WHERE id = $1 AND (wishlist IS NULL OR jsonb_typeof(wishlist) != 'array')`,
      [userId]
    );

    // Check if itemId is in wishlist
    const checkResult = await pool.query(
      `SELECT COALESCE(wishlist, '[]'::JSONB) @> to_jsonb($1::INTEGER) AS is_in_wishlist
       FROM users
       WHERE id = $2`,
      [itemId, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(400).json({ error: "User not found" });
    }

    const isInWishlist = checkResult.rows[0].is_in_wishlist;

    if (isInWishlist) {
      // Remove item from wishlist
      const result = await pool.query(
        `UPDATE users
         SET wishlist = (
           SELECT jsonb_agg(elem)
           FROM jsonb_array_elements(COALESCE(wishlist, '[]'::JSONB)) elem
           WHERE elem::INTEGER != $1
         )
         WHERE id = $2
         RETURNING wishlist`,
        [itemId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(400).json({ error: "User not found" });
      }

      return res.status(200).json({
        message: "Removed from wishlist",
        wishlist: result.rows[0].wishlist,
      });
    } else {
      // Add item to wishlist
      const result = await pool.query(
        `UPDATE users
         SET wishlist = COALESCE(wishlist, '[]'::JSONB) || to_jsonb($1::INTEGER)
         WHERE id = $2
         RETURNING wishlist`,
        [itemId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(400).json({ error: "User not found" });
      }

      return res.status(200).json({
        message: "Added to wishlist",
        wishlist: result.rows[0].wishlist,
      });
    }
  } catch (error) {
    console.error("Wishlist API error:", error);
    return res
      .status(500)
      .json({ error: "Server error", details: error.message });
  }
});

router.get("/metrics/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(userId);
    // Verify the userId matches the token's id
    // if (req.user.id !== userId) {
    //   console.log(`Unauthorized access attempt: token userId ${req.userId} does not match requested userId ${userId}`);
    //   return res.status(403).json({ error: "Forbidden: User ID mismatch" });
    // }

    const result = await pool.query(
      `SELECT 
         earnings,
         total_orders,
         active_campaigns,
         total_campaigns,
         connected_influencers,
         total_posts,
         reels,
         videos,
         stories
       FROM influencer_metrics
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`No metrics found for userId: ${userId}`);
      return res.status(404).json({ error: "No metrics found for this user" });
    }

    const metrics = result.rows[0];

    // Format response to match frontend expectations
    const formattedMetrics = {
      earnings: `₹${metrics.earnings}`,
      total_orders: metrics.total_orders.toString(),
      active_campaigns: `${metrics.active_campaigns}`,
      total_campaigns: `${metrics.total_campaigns}`,
      connected_influencers: metrics.connected_influencers.toString(),
      total_posts: metrics.total_posts.toString(),
      reels: metrics.reels.toString(),
      videos: metrics.videos.toString(),
      stories: metrics.stories.toString(),
    };

    res.json(formattedMetrics);
  } catch (err) {
    console.error("Error fetching metrics:", err.message);
    res.status(500).json({
      error: "Failed to fetch metrics",
      details:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
});

router.get("/top-users", async (req, res) => {
  try {
    // Query for top 5 business users
    const businessQuery = `
      SELECT 
        u.fullname AS name,
        COALESCE(u.profile_pic, 'https://picsum.photos/seed/default/100') AS img,
        COALESCE(im.total_orders, 0) AS orders
      FROM users u
      LEFT JOIN influencer_metrics im ON u.id = im.user_id
      WHERE u.role = 'business'
      ORDER BY orders DESC
      LIMIT 5
    `;
    const businessResult = await pool.query(businessQuery);

    // Query for top 5 influencer users
    const influencerQuery = `
      SELECT 
        u.fullname AS name,
        COALESCE(u.profile_pic, 'https://picsum.photos/seed/default/100') AS img,
        COALESCE(im.total_orders, 0) AS orders
      FROM users u
      LEFT JOIN influencer_metrics im ON u.id = im.user_id
      WHERE u.role = 'influencer'
      ORDER BY orders DESC
      LIMIT 5
    `;
    const influencerResult = await pool.query(influencerQuery);

    // Format response
    const topUsers = {
      businessUsers: businessResult.rows.map((row) => ({
        name: row.name,
        img: row.img,
        orders: row.orders.toString(), // Convert to string to match frontend
      })),
      influencerUsers: influencerResult.rows.map((row) => ({
        name: row.name,
        img: row.img,
        orders: row.orders.toString(), // Convert to string to match frontend
      })),
    };

    // Check if both arrays are empty
    if (
      businessResult.rows.length === 0 &&
      influencerResult.rows.length === 0
    ) {
      console.log("No users found");
      return res.status(404).json({ error: "No users found" });
    }

    res.json(topUsers);
  } catch (err) {
    console.error("Error fetching top users:", err.message);
    res.status(500).json({
      error: "Failed to fetch top users",
      details:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    });
  }
});

const rowSchema = z.object({
  platform: z.enum(["Instagram", "Facebook", "YouTube", "Twitter"]),
  service_group: z.enum(["Platform Based", "Combo Package", "Custom Package"]),
  service_item: z.string().min(1),
  // null = not offered
  price: z.number().nonnegative().nullable(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1),
});

router.put("/prices/:userId", authenticateToken, async (req, res) => {
  const startTime = new Date().toISOString();
  const reqId = `${startTime}:${Math.random().toString(36).slice(2, 8)}`;

  try {
    console.log(`[${reqId}] PUT /prices (users.prices) called`);

    // Validate userId path param
    const pathUserId = Number.parseInt(req.params.userId, 10);
    if (!Number.isFinite(pathUserId) || pathUserId <= 0) {
      console.warn(`[${reqId}] Invalid userId param:`, req.params.userId);
      return res.status(400).json({ message: "Invalid userId" });
    }
    console.log(`[${reqId}] userId param OK:`, pathUserId);

    // Authorization: only owner or admin
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && req.user?.id !== pathUserId) {
      console.warn(
        `[${reqId}] Forbidden: token user ${req.user?.id} cannot update ${pathUserId}`
      );
      return res.status(403).json({ message: "Forbidden" });
    }
    console.log(
      `[${reqId}] Auth OK: requester=${req.user?.id} role=${req.user?.role}`
    );

    // Validate body
    const { prices } = req.body || {};
    if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
      console.warn(`[${reqId}] Invalid body.prices (must be object)`);
      return res
        .status(400)
        .json({ message: "Body.prices must be a JSON object" });
    }

    // Basic top-level sanity checks (optional)
    for (const [platform, obj] of Object.entries(prices)) {
      if (obj && typeof obj !== "object") {
        console.warn(
          `[${reqId}] Invalid prices[${platform}] type:`,
          typeof obj
        );
        return res.status(400).json({
          message: `Invalid value for platform '${platform}', expected object`,
        });
      }
    }
    console.log(`[${reqId}] Prices JSON validated`);

    // Connection check (optional)
    try {
      await pool.query("SELECT 1");
      console.log(`[${reqId}] DB connection OK`);
    } catch (connErr) {
      console.error(
        `[${reqId}] DB connection failed:`,
        connErr?.message,
        connErr?.stack
      );
      return res.status(500).json({ message: "Database connection failed" });
    }

    // Update users.prices and updated_at (if you track it on users)
    const sql = `
      UPDATE users
         SET prices = $2::jsonb
       WHERE id = $1
       RETURNING id, prices;
    `; // Direct JSONB write to users. [2]

    const params = [pathUserId, JSON.stringify(prices)];
    console.log(`[${reqId}] Executing UPDATE users.prices`, {
      userId: pathUserId,
      payloadLength: params[3]?.length,
    });

    let rows;
    try {
      const result = await pool.query(sql, params);
      rows = result?.rows || [];
      console.log(`[${reqId}] UPDATE OK, affected rows:`, rows.length);
    } catch (dbErr) {
      console.error(`[${reqId}] UPDATE failed:`, dbErr?.message, dbErr?.stack, {
        sql,
        paramsPreview: { userId: params },
      });
      return res
        .status(500)
        .json({ message: "Database update failed", error: dbErr?.message });
    }

    if (rows.length !== 1) {
      console.warn(
        `[${reqId}] Unexpected row count from RETURNING:`,
        rows.length
      );
    }

    return res.status(200).json({
      message: "Prices updated",
      data: rows || null,
      meta: { reqId },
    });
  } catch (err) {
    console.error(
      `[${reqId}] Unexpected error in PUT /prices:`,
      err?.message,
      err?.stack,
      { body: req.body }
    );
    return res
      .status(500)
      .json({ message: "Failed to update prices", error: err?.message, reqId });
  }
});

export default router;
