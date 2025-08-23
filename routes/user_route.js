import express from "express";
import pool from "../config/db.js";
const router = express.Router();
import dotenv from "dotenv";
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
      email:row.email,
      fb_id: row.fb_id,
      username:
        row.username || (row.email ? row.email.split("@")[0] : "unknown_user"),
      category: row.category || "General",
      profilePic: row.profile_pic || "https://via.placeholder.com/100x100",
      stats: row.stats,
      fb_access_token: row.fb_access_token,
      prices: {
        facebook: {
          "Post Image/Video": 499,
          "Reels/Shorts": 499,
          "Story (Image/Video)": 499,
          Polls: 499,
        },
        instagram: {
          "Post Image/Video": 499,
          "Reels/Shorts": 499,
          "Story (Image/Video)": 499,
        },
        youtube: {
          "Short Video (<10m)": 499,
          "Video (>10m)": 999,
        },
        twitter: {
          Post: 499,
          Polls: 499,
        },
        combos: [
          {
            name: "Brand Boost",
            price: 899,
            description: "Perfect for product launches and brand awareness",
            platforms: ["Instagram", "Facebook"],
            services: ["Post Image/Video", "Story"],
          },
          {
            name: "Social Combo",
            price: 1499,
            description: "Maximum reach across all major platforms",
            platforms: ["Instagram", "Facebook", "Youtube"],
            services: ["Reels/Shorts", "In-Video Promotion"],
          },
          {
            name: "Video Power Pack",
            price: 2199,
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
            price: 1299,
          },
          {
            name: "Visit and Promote at Your Business",
            description:
              "We visit your physical store or office and capture real-time promotional content to build authentic engagement.",
            price: 1799,
          },
          {
            name: "Brand Promotion",
            description:
              "Dedicated content crafted to showcase your brand’s story, values, and offerings with maximum impact.",
            price: 1599,
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

// GET user by email
router.get("/user-details/:email", async (req, res) => {
  const { email } = req.params;
  // console.log("Received request for user email:", email);

  try {
    const result = await pool.query(
      `SELECT id, fullname, email, role, username, profile_pic, 
              business_name, business_status, service_type,stats,data,posts, 
              website, location, price_range, account_status, category 
       FROM users 
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      console.log("No user found for email:", email);
      return res.status(404).json({ message: "User not found" });
    }
    // console.log("User data fetched:", result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ message: "Server error" });
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

export default router;


